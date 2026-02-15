const getModel = require("../config/gemini");

const streamGeminiResponse = async (payload, res) => {
  const model = getModel();

  const result = await model.generateContentStream(payload);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    res.write(text);
  }

  res.end();
};

const generateTitleFromPrompt = async (prompt) => {
  const model = getModel();

  const result = await model.generateContent(
    `Generate a short 4 word title for: ${prompt}`,
  );

  return result.response.text().replace(/["']/g, "");
};

module.exports = {
  streamGeminiResponse,
  generateTitleFromPrompt,
};
