"use strict";

const { clerkClient } = require("../config/clerk");
const User = require("../models/User.model");

/**
 * GET /api/auth/me
 * Returns the current Clerk user profile (for frontend bootstrap after login).
 */
exports.getProfile = async (req, res) => {
  try {
    const clerkUserId = req.user.clerkId;
    const user = await clerkClient.users.getUser(clerkUserId);

    const primaryEmail =
      user.emailAddresses?.find((e) => e.id === user.primaryEmailAddressId)
        ?.emailAddress ||
      user.emailAddresses?.[0]?.emailAddress ||
      null;

    res.json({
      uid: req.user.uid,
      clerkId: user.id,
      externalId: user.externalId || null,
      email: primaryEmail,
      displayName:
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.username ||
        null,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      username: user.username || null,
      photoURL: user.imageUrl || null,
    });
  } catch (error) {
    console.error("[auth] getProfile:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /api/auth/sync
 * Upsert a lightweight Mongo user profile after Clerk sign-in/sign-up.
 */
exports.syncUser = async (req, res) => {
  try {
    const clerkUserId = req.user.clerkId;
    const appUserId = req.user.uid;

    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const primaryEmail =
      clerkUser.emailAddresses?.find(
        (e) => e.id === clerkUser.primaryEmailAddressId,
      )?.emailAddress ||
      clerkUser.emailAddresses?.[0]?.emailAddress ||
      req.body?.email ||
      null;

    const username =
      req.body?.username ||
      clerkUser.username ||
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      (primaryEmail ? primaryEmail.split("@")[0] : "user");

    const update = {
      clerkId: clerkUserId,
      externalId: clerkUser.externalId || null,
      email: primaryEmail,
      username,
      photoURL: clerkUser.imageUrl || null,
    };

    if (!primaryEmail) {
      return res.status(400).json({
        message: "Clerk user has no email; cannot sync profile",
      });
    }

    const orQuery = [{ clerkId: clerkUserId }, { uid: appUserId }];
    if (primaryEmail) orQuery.push({ email: primaryEmail });

    let user = null;
    try {
      user = await User.findOneAndUpdate(
        { $or: orQuery },
        {
          $set: update,
          $setOnInsert: { uid: appUserId },
        },
        { upsert: true, new: true, runValidators: true },
      );
    } catch (mongoErr) {
      console.warn("[auth] syncUser mongo skipped:", mongoErr.message);
      return res.json({
        uid: appUserId,
        clerkId: clerkUserId,
        externalId: clerkUser.externalId || null,
        email: primaryEmail,
        username,
        photoURL: clerkUser.imageUrl || null,
        mongo: false,
      });
    }

    res.json({
      uid: user.uid,
      clerkId: user.clerkId,
      externalId: user.externalId,
      email: user.email,
      username: user.username,
      photoURL: user.photoURL,
    });
  } catch (error) {
    console.error("[auth] syncUser:", error.message);
    res.status(500).json({ message: error.message });
  }
};
