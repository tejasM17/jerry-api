const verifyFirebaseToken = require('./verifyFirebaseToken');

/**
 * Protect routes: expects `Authorization: Bearer <Firebase ID token>`.
 * On success, attaches `req.user = { uid, email, ...decoded }`.
 */
const protect = async (req, res, next) => {
  try {
    const decoded = await verifyFirebaseToken(req);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      // include any other useful claims as needed
    };
    next();
  } catch (error) {
    console.error('[auth] Token verification failed:', error.message);
    res.status(401).json({ message: 'Unauthorized' });
  }
};

module.exports = protect;
