const { db } = require("../config/firebase");
const { getGridFSBucket } = require("../config/db");
const mongoose = require("mongoose");
const { Readable } = require("stream");
const {
  streamGeminiResponse,
  generateTitleFromPrompt,
} = require("../services/gemini.service");
const { fetchAndFormatAttachments } = require("../utils/geminiHelper");
const { withRetry } = require("../config/gemini");
const systemPrompt = require("../utils/systemPrompt");

exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const bucket = getGridFSBucket();
    const fileName = `${Date.now()}_${req.file.originalname}`;

    const uploadStream = bucket.openUploadStream(fileName, {
      contentType: req.file.mimetype,
      metadata: { originalName: req.file.originalname },
    });

    const readableStream = new Readable();
    readableStream.push(req.file.buffer);
    readableStream.push(null);

    readableStream.pipe(uploadStream);

    uploadStream.on("error", (error) => {
      console.error(error);
      res.status(500).json({ message: "Upload failed" });
    });

    uploadStream.on("finish", () => {
      res.json({
        fileId: uploadStream.id,
        url: `/api/chat/files/${uploadStream.id}`,
        mimeType: req.file.mimetype,
        name: req.file.originalname,
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

exports.getFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const bucket = getGridFSBucket();

    const files = await bucket.find({ _id: new mongoose.Types.ObjectId(fileId) }).toArray();
    if (!files || files.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    const file = files[0];
    res.set("Content-Type", file.contentType);
    res.set("Content-Disposition", `inline; filename="${file.filename}"`);

    const downloadStream = bucket.openDownloadStream(new mongoose.Types.ObjectId(fileId));
    downloadStream.pipe(res);

    downloadStream.on("error", (error) => {
      console.error(error);
      res.status(404).json({ message: "Error downloading file" });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

exports.createChatAndStream = async (req, res) => {
  try {
    const { prompt, attachments } = req.body;
    const userId = req.user.uid;

    if (!prompt) return res.status(400).json({ message: "Prompt required" });

    // 1️⃣ Generate AI title
    const title = await generateTitleFromPrompt(prompt);

    // 2️⃣ Create Chat
    const chatRef = await db.collection("chats").add({
      userId,
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = chatRef.id;

    // Send chatId to frontend
    res.setHeader("X-Chat-Id", chatId);

    // 3️⃣ Store User Message
    await db.collection("messages").add({
      chatId,
      userId,
      role: "user",
      content: prompt,
      attachments: attachments || [],
      createdAt: new Date(),
    });

    // 4️⃣ Set streaming headers
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    // Format parts for Gemini
    const attachmentParts = await fetchAndFormatAttachments(attachments);
    const formattedHistory = [
      {
        role: "user",
        parts: [{ text: prompt }, ...attachmentParts],
      },
    ];

    let assistantResponse = "";

    await withRetry(async (model) => {
      const result = await model.generateContentStream({
        systemInstruction: {
          role: "system",
          parts: [{ text: systemPrompt }],
        },
        contents: formattedHistory,
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        assistantResponse += text;
        res.write(text);
      }
    });

    res.end();

    // 5️⃣ Save Assistant Message
    await db.collection("messages").add({
      chatId,
      userId,
      role: "assistant",
      content: assistantResponse,
      createdAt: new Date(),
    });

    // Update chat updatedAt
    await db.collection("chats").doc(chatId).update({
      updatedAt: new Date(),
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    } else {
      res.end();
    }
  }
};

exports.getUserChats = async (req, res) => {
  try {
    const userId = req.user.uid;

    const snapshot = await db
      .collection("chats")
      .where("userId", "==", userId)
      .orderBy("updatedAt", "desc")
      .get();

    const chats = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    console.log("Fetching chats for:", userId);

    res.json(chats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.uid;

    // Verify ownership
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists || chatDoc.data().userId !== userId) {
      return res.status(403).json({ message: "Unauthorized to access this chat" });
    }

    const snapshot = await db
      .collection("messages")
      .where("chatId", "==", chatId)
      .orderBy("createdAt", "asc")
      .get();

    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.uid;

    // Verify ownership
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists || chatDoc.data().userId !== userId) {
      return res.status(403).json({ message: "Unauthorized to delete this chat" });
    }

    // Delete messages
    const messagesSnapshot = await db
      .collection("messages")
      .where("chatId", "==", chatId)
      .get();

    const batch = db.batch();

    messagesSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    batch.delete(db.collection("chats").doc(chatId));

    await batch.commit();

    res.json({ message: "Chat deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.continueChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { prompt, attachments } = req.body;
    const userId = req.user.uid;

    if (!chatId) return res.status(400).json({ message: "Chat ID required" });

    // Verify ownership
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists || chatDoc.data().userId !== userId) {
      return res.status(403).json({ message: "Unauthorized to continue this chat" });
    }

    // 1️⃣ Save user message
    await db.collection("messages").add({
      chatId,
      userId,
      role: "user",
      content: prompt,
      attachments: attachments || [],
      createdAt: new Date(),
    });

    // 2️⃣ Get previous messages
    const snapshot = await db
      .collection("messages")
      .where("chatId", "==", chatId)
      .orderBy("createdAt", "asc")
      .get();

    const history = snapshot.docs.map((doc) => doc.data());

    // 3️⃣ Format for Gemini (Support Multimodal)
    const formattedHistory = await Promise.all(
      history.map(async (msg) => {
        const parts = [{ text: msg.content }];
        if (msg.role === "user" && msg.attachments && msg.attachments.length > 0) {
          const attachmentParts = await fetchAndFormatAttachments(msg.attachments);
          parts.push(...attachmentParts);
        }
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts,
        };
      })
    );

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    let assistantResponse = "";

    await withRetry(async (model) => {
      const result = await model.generateContentStream({
        systemInstruction: {
          role: "system",
          parts: [{ text: systemPrompt }],
        },
        contents: formattedHistory,
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        assistantResponse += text;
        res.write(text);
      }
    });

    res.end();

    // 4️⃣ Save assistant response
    await db.collection("messages").add({
      chatId,
      userId,
      role: "assistant",
      content: assistantResponse,
      createdAt: new Date(),
    });

    // 5️⃣ Update chat updatedAt
    await db.collection("chats").doc(chatId).update({
      updatedAt: new Date(),
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    } else {
      res.end();
    }
  }
};

exports.editMessage = async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const { prompt, attachments } = req.body;
    const userId = req.user.uid;

    if (!prompt) return res.status(400).json({ message: "Prompt required" });

    // 1️⃣ Verify ownership and fetch message
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists || chatDoc.data().userId !== userId) {
      return res.status(403).json({ message: "Unauthorized to edit this chat" });
    }

    const messageDoc = await db.collection("messages").doc(messageId).get();
    if (!messageDoc.exists || messageDoc.data().chatId !== chatId) {
      return res.status(404).json({ message: "Message not found" });
    }

    const targetCreatedAt = messageDoc.data().createdAt;

    // 2️⃣ Delete subsequent messages (History Truncation)
    const snapshotToDelete = await db
      .collection("messages")
      .where("chatId", "==", chatId)
      .where("createdAt", ">", targetCreatedAt)
      .get();

    const batch = db.batch();
    snapshotToDelete.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    // 3️⃣ Update the edited message
    await db.collection("messages").doc(messageId).update({
      content: prompt,
      attachments: attachments || [],
      updatedAt: new Date(),
    });

    // 4️⃣ Fetch new history for re-generation
    const snapshot = await db
      .collection("messages")
      .where("chatId", "==", chatId)
      .orderBy("createdAt", "asc")
      .get();

    const history = snapshot.docs.map((doc) => doc.data());

    // 5️⃣ Format for Gemini
    const formattedHistory = await Promise.all(
      history.map(async (msg) => {
        const parts = [{ text: msg.content }];
        if (msg.role === "user" && msg.attachments && msg.attachments.length > 0) {
          const attachmentParts = await fetchAndFormatAttachments(msg.attachments);
          parts.push(...attachmentParts);
        }
        return {
          role: msg.role === "assistant" ? "model" : "user",
          parts,
        };
      })
    );

    // 6️⃣ Stream response
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    let assistantResponse = "";

    await withRetry(async (model) => {
      const result = await model.generateContentStream({
        systemInstruction: {
          role: "system",
          parts: [{ text: systemPrompt }],
        },
        contents: formattedHistory,
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        assistantResponse += text;
        res.write(text);
      }
    });

    res.end();

    // 7️⃣ Save new assistant response
    await db.collection("messages").add({
      chatId,
      userId,
      role: "assistant",
      content: assistantResponse,
      createdAt: new Date(),
    });

    // 8️⃣ Update chat updatedAt
    await db.collection("chats").doc(chatId).update({
      updatedAt: new Date(),
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    } else {
      res.end();
    }
  }
};

exports.getRecentChats = async (req, res) => {
  try {
    const userId = req.user.uid;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const snapshot = await db
      .collection("chats")
      .where("userId", "==", userId)
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();

    const chats = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        updatedAt: data.updatedAt,
      };
    });

    res.json(chats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

exports.searchChats = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { q } = req.query;

    if (!q || !q.trim()) {
      return res.status(400).json({ message: "Search query required" });
    }

    const query = q.trim().toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const snapshot = await db
      .collection("chats")
      .where("userId", "==", userId)
      .orderBy("updatedAt", "desc")
      .limit(200)
      .get();

    const chats = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          updatedAt: data.updatedAt,
        };
      })
      .filter((chat) => chat.title && chat.title.toLowerCase().includes(query))
      .slice(0, limit);

    res.json(chats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

