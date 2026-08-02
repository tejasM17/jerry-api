"use strict";

const mongoose = require("mongoose");

let gfs;
let connected = false;

/**
 * Resolve MONGODB_URI; allow password injection via MONGODB_PASSWORD when
 * the URI still contains the Atlas placeholder `<db_password>`.
 */
function resolveMongoUri() {
  let uri = process.env.MONGODB_URI;
  if (!uri) return null;

  const password = process.env.MONGODB_PASSWORD;
  if (password && uri.includes("<db_password>")) {
    uri = uri.replace("<db_password>", encodeURIComponent(password));
  }

  // Ensure a default DB name when Atlas URI is host-only: ...mongodb.net/?ssl=
  // so chats land in `jerry` instead of the driver default.
  const dbName = process.env.MONGODB_DB_NAME || "jerry";
  try {
    if (uri.includes("mongodb.net/?")) {
      uri = uri.replace("mongodb.net/?", `mongodb.net/${dbName}?`);
    } else if (/mongodb\.net\/\?/.test(uri) === false) {
      // mongodb.net:27017/? → mongodb.net:27017/jerry?
      uri = uri.replace(
        /(mongodb\.net(?::\d+)?)\/\?/,
        `$1/${dbName}?`,
      );
    }
  } catch {
    /* keep original uri */
  }

  return uri;
}

const connectDB = async () => {
  const uri = resolveMongoUri();
  if (!uri) {
    console.log("MONGODB_URI not set — profiles, chats, and file uploads disabled");
    return;
  }

  // Fail fast when the URI still has the Atlas placeholder and no password is
  // available to substitute. This prevents the cryptic Mongoose
  // "bad auth : authentication failed" loop you see when env vars are mis-set.
  if (uri.includes("<db_password>")) {
    console.error(
      "MONGODB_URI still contains the literal <db_password> placeholder and " +
        "no MONGODB_PASSWORD env var was supplied to substitute it. " +
        "Either set MONGODB_PASSWORD, or replace <db_password> in MONGODB_URI " +
        "with the URL-encoded Atlas database user password.",
    );
    process.exit(1);
  }

  try {
    mongoose.set("strictQuery", true);
    const conn = await mongoose.connect(uri, {
      // Prefer low-latency pool for chat list / message loads
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
    });
    connected = true;
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    const db = conn.connection.db;
    gfs = new mongoose.mongo.GridFSBucket(db, {
      bucketName: "uploads",
    });
    console.log("GridFS Bucket initialized");
  } catch (error) {
    connected = false;
    console.error(`MongoDB Error: ${error.message}`);
    console.log("Server will continue without MongoDB — chat/file routes will fail until fixed");
  }
};

const getGridFSBucket = () => {
  if (!gfs) {
    throw new Error("GridFS bucket not initialized — MongoDB may not be connected");
  }
  return gfs;
};

const isMongoConnected = () => connected && mongoose.connection.readyState === 1;

module.exports = { connectDB, getGridFSBucket, isMongoConnected, resolveMongoUri };
