"use strict";

const express = require("express");
const protect = require("../middleware/auth.switch");
const upload = require("../middleware/upload.middleware");
const {
  getProfile,
  updateProfile,
  uploadAvatar,
  deleteProfile,
  checkUsername,
  revokeAllSessions,
} = require("../controllers/profile.controller");

const router = express.Router();

// All profile routes require a valid Firebase ID token.
router.get("/", protect, getProfile);
router.put("/", protect, updateProfile);
router.delete("/", protect, deleteProfile);
router.post("/avatar", protect, upload.single("file"), uploadAvatar);
router.get("/username-available", protect, checkUsername);
router.post("/revoke-sessions", protect, revokeAllSessions);

module.exports = router;
