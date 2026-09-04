"use strict";

const admin = require('../config/firebase');

/**
 * Protect routes using Firebase ID token verification.
 * Expected header: Authorization: Bearer <Firebase ID token>
 * Populates req.user with:
 *   uid: string           // Firebase uid (or app‑level uid)
 *   firebaseUid: string   // Same as uid for now
 *   email?: string        // optional email claim
 */
async function protect(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    // decoded contains uid, email, etc.
    req.user = {
      uid: decoded.uid,
      firebaseUid: decoded.uid,
      email: decoded.email || null,
      displayName: decoded.name || null,
      photoURL: decoded.picture || null,
    };
    next();
  } catch (err) {
    console.error('[firebase-auth] Token verification failed:', err.message);
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

module.exports = protect;
