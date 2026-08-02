"use strict";

const { Readable } = require("stream");
const mongoose = require("mongoose");
const { clerkClient } = require("../config/clerk");
const { getGridFSBucket } = require("../config/db");
const User = require("../models/User.model");

const BIO_MAX = 500;
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,30}$/;

function primaryEmailOf(clerkUser) {
  return (
    clerkUser.emailAddresses?.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ||
    clerkUser.emailAddresses?.[0]?.emailAddress ||
    null
  );
}

function displayNameOf(clerkUser) {
  return (
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    clerkUser.username ||
    null
  );
}

function authMethodOf(clerkUser) {
  const external = clerkUser.externalAccounts || [];
  if (external.some((a) => a.provider === "google" || a.provider === "oauth_google")) {
    return "Google";
  }
  return "Email";
}

function publicMeta(clerkUser) {
  return clerkUser.publicMetadata && typeof clerkUser.publicMetadata === "object"
    ? clerkUser.publicMetadata
    : {};
}

/**
 * Merge Clerk identity + Mongo app profile into one response shape.
 */
function shapeProfile(clerkUser, mongoUser, appUid) {
  const meta = publicMeta(clerkUser);
  const socialFromMeta = meta.socialLinks || {};
  const socialFromMongo = mongoUser?.socialLinks?.toObject
    ? mongoUser.socialLinks.toObject()
    : mongoUser?.socialLinks || {};

  return {
    uid: appUid,
    clerkId: clerkUser.id,
    externalId: clerkUser.externalId || mongoUser?.externalId || null,
    email: primaryEmailOf(clerkUser),
    fullName:
      mongoUser?.fullName ||
      displayNameOf(clerkUser) ||
      null,
    firstName: clerkUser.firstName || null,
    lastName: clerkUser.lastName || null,
    username: clerkUser.username || mongoUser?.username || null,
    bio: mongoUser?.bio ?? meta.bio ?? null,
    phone: mongoUser?.phone ?? meta.phone ?? null,
    socialLinks: {
      twitter: socialFromMongo.twitter ?? socialFromMeta.twitter ?? null,
      linkedin: socialFromMongo.linkedin ?? socialFromMeta.linkedin ?? null,
      github: socialFromMongo.github ?? socialFromMeta.github ?? null,
      website: socialFromMongo.website ?? socialFromMeta.website ?? null,
    },
    photoURL:
      mongoUser?.photoURL || clerkUser.imageUrl || null,
    avatarFileId: mongoUser?.avatarFileId || null,
    authMethod: authMethodOf(clerkUser),
    createdAt: clerkUser.createdAt
      ? new Date(clerkUser.createdAt).toISOString()
      : mongoUser?.createdAt?.toISOString?.() || null,
    updatedAt: mongoUser?.updatedAt?.toISOString?.() || null,
    deletedAt: mongoUser?.deletedAt?.toISOString?.() || null,
  };
}

function isMongoReady() {
  return mongoose.connection?.readyState === 1;
}

/**
 * Load or create Mongo profile. Returns null when Mongo is down so Clerk-only
 * identity still works (chat uses Firestore; profile UI may use Clerk modal).
 */
async function findOrBootstrapMongo(req, clerkUser) {
  if (!isMongoReady()) {
    return null;
  }

  const clerkUserId = req.user.clerkId;
  const appUserId = req.user.uid;
  const email = primaryEmailOf(clerkUser);

  try {
    let mongoUser = await User.findOne({
      $or: [{ clerkId: clerkUserId }, { uid: appUserId }],
    });

    if (!mongoUser && email) {
      const username =
        clerkUser.username ||
        displayNameOf(clerkUser) ||
        email.split("@")[0] ||
        "user";

      try {
        mongoUser = await User.findOneAndUpdate(
          { $or: [{ clerkId: clerkUserId }, { uid: appUserId }, { email }] },
          {
            $set: {
              clerkId: clerkUserId,
              externalId: clerkUser.externalId || null,
              email,
              username,
              fullName: displayNameOf(clerkUser),
              photoURL: clerkUser.imageUrl || null,
            },
            $setOnInsert: { uid: appUserId },
          },
          { upsert: true, new: true, runValidators: true },
        );
      } catch (err) {
        // Race / duplicate key — re-read
        mongoUser = await User.findOne({
          $or: [{ clerkId: clerkUserId }, { uid: appUserId }, { email }],
        });
        if (!mongoUser) {
          console.warn("[profile] mongo bootstrap:", err.message);
          return null;
        }
      }
    }

    return mongoUser;
  } catch (err) {
    console.warn("[profile] mongo unavailable:", err.message);
    return null;
  }
}

/**
 * GET /api/profile
 */
exports.getProfile = async (req, res) => {
  try {
    const clerkUser = await clerkClient.users.getUser(req.user.clerkId);
    const mongoUser = await findOrBootstrapMongo(req, clerkUser);

    if (mongoUser?.deletedAt) {
      return res.status(410).json({
        message: "Account is deleted or deactivation is pending",
        deletedAt: mongoUser.deletedAt,
      });
    }

    res.json(shapeProfile(clerkUser, mongoUser, req.user.uid));
  } catch (error) {
    console.error("[profile] getProfile:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/**
 * PUT /api/profile
 * Body: { fullName, username, bio, phone, socialLinks, photoURL }
 * Updates go through backend → Clerk + Mongo (never FE Clerk for sensitive fields alone).
 */
exports.updateProfile = async (req, res) => {
  try {
    const body = req.body || {};
    const clerkUserId = req.user.clerkId;

    let clerkUser = await clerkClient.users.getUser(clerkUserId);
    let mongoUser = await findOrBootstrapMongo(req, clerkUser);

    if (mongoUser?.deletedAt) {
      return res.status(410).json({ message: "Account is deleted" });
    }

    const clerkUpdate = {};
    const meta = { ...publicMeta(clerkUser) };
    let metaDirty = false;

    // Full name → first/last on Clerk + fullName on Mongo
    if (typeof body.fullName === "string") {
      const trimmed = body.fullName.trim().slice(0, 100);
      const parts = trimmed.split(/\s+/).filter(Boolean);
      clerkUpdate.firstName = parts[0] || null;
      clerkUpdate.lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
      if (mongoUser) mongoUser.fullName = trimmed || null;
    }

    // Username
    if (typeof body.username === "string") {
      const username = body.username.trim();
      if (!USERNAME_RE.test(username)) {
        return res.status(400).json({
          message:
            "Username must be 3–30 characters: letters, numbers, _ or -",
        });
      }
      if (username !== clerkUser.username) {
        // Availability check via Clerk
        try {
          const existing = await clerkClient.users.getUserList({
            username: [username],
            limit: 1,
          });
          const hit = existing?.data?.[0] || existing?.[0];
          if (hit && hit.id !== clerkUserId) {
            return res.status(409).json({ message: "Username is already taken" });
          }
        } catch (err) {
          // If list fails, still attempt update and let Clerk reject
          console.warn("[profile] username check:", err.message);
        }
        clerkUpdate.username = username;
      }
      if (mongoUser) mongoUser.username = username;
    }

    // Bio
    if (body.bio !== undefined) {
      const bio =
        body.bio === null || body.bio === ""
          ? null
          : String(body.bio).trim().slice(0, BIO_MAX);
      if (mongoUser) mongoUser.bio = bio;
      meta.bio = bio;
      metaDirty = true;
    }

    // Phone (optional)
    if (body.phone !== undefined) {
      const phone =
        body.phone === null || body.phone === ""
          ? null
          : String(body.phone).trim().slice(0, 30);
      if (mongoUser) mongoUser.phone = phone;
      meta.phone = phone;
      metaDirty = true;
    }

    // Social links
    if (body.socialLinks && typeof body.socialLinks === "object") {
      const keys = ["twitter", "linkedin", "github", "website"];
      const next = {
        ...(mongoUser?.socialLinks?.toObject
          ? mongoUser.socialLinks.toObject()
          : mongoUser?.socialLinks || {}),
      };
      for (const k of keys) {
        if (body.socialLinks[k] !== undefined) {
          const v = body.socialLinks[k];
          next[k] =
            v === null || v === "" ? null : String(v).trim().slice(0, 200);
        }
      }
      if (mongoUser) mongoUser.socialLinks = next;
      meta.socialLinks = next;
      metaDirty = true;
    }

    // Avatar URL (when client sends a URL rather than file upload)
    if (typeof body.photoURL === "string" || body.photoURL === null) {
      const photoURL =
        body.photoURL === null || body.photoURL === ""
          ? null
          : String(body.photoURL).trim();
      if (mongoUser) {
        mongoUser.photoURL = photoURL;
        if (!photoURL) mongoUser.avatarFileId = null;
      }
    }

    if (metaDirty) {
      clerkUpdate.publicMetadata = meta;
    }

    if (Object.keys(clerkUpdate).length > 0) {
      clerkUser = await clerkClient.users.updateUser(clerkUserId, clerkUpdate);
    }

    if (mongoUser) {
      try {
        await mongoUser.save();
      } catch (err) {
        console.warn("[profile] mongo save skipped:", err.message);
        mongoUser = null;
      }
    }

    // Re-fetch for fresh imageUrl etc.
    clerkUser = await clerkClient.users.getUser(clerkUserId);
    if (mongoUser) {
      try {
        mongoUser = await User.findById(mongoUser._id);
      } catch {
        mongoUser = null;
      }
    }

    res.json(shapeProfile(clerkUser, mongoUser, req.user.uid));
  } catch (error) {
    console.error("[profile] updateProfile:", error.message);
    const status =
      error?.status || error?.statusCode || (error?.errors ? 400 : 500);
    const message =
      error?.errors?.[0]?.longMessage ||
      error?.errors?.[0]?.message ||
      error.message;
    res.status(typeof status === "number" ? status : 500).json({ message });
  }
};

/**
 * POST /api/profile/avatar
 * multipart field `file` OR JSON `{ photoURL }`
 * Stores image in GridFS and updates Mongo + Clerk public image when possible.
 */
exports.uploadAvatar = async (req, res) => {
  try {
    const clerkUserId = req.user.clerkId;
    let clerkUser = await clerkClient.users.getUser(clerkUserId);
    let mongoUser = await findOrBootstrapMongo(req, clerkUser);

    if (mongoUser?.deletedAt) {
      return res.status(410).json({ message: "Account is deleted" });
    }

    // URL-only path
    if (!req.file && req.body?.photoURL) {
      const photoURL = String(req.body.photoURL).trim();
      if (mongoUser) {
        mongoUser.photoURL = photoURL;
        mongoUser.avatarFileId = null;
        await mongoUser.save();
      }
      const meta = { ...publicMeta(clerkUser), photoURL };
      clerkUser = await clerkClient.users.updateUser(clerkUserId, {
        publicMetadata: meta,
      });
      return res.json(shapeProfile(clerkUser, mongoUser, req.user.uid));
    }

    // Remove avatar
    if (!req.file && (req.body?.remove === true || req.body?.remove === "true")) {
      if (mongoUser) {
        mongoUser.photoURL = null;
        mongoUser.avatarFileId = null;
        await mongoUser.save();
      }
      try {
        await clerkClient.users.deleteUserProfileImage(clerkUserId);
      } catch (err) {
        console.warn("[profile] deleteUserProfileImage:", err.message);
      }
      clerkUser = await clerkClient.users.getUser(clerkUserId);
      return res.json(shapeProfile(clerkUser, mongoUser, req.user.uid));
    }

    if (!req.file) {
      return res.status(400).json({
        message: "Provide multipart file, photoURL, or remove=true",
      });
    }

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(req.file.mimetype)) {
      return res.status(400).json({
        message: "Avatar must be JPEG, PNG, WebP, or GIF",
      });
    }

    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ message: "Avatar must be under 5MB" });
    }

    // Prefer Clerk profile image when GridFS/Mongo is unavailable
    if (!isMongoReady()) {
      try {
        const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
        await clerkClient.users.updateUserProfileImage(clerkUserId, {
          file: blob,
        });
      } catch (err) {
        console.error("[profile] Clerk-only avatar upload failed:", err.message);
        return res.status(500).json({
          message:
            "Avatar upload failed (MongoDB offline and Clerk image update failed)",
        });
      }
      clerkUser = await clerkClient.users.getUser(clerkUserId);
      return res.json(shapeProfile(clerkUser, null, req.user.uid));
    }

    let bucket;
    try {
      bucket = getGridFSBucket();
    } catch (err) {
      console.warn("[profile] GridFS unavailable, Clerk-only avatar:", err.message);
      try {
        const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
        await clerkClient.users.updateUserProfileImage(clerkUserId, {
          file: blob,
        });
        clerkUser = await clerkClient.users.getUser(clerkUserId);
        return res.json(shapeProfile(clerkUser, mongoUser, req.user.uid));
      } catch (e2) {
        return res.status(500).json({ message: e2.message });
      }
    }
    const fileName = `avatar_${clerkUserId}_${Date.now()}_${req.file.originalname}`;

    const uploadStream = bucket.openUploadStream(fileName, {
      contentType: req.file.mimetype,
      metadata: {
        originalName: req.file.originalname,
        clerkId: clerkUserId,
        kind: "avatar",
      },
    });

    const readableStream = new Readable();
    readableStream.push(req.file.buffer);
    readableStream.push(null);

    await new Promise((resolve, reject) => {
      readableStream.pipe(uploadStream);
      uploadStream.on("error", reject);
      uploadStream.on("finish", resolve);
    });

    const fileId = uploadStream.id.toString();
    const relativeUrl = `/api/chat/files/${fileId}`;

    // Best-effort: push binary to Clerk profile image for UserButton consistency
    try {
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
      await clerkClient.users.updateUserProfileImage(clerkUserId, {
        file: blob,
      });
    } catch (err) {
      console.warn("[profile] Clerk profile image update skipped:", err.message);
    }

    if (mongoUser) {
      // Delete previous GridFS avatar if we owned one
      if (mongoUser.avatarFileId) {
        try {
          await bucket.delete(
            new mongoose.Types.ObjectId(mongoUser.avatarFileId),
          );
        } catch {
          /* ignore missing prior file */
        }
      }
      mongoUser.avatarFileId = fileId;
      mongoUser.photoURL = relativeUrl;
      await mongoUser.save();
    }

    clerkUser = await clerkClient.users.getUser(clerkUserId);
    const profile = shapeProfile(clerkUser, mongoUser, req.user.uid);
    // Prefer our GridFS URL so SPA can resolve via API host
    profile.photoURL = relativeUrl;
    profile.avatarFileId = fileId;

    res.json(profile);
  } catch (error) {
    console.error("[profile] uploadAvatar:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /api/profile/username-available?username=
 */
exports.checkUsername = async (req, res) => {
  try {
    const username = String(req.query.username || "").trim();
    if (!USERNAME_RE.test(username)) {
      return res.json({ available: false, reason: "invalid" });
    }

    if (username === req.user?.sessionClaims?.username) {
      return res.json({ available: true, reason: "current" });
    }

    const clerkUser = await clerkClient.users.getUser(req.user.clerkId);
    if (clerkUser.username === username) {
      return res.json({ available: true, reason: "current" });
    }

    const existing = await clerkClient.users.getUserList({
      username: [username],
      limit: 1,
    });
    const hit = existing?.data?.[0] || existing?.[0];
    const available = !hit || hit.id === req.user.clerkId;
    res.json({ available, reason: available ? "ok" : "taken" });
  } catch (error) {
    console.error("[profile] checkUsername:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/**
 * DELETE /api/profile
 * Soft-delete Mongo row + ban Clerk user (blocks further sign-in).
 * Body optional: { hard: true } to fully delete Clerk user.
 */
exports.deleteProfile = async (req, res) => {
  try {
    const clerkUserId = req.user.clerkId;
    const hard = Boolean(req.body?.hard);

    const mongoUser = await User.findOne({
      $or: [{ clerkId: clerkUserId }, { uid: req.user.uid }],
    });

    if (mongoUser) {
      mongoUser.deletedAt = new Date();
      await mongoUser.save();
    }

    if (hard) {
      await clerkClient.users.deleteUser(clerkUserId);
      return res.json({
        ok: true,
        mode: "hard",
        message: "Account permanently deleted",
      });
    }

    // Soft: ban so sessions die and sign-in is blocked
    try {
      await clerkClient.users.banUser(clerkUserId);
    } catch (err) {
      console.warn("[profile] banUser:", err.message);
      // Fallback: revoke all sessions
      try {
        const sessions = await clerkClient.sessions.getSessionList({
          userId: clerkUserId,
          status: "active",
        });
        const list = sessions?.data || sessions || [];
        await Promise.all(
          list.map((s) =>
            clerkClient.sessions.revokeSession(s.id).catch(() => null),
          ),
        );
      } catch (e2) {
        console.warn("[profile] revoke sessions:", e2.message);
      }
    }

    res.json({
      ok: true,
      mode: "soft",
      deletedAt: mongoUser?.deletedAt?.toISOString?.() || new Date().toISOString(),
      message: "Account deactivation requested",
    });
  } catch (error) {
    console.error("[profile] deleteProfile:", error.message);
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /api/profile/revoke-sessions
 * Sign out of all devices (revoke every active Clerk session for this user).
 */
exports.revokeAllSessions = async (req, res) => {
  try {
    const clerkUserId = req.user.clerkId;
    const currentSessionId = req.user.sessionId;

    const sessions = await clerkClient.sessions.getSessionList({
      userId: clerkUserId,
      status: "active",
    });
    const list = sessions?.data || sessions || [];

    let revoked = 0;
    for (const s of list) {
      // Optionally keep current session so the user can finish the UI flow
      if (req.body?.keepCurrent && currentSessionId && s.id === currentSessionId) {
        continue;
      }
      try {
        await clerkClient.sessions.revokeSession(s.id);
        revoked += 1;
      } catch (err) {
        console.warn("[profile] revokeSession", s.id, err.message);
      }
    }

    res.json({ ok: true, revoked });
  } catch (error) {
    console.error("[profile] revokeAllSessions:", error.message);
    res.status(500).json({ message: error.message });
  }
};
