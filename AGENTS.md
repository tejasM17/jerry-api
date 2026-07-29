# AGENTS.md — Jerry (Backend)

## Quick Start

```sh
npm install
npm run dev          # dev server (nodemon)
npm start            # production
```

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js 5 (CommonJS)
- **Auth**: Firebase Admin SDK (ID token verification)
- **AI**: Google Gemini API (`gemini-2.5-flash` default)
- **Database**: Dual architecture
  - Firestore: chats & messages
  - MongoDB + GridFS: file storage
- **File Uploads**: Multer (memory, 10MB limit)
- **Dev**: nodemon

## Setup

1. Copy `.env.example` to `.env.development`
2. Add required vars:
   ```
   PORT=5000
   GEMINI_API_KEYS=key1,key2
   MONGODB_URI=mongodb://localhost:27017/jerry-ai
   FRONTEND_URL=http://localhost:5173
   FIREBASE_PROJECT_ID=...
   FIREBASE_CLIENT_EMAIL=...
   FIREBASE_PRIVATE_KEY="..."
   ```

## Routes

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/chat/new` | Create chat, stream response, returns `X-Chat-Id` |
| GET | `/api/chat/all` | List user's chats |
| GET | `/api/chat/recent` | 10 recent chats |
| GET | `/api/chat/search?q=` | Prefix search titles |
| GET | `/api/chat/:chatId` | Get messages |
| DELETE | `/api/chat/:chatId` | Delete chat + messages |
| POST | `/api/chat/:chatId/continue` | Continue chat, stream response |
| POST | `/api/chat/upload` | Multipart file upload |
| GET | `/api/chat/files/:fileId` | Stream file from GridFS (unprotected) |
| PUT | `/api/chat/:chatId/edit/:messageId` | Edit message, regenerate AI response |
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |

## Firestore Schema

```
chats/{chatId}: userId, title, createdAt, updatedAt
messages/{messageId}: chatId, userId, role, content, attachments[], createdAt
```
