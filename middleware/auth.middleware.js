const verifyFirebaseToken = require("./verifyFirebaseToken");

/**
 * Protect routes: expects `Authorization: Bearer <Firebase ID token>`.
 * On success, attaches `req.user` with uid plus profile claims used by /auth/sync.
 */
const protect = async (req, res, next) => {
  try {
    const decoded = await verifyFirebaseToken(req);
    req.user = {
      uid: decoded.uid,
      firebaseUid: decoded.uid,
      email: decoded.email || null,
      displayName: decoded.name || null,
      photoURL: decoded.picture || null,
    };
    next();
  } catch (error) {
    console.error("[auth] Token verification failed:", error.message);
    res.status(401).json({ message: "Unauthorized" });
  }
};

module.exports = protect;
