# Gemini API Integration Documentation

if any new feature added to project. keep updated the readme.md and gemini.md 

This document outlines how the Gemini API is integrated into the Jerry API backend.

## 1. Overview of AI Features

The application leverages Google's Gemini 2.0 Flash model to provide interactive chat capabilities and automated metadata generation:

- **Interactive Chat**: Real-time streaming of AI responses using `generateContentStream`.
- **Multimodal Support**: Support for image and document uploads, stored in MongoDB GridFS and processed by Gemini 2.0 Flash as base64 `inlineData`.
- **Message Editing & Branching**: Allows users to edit previous messages, which truncates subsequent history and generates a fresh AI response from that point.
- **Contextual Memory**: Integration with Firebase Firestore to maintain and provide chat history for multi-turn conversations.
- **Auto-Title Generation**: Automatically generates a concise 4-word title for each new chat session based on the initial user prompt.
- **File Streaming**: Dedicated endpoint to stream files from MongoDB GridFS back to the frontend.

## 2. Prerequisites

- **API Key**: A valid Google AI API Key from [Google AI Studio](https://aistudio.google.com/).
- **SDK**: The project uses the `@google/generative-ai` package.
- **Environment Variables**:
  - `GEMINI_API_KEYS`: A comma-separated list of API keys for rotation and failover.
  - `MONGODB_URI`: The connection string for your MongoDB database.
  - `NODE_ENV`: Set to `development` to load `.env.development`.

## 3. Architecture Details

The integration follows a layered architecture with enhanced reliability:

- **Configuration Layer (`config/db.js` & `config/firebase.js`)**: 
  - MongoDB: Handles connection and GridFS initialization for file storage.
  - Gemini: Supports multiple API keys via rotation and retry logic.
  - Firebase: Initializes Firestore for chat and message storage.
- **Middleware Layer (`middleware/upload.middleware.js`)**: Uses `multer` with memory storage to handle file uploads before piping to GridFS.
- **Service Layer (`services/gemini.service.js`)**: Uses `withRetry` to ensure operations like title generation and streaming are resilient.
- **Helper Layer (`utils/geminiHelper.js`)**: Fetches files from GridFS and converts them to base64 `inlineData` for the Gemini SDK.
- **Controller Layer (`controllers/chat.controller.js`)**: Orchestrates the flow:
  1. **Upload**: Saves files to MongoDB GridFS and returns file IDs.
  2. **Stream**: Streams files from GridFS to the frontend for UI display.
  3. **Chat**: Fetches attachments from GridFS, converts to base64, and formats into multimodal parts.
  4. **Edit**: Truncates history by deleting messages after the edited point and re-triggers AI generation.
- **Utility Layer (`utils/systemPrompt.js`)**: Defines the global instructions.

## 4. API Reference Summary

### Auth (`/api/auth`)
- `POST /register`: `{ username, email, password }` -> Returns user profile & token.
- `POST /login`: `{ email, password }` -> Returns user profile & token.

### Chat (`/api/chat`)
*All require `Authorization: Bearer <ID_TOKEN>`*
- `POST /new`: `{ prompt, attachments? }` -> Streams AI response. Returns `X-Chat-Id` header.
- `GET /all`: Returns user's chat list.
- `GET /:chatId`: Returns message history for a chat.
- `DELETE /:chatId`: Deletes chat session.
- `POST /:chatId/continue`: `{ prompt, attachments? }` -> Streams AI response.
- `POST /upload`: Multipart form-data (`file`) -> Returns `{ url, mimeType, name }`.
- `PUT /:chatId/edit/:messageId`: `{ prompt, attachments? }` -> Truncates history and streams new response.

## 5. Best Practices

### Error Handling
- **Try-Catch Blocks**: All Gemini calls are wrapped in `try-catch` blocks within the controller to handle network timeouts or API errors gracefully.
- **Validation**: Prompts are validated to ensure they are not empty before being sent to the API.
- **State management**:always handel loading state error handling data fetching.

### Rate Limits & Performance
- **Streaming**: Responses are streamed directly to the frontend to reduce perceived latency and avoid timeout issues with large responses.
- **Efficient History**: Only relevant messages from the current `chatId` are retrieved from Firestore to keep the context window efficient.
- **Environment Management**: Uses `dotenv` with environment-specific files (`.env.development`) to manage credentials safely.
