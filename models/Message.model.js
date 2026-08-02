"use strict";

const { randomUUID } = require("crypto");
const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    fileId: { type: String, default: null },
    url: { type: String, default: null },
    mimeType: { type: String, default: null },
    name: { type: String, default: null },
  },
  { _id: false },
);

/**
 * Individual message in a chat window.
 * Ordered by createdAt within chatId; compound index for fast history loads.
 *
 * `requestId` is the public turn id (Grok-style `?rid=`), set on user turns
 * and mirrored on the following assistant reply for deep-linking.
 */
const messageSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      index: true,
    },
    /** Public turn id for URL deep-links (?rid=) */
    requestId: {
      type: String,
      default: null,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: {
      type: String,
      required: true,
      default: "",
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        ret.id = String(ret._id);
        if (ret.chatId) ret.chatId = String(ret.chatId);
        delete ret.__v;
        return ret;
      },
    },
  },
);

messageSchema.index({ chatId: 1, createdAt: 1 });
messageSchema.index({ userId: 1, createdAt: -1 });
messageSchema.index({ chatId: 1, requestId: 1 });

/** Generate a new request id for a user turn */
messageSchema.statics.newRequestId = () => randomUUID();

module.exports = mongoose.model("Message", messageSchema);
