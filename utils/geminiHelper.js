const { getGridFSBucket } = require("../config/db");
const mongoose = require("mongoose");

/**
 * Fetches files from URLs and converts them to the format expected by the Gemini SDK.
 * @param {Array} attachments - Array of { fileId, url, mimeType }
 * @returns {Promise<Array>} - Array of { inlineData: { data: string, mimeType: string } }
 */
const fetchAndFormatAttachments = async (attachments) => {
  if (!attachments || !attachments.length) return [];

  const formattedAttachments = await Promise.all(
    attachments.map(async (attachment) => {
      try {
        let base64Data;
        let mimeType = attachment.mimeType;

        // If it's a GridFS fileId, fetch from MongoDB
        if (attachment.fileId) {
          base64Data = await fetchGridFSFileAsBase64(attachment.fileId);
        } else if (attachment.url) {
          // Fallback for external URLs if any
          const response = await fetch(attachment.url);
          if (!response.ok) throw new Error(`Failed to fetch attachment from ${attachment.url}`);
          const buffer = await response.arrayBuffer();
          base64Data = Buffer.from(buffer).toString("base64");
        }

        if (!base64Data) return null;

        return {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        };
      } catch (error) {
        console.error("Error formatting attachment:", error);
        return null;
      }
    })
  );

  return formattedAttachments.filter((item) => item !== null);
};

const fetchGridFSFileAsBase64 = async (fileId) => {
  return new Promise((resolve, reject) => {
    try {
      const bucket = getGridFSBucket();
      const downloadStream = bucket.openDownloadStream(new mongoose.Types.ObjectId(fileId));
      const chunks = [];

      downloadStream.on("data", (chunk) => chunks.push(chunk));
      downloadStream.on("error", (err) => reject(err));
      downloadStream.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString("base64"));
      });
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = { fetchAndFormatAttachments, fetchGridFSFileAsBase64 };
