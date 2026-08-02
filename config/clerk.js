"use strict";

const { createClerkClient } = require("@clerk/backend");

/**
 * Shared Clerk Backend client (Part 4 of auth migration).
 * Requires CLERK_SECRET_KEY from `.env.development` / `.env`.
 * Publishable key is optional on the API (frontend owns the SPA key).
 */
function getClerkSecretKey() {
  return process.env.CLERK_SECRET_KEY || "";
}

function getClerkPublishableKey() {
  return (
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.VITE_CLERK_PUBLISHABLE_KEY ||
    ""
  );
}

const secretKey = getClerkSecretKey();
const publishableKey = getClerkPublishableKey() || undefined;

if (!secretKey) {
  console.warn(
    "[clerk] CLERK_SECRET_KEY is not set — protected routes will reject with 500 Auth is not configured",
  );
}

const clerkClient = createClerkClient({
  secretKey: secretKey || "MISSING_CLERK_SECRET_KEY",
  publishableKey,
});

module.exports = {
  clerkClient,
  getClerkSecretKey,
  getClerkPublishableKey,
  isClerkConfigured: () => Boolean(getClerkSecretKey()),
};
