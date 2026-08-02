"use strict";

const { isMongoConnected } = require("../config/db");

/**
 * Reject chat/data routes early when Mongo is down (clearer than cryptic driver errors).
 */
function requireMongo(req, res, next) {
  if (!isMongoConnected()) {
    return res.status(503).json({
      message:
        "Database unavailable. Set MONGODB_PASSWORD (or a full MONGODB_URI) and restart the API.",
      mongo: "disconnected",
    });
  }
  return next();
}

module.exports = requireMongo;
