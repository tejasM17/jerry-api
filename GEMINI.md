# Gemini API Integration Documentation

if any new feature added to project. keep updated the readme.md and gemini.md 

This document outlines how the Gemini API is integrated into the Jerry API backend.

## 1. Overview of AI Features

The application leverages Google's Gemini Pro model to provide interactive chat capabilities and automated metadata generation:

- **Interactive Chat**: Real-time streaming of AI responses using `generateContentStream`.
- **Contextual Memory**: Integration with Firebase Firestore to maintain and provide chat history for multi-turn conversations.
- **Auto-Title Generation**: Automatically generates a concise 4-word title for each new chat session based on the initial user prompt.
- **System Instructions**: Customizable AI personality and behavior via a centralized system prompt.

## 2. Prerequisites

- **API Key**: A valid Google AI API Key from [Google AI Studio](https://aistudio.google.com/).
- **SDK**: The project uses the `@google/generative-ai` package.
- **Environment Variables**:
  - `GEMINI_API_KEYS`: A comma-separated list of API keys for rotation and failover.
  - `GEMINI_API_KEY`: Fallback single API key if `GEMINI_API_KEYS` is not set.
  - `GEMINI_MODEL`: (Optional) The model name to use (defaults to `gemini-1.5-flash`).
  - `NODE_ENV`: Set to `development` to load `.env.development`.

## 3. Architecture Details

The integration follows a layered architecture with enhanced reliability:

- **Configuration Layer (`config/gemini.js`)**: 
  - Supports multiple API keys via rotation.
  - Exports a `withRetry` wrapper that automatically switches to the next available API key if a rate limit (429) or transient error (500, 503) occurs.
- **Service Layer (`services/gemini.service.js`)**: Uses `withRetry` to ensure operations like title generation and streaming are resilient to key-specific issues.
- **Controller Layer (`controllers/chat.controller.js`)**: Orchestrates the flow between the user, Gemini API, and Firebase:
  1. Authenticates the user via Firebase Auth middleware.
  2. Retrieves conversation history from Firestore.
  3. Formats history for Gemini (`user`/`model` roles).
  4. Streams the Gemini response to the client.
  5. Persists both user and assistant messages back to Firestore.
- **Utility Layer (`utils/systemPrompt.js`)**: Defines the global instructions provided to the model at the start of every session.

## 4. Example Usage

### Initializing the Model

```javascript
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
```

### Streaming a Conversation

```javascript
const result = await model.generateContentStream({
  systemInstruction: {
    role: "system",
    parts: [{ text: systemPrompt }],
  },
  contents: [
    { role: "user", parts: [{ text: "Hello!" }] },
    { role: "model", parts: [{ text: "Hi there! How can I help you today?" }] },
    { role: "user", parts: [{ text: "Tell me a joke." }] },
  ],
});

for await (const chunk of result.stream) {
  const text = chunk.text();
  process.stdout.write(text); // Or res.write(text) in Express
}
```

## 5. Best Practices

### Error Handling
- **Try-Catch Blocks**: All Gemini calls are wrapped in `try-catch` blocks within the controller to handle network timeouts or API errors gracefully.
- **Validation**: Prompts are validated to ensure they are not empty before being sent to the API.

### Rate Limits & Performance
- **Streaming**: Responses are streamed directly to the frontend to reduce perceived latency and avoid timeout issues with large responses.
- **Efficient History**: Only relevant messages from the current `chatId` are retrieved from Firestore to keep the context window efficient.
- **Environment Management**: Uses `dotenv` with environment-specific files (`.env.development`) to manage credentials safely.
