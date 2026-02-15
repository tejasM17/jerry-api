const { GoogleGenerativeAI } = require("@google/generative-ai");

const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY;

if (!rawKeys) {
  throw new Error("No Gemini API key configured");
}

const keys = rawKeys.split(",").map((k) => k.trim());

let currentIndex = 0;

function getNextKey() {
  const key = keys[currentIndex];
  currentIndex = (currentIndex + 1) % keys.length;
  return key;
}

function getModel() {
  const apiKey = getNextKey();
  const genAI = new GoogleGenerativeAI(apiKey);

  return genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
  });
}

module.exports = getModel;
