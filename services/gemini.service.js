const { withRetry } = require("../config/gemini");
const { titleFromPrompt } = require("./chat.service");

const streamGeminiResponse = async (payload, res) => {
  await withRetry(async (model) => {
    const result = await model.generateContentStream(payload);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) res.write(text);
    }
  });

  res.end();
};

/** Prefer local title for latency; optional Gemini polish stays available. */
const generateTitleFromPrompt = async (prompt, { useAi = false } = {}) => {
  if (!useAi) return titleFromPrompt(prompt);

  return withRetry(async (model) => {
    const result = await model.generateContent(
      `Generate a short 4 word title for: ${prompt}`,
    );
    return result.response.text().replace(/["']/g, "").slice(0, 80);
  });
};

module.exports = {
  streamGeminiResponse,
  generateTitleFromPrompt,
};
