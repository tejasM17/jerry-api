const admin = require("firebase-admin");

/** Render/Vercel often wrap PEM values in quotes and escape newlines as `\n`. */
function normalizePrivateKey(raw) {
  if (!raw) return undefined;
  let key = String(raw).trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n");
}

function firebaseConfigFromEnv() {
  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  };
}

function isFirebaseConfigured() {
  const c = firebaseConfigFromEnv();
  return Boolean(c.projectId && c.clientEmail && c.privateKey);
}

if (!admin.apps.length) {
  const c = firebaseConfigFromEnv();
  if (!isFirebaseConfigured()) {
    console.error(
      "[firebase] Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY. " +
        "ID token verification will fail until they are set on the host.",
    );
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: c.projectId,
          clientEmail: c.clientEmail,
          privateKey: c.privateKey,
        }),
      });
      console.log(`[firebase] Admin SDK initialized for project ${c.projectId}`);
    } catch (err) {
      console.error(
        "[firebase] Failed to initialize Admin SDK (check FIREBASE_PRIVATE_KEY PEM formatting):",
        err.message,
      );
    }
  }
}

module.exports = admin;
module.exports.isFirebaseConfigured = isFirebaseConfigured;
