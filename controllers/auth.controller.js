"use strict";

const User = require("../models/User.model");

/** GET /api/auth/me – returns basic Firebase-authenticated user info */
exports.getProfile = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthenticated" });
    // Optionally fetch from DB for richer profile
    const dbUser = await User.findOne({ uid });
    res.json({ uid, email: req.user.email, ...(dbUser || {}) });
  } catch (error) {
    console.error("[auth] getProfile:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/** POST /api/auth/sync – upserts a user profile using Firebase uid */
exports.syncUser = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ message: "Unauthenticated" });
    const email = req.user.email || `${uid}@users.noreply.firebase`;
    const displayName = req.user.displayName || email.split("@")[0];
    const photoURL = req.user.photoURL || null;
    const update = {
      uid,
      email,
      username: displayName,
      fullName: displayName,
      photoURL,
    };
    const user = await User.findOneAndUpdate(
      { uid },
      { $set: update, $setOnInsert: { clerkId: `firebase:${uid}` } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.json(user);
  } catch (error) {
    console.error("[auth] syncUser:", error.message);
    res.status(500).json({ message: error.message });
  }
};
