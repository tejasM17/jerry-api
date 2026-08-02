"use strict";

const mongoose = require("mongoose");

/**
 * App user profile (Mongo).
 * Auth identity lives in Clerk; this document stores app-facing profile data.
 *
 * uid: ownership key for chats/messages (Clerk externalId || clerk id)
 * clerkId: Clerk user id (user_...)
 * externalId: optional legacy id when migrated from another auth provider
 */
const socialLinksSchema = new mongoose.Schema(
  {
    twitter: { type: String, default: null, trim: true },
    linkedin: { type: String, default: null, trim: true },
    github: { type: String, default: null, trim: true },
    website: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    uid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    clerkId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    externalId: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    fullName: {
      type: String,
      default: null,
      trim: true,
    },
    bio: {
      type: String,
      default: null,
      maxlength: 500,
      trim: true,
    },
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    socialLinks: {
      type: socialLinksSchema,
      default: () => ({}),
    },
    photoURL: {
      type: String,
      default: null,
    },
    avatarFileId: {
      type: String,
      default: null,
    },
    /** Soft-delete marker — account deletion request / deactivated profile */
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    // Legacy field — no longer used for auth (Clerk owns passwords).
    // Kept optional so old documents remain readable.
    password: {
      type: String,
      required: false,
      select: false,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
