"use strict";
const User = require("../models/User.model");

/** GET /api/profile – returns combined Firebase auth info and stored Mongo profile */
exports.getProfile = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthenticated" });
    const dbUser = await User.findOne({ uid });
    res.json({ uid, email: req.user.email, ...(dbUser || {}) });
  } catch (error) {
    console.error("[profile] getProfile:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/** PUT /api/profile – updates allowed fields in Mongo profile */
exports.updateProfile = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthenticated" });
    const updates = {};
    const allowed = ["fullName", "username", "bio", "phone", "socialLinks", "photoURL"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const user = await User.findOneAndUpdate({ uid }, { $set: updates }, { new: true, upsert: true });
    res.json(user);
  } catch (error) {
    console.error("[profile] updateProfile:", error.message);
    res.status(500).json({ message: error.message });
  }
};

// Delete profile: remove user document from Mongo
exports.deleteProfile = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthenticated" });
    await User.findOneAndDelete({ uid });
    // Note: Firebase auth deletion not performed here.
    res.json({ message: "Profile deleted" });
  } catch (error) {
    console.error("[profile] deleteProfile:", error.message);
    res.status(500).json({ message: error.message });
  }
};

// Upload avatar: expects file processed by multer, set photoURL (placeholder)
exports.uploadAvatar = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthenticated" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const photoURL = `/uploads/${req.file.filename}`;
    const user = await User.findOneAndUpdate({ uid }, { $set: { photoURL } }, { new: true, upsert: true });
    res.json({ photoURL, user });
  } catch (error) {
    console.error("[profile] uploadAvatar:", error.message);
    res.status(500).json({ message: error.message });
  }
};

// Check if username is available
exports.checkUsername = async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ message: "Username query param required" });
    const exists = await User.exists({ username });
    res.json({ available: !exists });
  } catch (error) {
    console.error("[profile] checkUsername:", error.message);
    res.status(500).json({ message: error.message });
  }
};

// Revoke all sessions placeholder
exports.revokeAllSessions = async (req, res) => {
  // In a real implementation, you'd revoke Firebase tokens.
  res.json({ message: "All sessions revoked (placeholder)" });
};
