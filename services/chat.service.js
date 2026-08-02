"use strict";

const { randomUUID } = require("crypto");
const mongoose = require("mongoose");
const Chat = require("../models/Chat.model");
const Message = require("../models/Message.model");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidObjectId = (id) =>
  Boolean(id) && mongoose.Types.ObjectId.isValid(id) && String(id).length === 24;

const isValidSessionId = (id) => Boolean(id) && UUID_RE.test(String(id));

/**
 * Resolve a public chat ref (sessionId UUID) or legacy Mongo ObjectId
 * into an ownership filter for Chat.findOne.
 */
function chatRefFilter(chatRef) {
  const raw = String(chatRef || "").trim();
  if (!raw) return null;
  if (isValidSessionId(raw)) return { sessionId: raw };
  if (isValidObjectId(raw)) return { _id: raw };
  return null;
}

function toPublicChat(doc) {
  if (!doc) return null;
  return {
    id: doc.sessionId || String(doc._id),
    sessionId: doc.sessionId || String(doc._id),
    title: doc.title,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
  };
}

/**
 * Fast local title — avoid Gemini round-trip before first token streams.
 */
function titleFromPrompt(prompt) {
  const clean = String(prompt || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "New chat";
  const words = clean.split(" ").slice(0, 6);
  let title = words.join(" ");
  if (clean.split(" ").length > 6) title += "…";
  return title.slice(0, 80);
}

/**
 * Ensure legacy rows (pre-sessionId) get a public UUID once, then return lean chat.
 */
async function ensureSessionId(chat) {
  if (!chat) return null;
  if (chat.sessionId && isValidSessionId(chat.sessionId)) return chat;

  const sessionId = randomUUID();
  await Chat.updateOne(
    { _id: chat._id, $or: [{ sessionId: null }, { sessionId: { $exists: false } }] },
    { $set: { sessionId } },
  );
  return { ...chat, sessionId };
}

/**
 * Load chat owned by userId via sessionId (preferred) or ObjectId (legacy).
 * Returns lean doc with _id, sessionId, title, userId, updatedAt.
 */
async function assertChatOwner(chatRef, userId) {
  const ref = chatRefFilter(chatRef);
  if (!ref) return null;

  const chat = await Chat.findOne({
    ...ref,
    userId,
    deletedAt: null,
  })
    .select("_id sessionId userId title updatedAt createdAt")
    .lean();

  return ensureSessionId(chat);
}

async function listChats(userId, { limit = 100, projection = false } = {}) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const rows = await Chat.find({ userId, deletedAt: null })
    .sort({ updatedAt: -1 })
    .limit(cap)
    .select(
      projection
        ? "sessionId title updatedAt createdAt"
        : "sessionId title updatedAt createdAt",
    )
    .lean();

  return rows.map((c) => toPublicChat(c));
}

async function searchChats(userId, query, limit = 20) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const q = String(query || "").trim();
  if (!q) return [];

  let rows;
  try {
    rows = await Chat.find({
      userId,
      deletedAt: null,
      $text: { $search: q },
    })
      .sort({ updatedAt: -1 })
      .limit(cap)
      .select("sessionId title updatedAt")
      .lean();
  } catch {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    rows = await Chat.find({
      userId,
      deletedAt: null,
      title: re,
    })
      .sort({ updatedAt: -1 })
      .limit(cap)
      .select("sessionId title updatedAt")
      .lean();
  }

  return rows.map((c) => toPublicChat(c));
}

async function getMessages(chatRef, userId) {
  const chat = await assertChatOwner(chatRef, userId);
  if (!chat) return { error: "forbidden", status: 403 };

  const messages = await Message.find({ chatId: chat._id })
    .sort({ createdAt: 1 })
    .select("role content attachments requestId createdAt updatedAt")
    .lean();

  return {
    chat: toPublicChat(chat),
    messages: messages.map((m) => ({
      id: String(m._id),
      role: m.role,
      content: m.content,
      attachments: m.attachments || [],
      requestId: m.requestId || null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })),
  };
}

/**
 * Create a new chat session. Returns the Mongoose document
 * (use .sessionId for public id, ._id for message FK).
 */
async function createChat(userId, title, sessionId) {
  return Chat.create({
    userId,
    title: title || "New chat",
    sessionId: sessionId || randomUUID(),
  });
}

/**
 * Optionally mint an empty session (no messages) so the client can
 * navigate to /c/:sessionId before the first prompt — Grok-style.
 */
async function createEmptySession(userId, title = "New chat") {
  const chat = await createChat(userId, title);
  return toPublicChat(chat.toObject ? chat.toObject() : chat);
}

async function addMessage({
  chatId,
  userId,
  role,
  content,
  attachments,
  requestId,
}) {
  return Message.create({
    chatId,
    userId,
    role,
    content: content || "",
    attachments: attachments || [],
    requestId: requestId || null,
  });
}

async function touchChat(chatId) {
  return Chat.updateOne(
    { _id: chatId },
    { $set: { updatedAt: new Date() } },
  );
}

async function renameChat(chatRef, userId, title) {
  const next = String(title || "").trim().slice(0, 200);
  if (!next) return { error: "Title required", status: 400 };

  const ref = chatRefFilter(chatRef);
  if (!ref) return { error: "Invalid chat id", status: 400 };

  const updated = await Chat.findOneAndUpdate(
    { ...ref, userId, deletedAt: null },
    { $set: { title: next } },
    { returnDocument: "after" },
  )
    .select("sessionId title updatedAt createdAt")
    .lean();

  if (!updated) return { error: "Not found", status: 404 };
  return toPublicChat(updated);
}

async function softDeleteChat(chatRef, userId) {
  const ref = chatRefFilter(chatRef);
  if (!ref) return false;

  const chat = await Chat.findOne({ ...ref, userId, deletedAt: null })
    .select("_id")
    .lean();
  if (!chat) return false;

  await Message.deleteMany({ chatId: chat._id });
  await Chat.deleteOne({ _id: chat._id });
  return true;
}

/**
 * Read-only lookup of a single message scoped to a chat.
 * Returns the lean doc or null (also null when messageId is not a valid ObjectId).
 */
async function findMessageById(chatObjectId, messageId) {
  if (!isValidObjectId(messageId)) return null;
  return Message.findOne({ _id: messageId, chatId: chatObjectId }).lean();
}

/**
 * Truncate messages after (and including replace of) a user message for edit flow.
 * Caller MUST have already verified the target exists and is a user message;
 * this helper only enforces the chat-scope guard.
 */
async function truncateFromMessage(chatObjectId, messageId) {
  if (!isValidObjectId(messageId)) return null;

  const target = await Message.findOne({
    _id: messageId,
    chatId: chatObjectId,
  }).lean();
  if (!target) return null;

  await Message.deleteMany({
    chatId: chatObjectId,
    createdAt: { $gt: target.createdAt },
  });

  return target;
}

async function updateMessageContent(messageId, content, attachments) {
  return Message.findByIdAndUpdate(
    messageId,
    {
      $set: {
        content,
        attachments: attachments || [],
      },
    },
    { returnDocument: "after" },
  ).lean();
}

async function loadHistoryForGemini(chatObjectId) {
  return Message.find({ chatId: chatObjectId })
    .sort({ createdAt: 1 })
    .select("role content attachments")
    .lean();
}

function newRequestId() {
  return randomUUID();
}

module.exports = {
  titleFromPrompt,
  assertChatOwner,
  listChats,
  searchChats,
  getMessages,
  createChat,
  createEmptySession,
  addMessage,
  touchChat,
  renameChat,
  softDeleteChat,
  findMessageById,
  truncateFromMessage,
  updateMessageContent,
  loadHistoryForGemini,
  isValidObjectId,
  isValidSessionId,
  chatRefFilter,
  toPublicChat,
  newRequestId,
};
