const mongoose = require("mongoose");

let gfs;

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    const db = conn.connection.db;
    gfs = new mongoose.mongo.GridFSBucket(db, {
      bucketName: "uploads",
    });
    console.log("GridFS Bucket initialized");
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

const getGridFSBucket = () => {
  if (!gfs) {
    throw new Error("GridFS bucket not initialized");
  }
  return gfs;
};

module.exports = { connectDB, getGridFSBucket };
