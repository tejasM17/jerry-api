const { GoogleGenerativeAI } = require("@google/generative-ai");

if (!process.env.GEMINI_API_KEYS) {
  throw new Error("GEMINI_API_KEYS is not defined in environment variables");
}

const keys = process.env.GEMINI_API_KEYS.split(",");

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
