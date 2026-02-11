const express = require("express");
const router = express.Router();
const protect = require("../middleware/auth.middleware");
const {
  createChatAndStream,
  getUserChats,
  getChatMessages,
  deleteChat,
  continueChat,
} = require("../controllers/chat.controller");

router.post("/new", protect, createChatAndStream);
router.get("/all", protect, getUserChats);
router.get("/:chatId", protect, getChatMessages);
router.delete("/:chatId", protect, deleteChat);
router.post("/:chatId/continue", protect, continueChat);

module.exports = router;
