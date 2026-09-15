"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");

let keys = null;
let currentIndex = 0;

function loadKeys() {
  if (keys) return keys;
  const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY;
  if (!rawKeys) {
    keys = [];
    return keys;
  }
  keys = rawKeys
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return keys;
}

function assertKeys() {
  const list = loadKeys();
  if (!list.length) {
    throw new Error(
      "No Gemini API key configured. Set GEMINI_API_KEYS or GEMINI_API_KEY.",
    );
  }
  return list;
}

function getNextKey() {
  const list = assertKeys();
  const key = list[currentIndex % list.length];
  currentIndex = (currentIndex + 1) % list.length;
  return key;
}

function getModel() {
  const apiKey = getNextKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  });
}

/**
 * Translate common Gemini SDK / HTTP errors into a hint for logs.
 * Never echoes the API key.
 */
function diagnoseGeminiError(error) {
  const status = error?.status || error?.response?.status;
  const msg = String(error?.message || "");

  if (!process.env.GEMINI_API_KEYS && !process.env.GEMINI_API_KEY) {
    return "no GEMINI_API_KEY set in env";
  }
  if (status === 401 || status === 403 || /API key not valid/i.test(msg)) {
    return "API key invalid or Generative Language API not enabled for the project";
  }
  if (status === 404 || /not found/i.test(msg)) {
    return `model not available (model="${process.env.GEMINI_MODEL || "gemini-3.5-flash"}"); set GEMINI_MODEL`;
  }
  if (status === 429) return "rate limited (429)";
  if (status === 500 || status === 503) return `transient server error (${status})`;
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|getaddrinfo|network/i.test(msg)) {
    return "network unreachable to generativelanguage.googleapis.com";
  }
  return msg.slice(0, 200);
}

/**
 * Run fn(model) with key rotation on rate limits / transient errors.
 * Logs the failing key index (no key material), status, and a diagnostic hint
 * so the fallback "[Error generating response. Please try again.]" is never silent.
 */
async function withRetry(fn) {
  const list = assertKeys();
  let lastError;
  const maxRetries = Math.max(list.length * 2, 2);

  for (let i = 0; i < maxRetries; i++) {
    const attemptIndex = currentIndex;
    try {
      const model = getModel();
      return await fn(model);
    } catch (error) {
      lastError = error;

      // Always log the full error for visibility.
      console.error("[gemini] attempt failed (key index " + attemptIndex + "):", error);

      const status = error?.status || error?.response?.status;
      const isRateLimit = status === 429 || /429/.test(error?.message || "");
      const isTransient =
        status === 500 ||
        status === 503 ||
        /500|503/.test(error?.message || "");

      if (isRateLimit || isTransient) {
        // Retryable error – log a concise hint and continue with next key.
        const hint = diagnoseGeminiError(error);
        console.warn(
          `[gemini] retryable error (key[${attemptIndex}]): ${hint} — retrying`,
        );
        continue;
      }

      // Non-retryable error – surface after logging.
      throw error;
    }
  }

  // All retries exhausted – surface the last error with a hint.
  console.error("[gemini] all retries exhausted:", {
    keysTotal: list.length,
    status: lastError?.status || null,
    hint: diagnoseGeminiError(lastError),
    message: String(lastError?.message || "").slice(0, 300),
  });
  throw lastError;
}

module.exports = {
  getModel,
  withRetry,
  get keysCount() {
    return loadKeys().length;
  },
};
