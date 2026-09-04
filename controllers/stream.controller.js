// stream.controller.js – handles a generic LLM streaming response
// This implementation is framework‑agnostic; replace the placeholder Gemini
// client with whatever LLM service the project uses.

/**
 * Streams response chunks from an LLM back to the HTTP client.
 * @param {Object} req Express request – expects { prompt: string, sessionId?: string }
 * @param {Object} res Express response – streaming will be written via res.write()
 */
async function streamResponse(req, res) {
  const { prompt, sessionId } = req.body;

  // Placeholder: simulate streaming from an LLM with async generator
  async function* fakeLlmStream(text) {
    const words = text.split(' ');
    for (let i = 0; i < words.length; i++) {
      // Simulate network latency
      await new Promise(r => setTimeout(r, 100));
      yield words[i] + ' ';
    }
  }

  // TODO: replace fakeLlmStream with real client, e.g. Gemini.generateContentStream
  const stream = fakeLlmStream(`Echo: ${prompt}`);

  for await (const chunk of stream) {
    // Write each chunk as it arrives
    res.write(chunk);
  }

  // End the response when streaming completes
  res.end();
}

module.exports = { streamResponse };
