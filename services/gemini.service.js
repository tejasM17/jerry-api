const model = require("../config/gemini");

const streamGeminiResponse = async (prompt, res) => {
  const result = await model.generateContentStream(prompt);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    res.write(text);
  }

  res.end();
};

const generateTitleFromPrompt = async (prompt) => {
  const result = await model.generateContent(
    `Generate a short 4 word title for: ${prompt}`
  );

  return result.response.text().replace(/["']/g, "");
};

module.exports = {
  streamGeminiResponse,
  generateTitleFromPrompt,
};
