const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");
const {
  createChatAndStream,
  getUserChats,
  getChatMessages,
  deleteChat,
  continueChat,
  uploadFile,
  editMessage,
  getFile,
} = require("../controllers/chat.controller");

router.post("/new", protect, createChatAndStream);
router.get("/all", protect, getUserChats);
router.get("/:chatId", protect, getChatMessages);
router.delete("/:chatId", protect, deleteChat);
router.post("/:chatId/continue", protect, continueChat);
router.post("/upload", protect, upload.single("file"), uploadFile);
router.get("/files/:fileId", getFile); // No protect here so images can be loaded in browser if needed, or you can add it
router.put("/:chatId/edit/:messageId", protect, editMessage);

module.exports = router;
