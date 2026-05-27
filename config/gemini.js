const { GoogleGenerativeAI } = require("@google/generative-ai");

const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY;

if (!rawKeys) {
  throw new Error("No Gemini API key configured. Please set GEMINI_API_KEYS (comma-separated) or GEMINI_API_KEY in your environment.");
}

const keys = rawKeys.split(",").map((k) => k.trim()).filter(Boolean);

let currentIndex = 0;

/**
 * Returns the next API key in the rotation.
 */
function getNextKey() {
  const key = keys[currentIndex];
  currentIndex = (currentIndex + 1) % keys.length;
  return key;
}

/**
 * Returns a GenerativeModel instance using the next available key.
 */
function getModel() {
  const apiKey = getNextKey();
  const genAI = new GoogleGenerativeAI(apiKey);

  // Note: Ensure the model name is correct for your tier (e.g., "gemini-1.5-flash")
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  });
}

/**
 * Executes a function with automatic retry logic across multiple API keys.
 * Useful for handling rate limits (429) or transient errors.
 */
async function withRetry(fn) {
  let lastError;
  const maxRetries = keys.length * 2; // Try each key at least twice if needed

  for (let i = 0; i < maxRetries; i++) {
    const attemptIndex = currentIndex;
    try {
      const model = getModel();
      return await fn(model);
    } catch (error) {
      lastError = error;
      
      // If it's a rate limit error or other transient error, retry with next key
      const isRateLimit = error.message?.includes("429") || error.status === 429;
      const isTransient = error.message?.includes("500") || error.message?.includes("503");

      if (isRateLimit || isTransient) {
        console.warn(`Gemini API key index ${attemptIndex} failed. Retrying with next key...`);
        continue;
      }
      
      // If it's a permanent error, throw immediately
      throw error;
    }
  }

  throw lastError;
}

module.exports = {
  getModel,
  withRetry,
  keysCount: keys.length
};
