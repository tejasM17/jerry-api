"use strict";

const { verifyToken } = require("@clerk/backend");
const {
  clerkClient,
  getClerkSecretKey,
  isClerkConfigured,
} = require("../config/clerk");

/** In-memory cache: clerkId → { uid, externalId, exp } — cuts Clerk API hops on chat load */
const ownershipCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getAuthorizedParties() {
  const parties = [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
  ].filter(Boolean);

  if (process.env.CLERK_AUTHORIZED_PARTIES) {
    parties.push(
      ...process.env.CLERK_AUTHORIZED_PARTIES.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  return [...new Set(parties)];
}

/**
 * Resolve app ownership id without an extra network call when JWT already
 * carries userId / external_id style claims.
 */
async function resolveAppUserId(clerkUserId, sessionClaims) {
  if (sessionClaims?.userId && typeof sessionClaims.userId === "string") {
    return {
      uid: sessionClaims.userId,
      externalId:
        sessionClaims.userId !== clerkUserId ? sessionClaims.userId : null,
    };
  }

  const cached = ownershipCache.get(clerkUserId);
  if (cached && cached.exp > Date.now()) {
    return { uid: cached.uid, externalId: cached.externalId };
  }

  let externalId = null;
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    if (user.externalId) {
      externalId = user.externalId;
    }
  } catch (err) {
    console.warn(
      "[auth] Could not load Clerk user for externalId:",
      err.message,
    );
  }

  const uid = externalId || clerkUserId;
  ownershipCache.set(clerkUserId, {
    uid,
    externalId,
    exp: Date.now() + CACHE_TTL_MS,
  });

  return { uid, externalId };
}

/**
 * Protect routes: `Authorization: Bearer <Clerk session JWT>`.
 */
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  if (!isClerkConfigured()) {
    console.error("[auth] CLERK_SECRET_KEY is not set");
    return res.status(500).json({ message: "Auth is not configured" });
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: getClerkSecretKey(),
      authorizedParties: getAuthorizedParties(),
    });

    const clerkUserId = payload.sub;
    if (!clerkUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { uid: appUserId, externalId } = await resolveAppUserId(
      clerkUserId,
      payload,
    );

    req.user = {
      uid: appUserId,
      clerkId: clerkUserId,
      externalId,
      sessionId: payload.sid || null,
      sessionClaims: payload,
    };

    next();
  } catch (error) {
    console.error("[auth] Token verification failed:", error.message);
    return res.status(401).json({ message: "Unauthorized" });
  }
};

module.exports = protect;
