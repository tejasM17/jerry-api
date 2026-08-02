"use strict";

const { randomUUID } = require("crypto");
const mongoose = require("mongoose");

/**
 * Chat window / session owned by an app user (req.user.uid).
 *
 * Public URL id is `sessionId` (UUID), Grok/ChatGPT style:
 *   /c/{sessionId}
 * Mongo `_id` stays internal for message FK and storage.
 */
const chatSchema = new mongoose.Schema(
  {
    /** Public conversation id — stable, shareable, URL-safe UUID */
    sessionId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => randomUUID(),
      validate: {
        validator(v) {
          if (v == null || v === "") return true; // legacy rows before backfill
          return (
            typeof v === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              v,
            )
          );
        },
        message: "sessionId must be a UUID",
      },
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      default: "New chat",
    },
    /** Soft delete — list endpoints filter deletedAt: null */
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        // Public id is always sessionId (not Mongo ObjectId)
        ret.id = ret.sessionId || String(ret._id);
        delete ret.__v;
        return ret;
      },
    },
  },
);

chatSchema.index({ userId: 1, updatedAt: -1 });
chatSchema.index({ userId: 1, deletedAt: 1, updatedAt: -1 });
chatSchema.index({ userId: 1, title: "text" });

module.exports = mongoose.model("Chat", chatSchema);
