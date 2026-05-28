# Jerry AI Backend

This is the backend server for Jerry AI, a chatbot powered by Google Gemini and Firebase.

## Features
- AI-powered chat using **Gemini 2.0 Flash**.
- **Multimodal Support**: Upload images and documents to chat.
- **Auto-Title Generation**: Automatically generates a concise 4-word title for each new chat session.
- **Message Editing**: Edit previous prompts and re-generate AI responses (with history branching).
- **Reliability & Rotation**: Supports multiple Gemini API keys with automatic rotation and retry logic for high availability.
- **System Instructions**: Customizable AI personality and behavior via a centralized system prompt.
- **Authentication**: Managed via **Firebase Auth**.
- **Streaming Responses**: Real-time text streaming for better UX.
- **Cloud Storage**: Chat history in **Firestore** and files in **MongoDB GridFS**.

## Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [Firebase Project](https://console.firebase.google.com/) (for Firestore and Auth)
- [MongoDB](https://www.mongodb.com/) (for GridFS file storage)
- [Gemini API Key](https://aistudio.google.com/app/apikey)

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd jerry-api
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Configuration:**
   Create a `.env.development` file in the root directory and add your credentials:
   ```env
   PORT=5000
   GEMINI_API_KEYS=key1,key2,key3 (Comma separated for rotation and failover)
   # OR
   GEMINI_API_KEY=your_single_key
   FRONTEND_URL=http://localhost:5173
   MONGODB_URI=mongodb://localhost:27017/jerry-ai

   # Firebase Configuration
   FIREBASE_API_KEY=your_firebase_api_key
   FIREBASE_PROJECT_ID=your_firebase_project_id
   FIREBASE_CLIENT_EMAIL=your_firebase_client_email
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
   ```

4. **Run the server:**
   - For development:
     ```bash
     npm run dev
     ```
   - For production:
     ```bash
     npm start
     ```

## API Endpoints

### Auth
All auth endpoints are prefixed with `/api/auth`.

- **POST `/register`** - Register a new user.
  - **Body:**
    ```json
    {
      "username": "johndoe",
      "email": "john@example.com",
      "password": "securepassword"
    }
    ```
  - **Response:** (201 Created) Returns user details and token.

- **POST `/login`** - Login a user.
  - **Body:**
    ```json
    {
      "email": "john@example.com",
      "password": "securepassword"
    }
    ```
  - **Response:** (200 OK) Returns user details and token.

### Chat
All chat endpoints are prefixed with `/api/chat` and require a **Firebase ID Token** in the `Authorization` header.

- **POST `/new`** - Start a new chat and stream response.
  - **Headers:** `Authorization: Bearer <ID_TOKEN>`
  - **Body:**
    ```json
    {
      "prompt": "Hello, how are you?",
      "attachments": [
        { "fileId": "65f...", "mimeType": "image/jpeg" }
      ]
    }
    ```
  - **Response:** (200 OK) Streamed text chunks. 
  - **Headers (Response):** Returns `X-Chat-Id` which should be used for subsequent `/continue` or `/edit` calls.

- **POST `/upload`** - Upload a file to MongoDB GridFS.
  - **Headers:** `Authorization: Bearer <ID_TOKEN>`
  - **Body:** `multipart/form-data` with key `file`.
  - **Limit:** Max file size 10MB.
  - **Response:** (200 OK)
    ```json
    {
      "fileId": "65f...",
      "url": "/api/chat/files/65f...",
      "mimeType": "image/png",
      "name": "example.png"
    }
    ```

- **GET `/files/:fileId`** - Stream a file from MongoDB GridFS.
  - **Response:** (200 OK) File stream (image, pdf, etc.).

- **PUT `/:chatId/edit/:messageId`** - Edit a message and re-generate AI response.
  - **Headers:** `Authorization: Bearer <ID_TOKEN>`
  - **Body:**
    ```json
    {
      "prompt": "Updated prompt",
      "attachments": []
    }
    ```
  - **Response:** (200 OK) Streamed text chunks. Note: Deletes all messages in the chat that occurred after the edited message.

- **GET `/all`** - Get all chats for the authenticated user.
  - **Headers:** `Authorization: Bearer <ID_TOKEN>`
  - **Response:** (200 OK)
    ```json
    [
      {
        "id": "chat_id_1",
        "title": "Greeting",
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
    ```

- **GET `/:chatId`** - Get messages for a specific chat.
  - **Headers:** `Authorization: Bearer <ID_TOKEN>`
  - **Response:** (200 OK)
    ```json
    [
      {
        "id": "msg_id_1",
        "role": "user",
        "content": "Hello",
        "attachments": [],
        "createdAt": "..."
      },
      {
        "id": "msg_id_2",
        "role": "assistant",
        "content": "Hi there!",
        "createdAt": "..."
      }
    ]
    ```

- **DELETE `/:chatId`** - Delete a chat and its history.
  - **Headers:** `Authorization: Bearer <ID_TOKEN>`
  - **Response:** (200 OK) `{ "message": "Chat deleted" }`

- **POST `/:chatId/continue`** - Continue an existing chat.
  - **Headers:** `Authorization: Bearer <ID_TOKEN>`
  - **Body:**
    ```json
    {
      "prompt": "Tell me more.",
      "attachments": []
    }
    ```
  - **Response:** (200 OK) Streamed text chunks.

## Technologies Used
- Express.js
- MongoDB & GridFS
- Firebase Admin SDK (Firestore & Auth)
- Google Generative AI (@google/generative-ai)
- Multer (File Uploads)
- Mongoose
- Cors
- Dotenv
