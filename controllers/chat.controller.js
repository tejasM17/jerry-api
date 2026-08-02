"use strict";

const mongoose = require("mongoose");
const { Readable } = require("stream");
const { getGridFSBucket } = require("../config/db");
const { withRetry } = require("../config/gemini");
const { fetchAndFormatAttachments } = require("../utils/geminiHelper");
const systemPrompt = require("../utils/systemPrompt");
const chatService = require("../services/chat.service");

/**
 * Stream headers — expose public sessionId (and optional requestId)
 * so the SPA can bind /c/:sessionId?rid= without waiting for body.
 *
 * `userMessageId` is the persisted user-message ObjectId for the turn the
 * client is about to stream an assistant reply for. Returning it in a
 * header lets the SPA pin the id onto its optimistic local user message,
 * which is required for the edit-message flow to fire with a real id
 * (instead of `undefined`, which the backend then 404s on).
 */
function setStreamHeaders(res, sessionId, requestId, userMessageId) {
  if (sessionId) {
    res.setHeader("X-Chat-Id", String(sessionId));
    res.setHeader("X-Session-Id", String(sessionId));
  }
  if (requestId) {
    res.setHeader("X-Request-Id", String(requestId));
  }
  if (userMessageId) {
    res.setHeader("X-User-Message-Id", String(userMessageId));
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
}

async function formatHistoryForGemini(history) {
  return Promise.all(
    history.map(async (msg) => {
      const parts = [{ text: msg.content || "" }];
      if (msg.role === "user" && msg.attachments?.length) {
        const attachmentParts = await fetchAndFormatAttachments(msg.attachments);
        parts.push(...attachmentParts);
      }
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts,
      };
    }),
  );
}

async function streamAssistant(res, contents) {
  let assistantResponse = "";
  await withRetry(async (model) => {
    const result = await model.generateContentStream({
      systemInstruction: {
        role: "system",
        parts: [{ text: systemPrompt }],
      },
      contents,
    });

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (!text) continue;
      assistantResponse += text;
      res.write(text);
    }
  });
  return assistantResponse;
}

exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const bucket = getGridFSBucket();
    const fileName = `${Date.now()}_${req.file.originalname}`;

    const uploadStream = bucket.openUploadStream(fileName, {
      contentType: req.file.mimetype,
      metadata: {
        originalName: req.file.originalname,
        userId: req.user?.uid || null,
      },
    });

    const readableStream = new Readable();
    readableStream.push(req.file.buffer);
    readableStream.push(null);
    readableStream.pipe(uploadStream);

    uploadStream.on("error", (error) => {
      console.error("[chat] upload:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Upload failed" });
      }
    });

    uploadStream.on("finish", () => {
      res.json({
        fileId: String(uploadStream.id),
        url: `/api/chat/files/${uploadStream.id}`,
        mimeType: req.file.mimetype,
        name: req.file.originalname,
      });
    });
  } catch (error) {
    console.error("[chat] upload:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.getFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      return res.status(400).json({ message: "Invalid file id" });
    }

    const bucket = getGridFSBucket();
    const oid = new mongoose.Types.ObjectId(fileId);
    const files = await bucket.find({ _id: oid }).toArray();
    if (!files?.length) {
      return res.status(404).json({ message: "File not found" });
    }

    const file = files[0];
    res.set("Content-Type", file.contentType || "application/octet-stream");
    res.set(
      "Content-Disposition",
      `inline; filename="${file.filename || "file"}"`,
    );
    res.set("Cache-Control", "public, max-age=86400");

    const downloadStream = bucket.openDownloadStream(oid);
    downloadStream.pipe(res);
    downloadStream.on("error", (error) => {
      console.error("[chat] getFile:", error);
      if (!res.headersSent) {
        res.status(404).json({ message: "Error downloading file" });
      }
    });
  } catch (error) {
    console.error("[chat] getFile:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /api/chat/session
 * Create an empty chat session (no messages) and return public ids.
 * Client can navigate to /c/:sessionId immediately (Grok-style).
 */
exports.createSession = async (req, res) => {
  try {
    const title =
      typeof req.body?.title === "string" && req.body.title.trim()
        ? req.body.title.trim().slice(0, 200)
        : "New chat";
    const session = await chatService.createEmptySession(req.user.uid, title);
    res.status(201).json(session);
  } catch (error) {
    console.error("[chat] createSession:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /api/chat/new
 * Create chat + user message, stream Gemini ASAP (local title, no pre-stream AI call).
 * Returns X-Session-Id / X-Chat-Id = public UUID, X-Request-Id = turn id.
 */
exports.createChatAndStream = async (req, res) => {
  try {
    const { prompt, attachments, sessionId: clientSessionId } = req.body;
    const userId = req.user.uid;

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ message: "Prompt required" });
    }

    const title = chatService.titleFromPrompt(prompt);
    // Allow client to pre-mint a session id (optional) for URL-first UX
    let chat;
    let isExisting = false;
    if (clientSessionId && chatService.isValidSessionId(clientSessionId)) {
      const existing = await chatService.assertChatOwner(
        clientSessionId,
        userId,
      );
      if (existing) {
        chat = existing;
        isExisting = true;
        if (!existing.title || existing.title === "New chat") {
          await chatService.renameChat(clientSessionId, userId, title);
        }
      } else {
        chat = await chatService.createChat(userId, title, clientSessionId);
      }
    } else {
      chat = await chatService.createChat(userId, title);
    }

    const mongoId = chat._id;
    const sessionId = chat.sessionId || String(chat._id);
    const requestId = chatService.newRequestId();

    const userMessage = await chatService.addMessage({
      chatId: mongoId,
      userId,
      role: "user",
      content: prompt,
      attachments: attachments || [],
      requestId,
    });

    setStreamHeaders(res, sessionId, requestId, userMessage?._id);
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    let contents;
    if (isExisting) {
      const history = await chatService.loadHistoryForGemini(mongoId);
      contents = await formatHistoryForGemini(history);
    } else {
      const attachmentParts = await fetchAndFormatAttachments(attachments);
      contents = [
        {
          role: "user",
          parts: [{ text: prompt }, ...attachmentParts],
        },
      ];
    }

    let assistantResponse = "";
    let streamFailed = false;
    let streamError = null;
    try {
      assistantResponse = await streamAssistant(res, contents);
    } catch (streamErr) {
      streamFailed = true;
      streamError = streamErr;
      console.error("[chat] stream new:", streamErr);
      if (!res.writableEnded) {
        res.write("\n\n[Error generating response. Please try again.]");
      }
    }

    res.end();

    if (assistantResponse) {
      await Promise.all([
        chatService.addMessage({
          chatId: mongoId,
          userId,
          role: "assistant",
          content: assistantResponse,
          requestId,
        }),
        chatService.touchChat(mongoId),
      ]);
    } else if (streamFailed) {
      // Persist a fallback assistant message so the conversation stays consistent
      // and the failure reason is visible to the user on reload (not just in the stream).
      const fallbackReason =
        (streamError && streamError.message) || "Gemini request failed";
      console.error("[chat] createChatAndStream fallback persisted:", {
        sessionId,
        requestId,
        reason: fallbackReason.slice(0, 200),
      });
      try {
        await chatService.addMessage({
          chatId: mongoId,
          userId,
          role: "assistant",
          content:
            "[Error generating response. Please try again.]",
          requestId,
        });
      } catch (persistErr) {
        console.error(
          "[chat] createChatAndStream fallback persist failed:",
          persistErr,
        );
      }
    }
  } catch (error) {
    console.error("[chat] createChatAndStream:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
};

exports.getUserChats = async (req, res) => {
  try {
    const chats = await chatService.listChats(req.user.uid, { limit: 100 });
    res.json(chats);
  } catch (error) {
    console.error("[chat] getUserChats:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.getRecentChats = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const chats = await chatService.listChats(req.user.uid, {
      limit,
      projection: true,
    });
    res.json(chats);
  } catch (error) {
    console.error("[chat] getRecentChats:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.searchChats = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !String(q).trim()) {
      return res.status(400).json({ message: "Search query required" });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const chats = await chatService.searchChats(req.user.uid, q, limit);
    res.json(chats);
  } catch (error) {
    console.error("[chat] searchChats:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const result = await chatService.getMessages(chatId, req.user.uid);
    if (result.error) {
      return res.status(result.status || 403).json({
        message:
          result.error === "forbidden"
            ? "Unauthorized to access this chat"
            : result.error,
      });
    }
    res.setHeader("X-Chat-Title", encodeURIComponent(result.chat.title || ""));
    res.setHeader("X-Session-Id", result.chat.sessionId || result.chat.id);
    res.setHeader("X-Chat-Id", result.chat.sessionId || result.chat.id);
    res.json(result.messages);
  } catch (error) {
    console.error("[chat] getChatMessages:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.deleteChat = async (req, res) => {
  try {
    const ok = await chatService.softDeleteChat(req.params.chatId, req.user.uid);
    if (!ok) {
      return res.status(403).json({ message: "Unauthorized to delete this chat" });
    }
    res.json({ message: "Chat deleted" });
  } catch (error) {
    console.error("[chat] deleteChat:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.renameChat = async (req, res) => {
  try {
    const { title } = req.body;
    const result = await chatService.renameChat(
      req.params.chatId,
      req.user.uid,
      title,
    );
    if (result.error) {
      return res.status(result.status || 400).json({ message: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error("[chat] renameChat:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.continueChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { prompt, attachments } = req.body;
    const userId = req.user.uid;

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ message: "Prompt required" });
    }

    const chat = await chatService.assertChatOwner(chatId, userId);
    if (!chat) {
      return res.status(403).json({ message: "Unauthorized to continue this chat" });
    }

    const mongoId = chat._id;
    const sessionId = chat.sessionId || String(chat._id);
    const requestId = chatService.newRequestId();

    const userMessage = await chatService.addMessage({
      chatId: mongoId,
      userId,
      role: "user",
      content: prompt,
      attachments: attachments || [],
      requestId,
    });

    const history = await chatService.loadHistoryForGemini(mongoId);
    const contents = await formatHistoryForGemini(history);

    setStreamHeaders(res, sessionId, requestId, userMessage?._id);
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    let assistantResponse = "";
    let streamFailed = false;
    let streamError = null;
    try {
      assistantResponse = await streamAssistant(res, contents);
    } catch (streamErr) {
      streamFailed = true;
      streamError = streamErr;
      console.error("[chat] stream continue:", streamErr);
      if (!res.writableEnded) {
        res.write("\n\n[Error generating response. Please try again.]");
      }
    }

    res.end();

    if (assistantResponse) {
      await Promise.all([
        chatService.addMessage({
          chatId: mongoId,
          userId,
          role: "assistant",
          content: assistantResponse,
          requestId,
        }),
        chatService.touchChat(mongoId),
      ]);
    } else if (streamFailed) {
      console.error("[chat] continueChat fallback persisted:", {
        sessionId,
        requestId,
        reason: String(streamError?.message || "").slice(0, 200),
      });
      try {
        await chatService.addMessage({
          chatId: mongoId,
          userId,
          role: "assistant",
          content: "[Error generating response. Please try again.]",
          requestId,
        });
      } catch (persistErr) {
        console.error(
          "[chat] continueChat fallback persist failed:",
          persistErr,
        );
      }
    }
  } catch (error) {
    console.error("[chat] continueChat:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
};

exports.editMessage = async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const { prompt, attachments } = req.body;
    const userId = req.user.uid;

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ message: "Prompt required" });
    }

    const chat = await chatService.assertChatOwner(chatId, userId);
    if (!chat) {
      return res.status(403).json({ message: "Unauthorized to edit this chat" });
    }

    const mongoId = chat._id;
    const sessionId = chat.sessionId || String(chat._id);

    // Look up the target message first so we can reject non-user messages
    // BEFORE we touch the conversation (no half-truncated state on 400).
    const target = await chatService.findMessageById(mongoId, messageId);
    if (!target) {
      return res.status(404).json({ message: "Message not found" });
    }
    if (target.role !== "user") {
      return res.status(400).json({ message: "Only user messages can be edited" });
    }

    const requestId = target.requestId || chatService.newRequestId();

    // Drop any messages that came after the target — the conversation
    // rewinds to the edited prompt.
    await chatService.truncateFromMessage(mongoId, messageId);

    const updated = await chatService.updateMessageContent(
      messageId,
      prompt,
      attachments || target.attachments || [],
    );
    if (!updated || String(updated.chatId) !== String(chat._id)) {
      // updateMessageContent silently missed — bail before we stream an
      // assistant reply that isn't anchored to the edited user message.
      return res.status(404).json({ message: "Message not found" });
    }

    // Keep requestId on the edited user message (no-op when already set).
    if (!target.requestId) {
      const Message = require("../models/Message.model");
      await Message.updateOne({ _id: messageId }, { $set: { requestId } });
    }

    const history = await chatService.loadHistoryForGemini(mongoId);
    const contents = await formatHistoryForGemini(history);

    setStreamHeaders(res, sessionId, requestId);
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    let assistantResponse = "";
    let streamFailed = false;
    let streamError = null;
    try {
      assistantResponse = await streamAssistant(res, contents);
    } catch (streamErr) {
      streamFailed = true;
      streamError = streamErr;
      console.error("[chat] stream edit:", streamErr);
      if (!res.writableEnded) {
        res.write("\n\n[Error generating response. Please try again.]");
      }
    }

    res.end();

    if (assistantResponse) {
      await Promise.all([
        chatService.addMessage({
          chatId: mongoId,
          userId,
          role: "assistant",
          content: assistantResponse,
          requestId,
        }),
        chatService.touchChat(mongoId),
      ]);
    } else if (streamFailed) {
      console.error("[chat] editMessage fallback persisted:", {
        sessionId,
        requestId,
        reason: String(streamError?.message || "").slice(0, 200),
      });
      try {
        await chatService.addMessage({
          chatId: mongoId,
          userId,
          role: "assistant",
          content: "[Error generating response. Please try again.]",
          requestId,
        });
      } catch (persistErr) {
        console.error(
          "[chat] editMessage fallback persist failed:",
          persistErr,
        );
      }
    }
  } catch (error) {
    console.error("[chat] editMessage:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
};

/**
 * PATCH /api/chat/:chatId/message/:messageId — update message text without re-generation
 */
exports.updateMessage = async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const { content, attachments } = req.body;
    const userId = req.user.uid;

    const chat = await chatService.assertChatOwner(chatId, userId);
    if (!chat) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Scope-check the target message to this chat BEFORE we mutate it —
    // otherwise the in-place update can touch a row that belongs to a
    // different chat (and the trailing chat-scope check would only catch
    // it after the side-effect).
    const target = await chatService.findMessageById(chat._id, messageId);
    if (!target) {
      return res.status(404).json({ message: "Message not found" });
    }

    const msg = await chatService.updateMessageContent(
      messageId,
      content,
      attachments,
    );
    if (!msg || String(msg.chatId) !== String(chat._id)) {
      return res.status(404).json({ message: "Message not found" });
    }

    res.json({
      id: String(msg._id),
      role: msg.role,
      content: msg.content,
      attachments: msg.attachments || [],
      requestId: msg.requestId || null,
    });
  } catch (error) {
    console.error("[chat] updateMessage:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * DELETE /api/chat/:chatId/message/:messageId
 */
exports.deleteMessage = async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const userId = req.user.uid;

    const chat = await chatService.assertChatOwner(chatId, userId);
    if (!chat) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const Message = require("../models/Message.model");
    const deleted = await Message.findOneAndDelete({
      _id: messageId,
      chatId: chat._id,
    }).lean();

    if (!deleted) {
      return res.status(404).json({ message: "Message not found" });
    }

    await chatService.touchChat(chat._id);
    res.json({ message: "Message deleted", id: String(deleted._id) });
  } catch (error) {
    console.error("[chat] deleteMessage:", error);
    res.status(500).json({ message: error.message });
  }
};
