"use strict";
/**
 * Test that Gemini connectivity works via withRetry.
 * This uses the stubbed Gemini SDK to avoid real network calls.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Helper to inject a module stub into Node's require cache.
function inject(name, exports) {
  const resolved = require.resolve(name);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

// Stub the @google/generative-ai package.
const fakeGenerativeModel = {
  generateContent: async (prompt) => ({
    response: {
      text: () => "pong",
    },
  }),
};
const fakeGenAi = {
  getGenerativeModel: () => fakeGenerativeModel,
};
const geminiStub = {
  GoogleGenerativeAI: function () {
    return fakeGenAi;
  },
};

// Ensure the stub is in place before requiring the config module.
inject("@google/generative-ai", geminiStub);

// Set a dummy key so config/gemini sees an API key.
process.env.GEMINI_API_KEY = "test_key";

const geminiPath = path.resolve(__dirname, "..", "config", "gemini.js");
delete require.cache[geminiPath];
const { withRetry } = require("../config/gemini");

test("Gemini health check via withRetry returns success", async () => {
  const result = await withRetry(async (model) => {
    const resp = await model.generateContent("ping");
    return resp.response.text();
  });
  assert.equal(result, "pong");
});
