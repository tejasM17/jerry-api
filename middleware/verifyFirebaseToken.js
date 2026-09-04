const admin = require("../config/firebase");

/**
 * Verifies a Firebase ID token from the Authorization header.
 * Returns the decoded token with uid field.
 */
async function verifyFirebaseToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("No token provided");
  }
  const token = authHeader.slice(7).trim();
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded; // contains uid, email, etc.
}

module.exports = verifyFirebaseToken;
