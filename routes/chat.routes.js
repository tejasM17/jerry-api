"use strict";

const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.switch");
const requireMongo = require("../middleware/mongo.middleware");
const upload = require("../middleware/upload.middleware");
const {
  createSession,
  createChatAndStream,
  getUserChats,
  getChatMessages,
  deleteChat,
  continueChat,
  uploadFile,
  editMessage,
  getFile,
  getRecentChats,
  searchChats,
  renameChat,
  updateMessage,
  deleteMessage,
} = require("../controllers/chat.controller");

/**
 * Per-request logger for the chat router. Logs every request start/end
 * and any error that bubbles out of a handler so the
 * "[Error generating response. Please try again.]" fallback in the
 * controller is never silent. Time format matches the rest of the API.
 */
router.use((req, res, next) => {
  const start = Date.now();
  const tag = `[chat] ${req.method} ${req.originalUrl || req.url}`;
  console.log(`${tag} start uid=${req.user?.uid || "anon"}`);

  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const line = `${tag} → ${status} ${ms}ms uid=${req.user?.uid || "anon"}`;
    if (status >= 500) console.error(line);
    else if (status >= 400) console.warn(line);
    else console.log(line);
  });

  next();
});

// Static paths before /:chatId (sessionId UUID or legacy ObjectId)
router.post("/session", protect, requireMongo, createSession);
router.post("/new", protect, requireMongo, createChatAndStream);
router.get("/all", protect, requireMongo, getUserChats);
router.get("/recent", protect, requireMongo, getRecentChats);
router.get("/search", protect, requireMongo, searchChats);
router.post("/upload", protect, requireMongo, upload.single("file"), uploadFile);
router.get("/files/:fileId", requireMongo, getFile);

// :chatId accepts public sessionId (UUID) or legacy Mongo ObjectId
router.get("/:chatId", protect, requireMongo, getChatMessages);
router.delete("/:chatId", protect, requireMongo, deleteChat);
router.patch("/:chatId/rename", protect, requireMongo, renameChat);
router.post("/:chatId/continue", protect, requireMongo, continueChat);
router.put("/:chatId/edit/:messageId", protect, requireMongo, editMessage);
router.patch("/:chatId/message/:messageId", protect, requireMongo, updateMessage);
router.delete(
  "/:chatId/message/:messageId",
  protect,
  requireMongo,
  deleteMessage,
);

module.exports = router;
