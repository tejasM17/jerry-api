# AGENTS.md — Jerry (Backend)

## Quick Start

```sh
npm install
npm run dev          # NODE_ENV=development + nodemon
npm start            # production
```

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js 5 (CommonJS)
- **Auth**: Firebase Admin (ID token verification)
- **AI**: Google Gemini API (`gemini-2.5-flash` default)
- **Database**: MongoDB + Mongoose (`User`, `Chat`, `Message`) + GridFS uploads
- **File Uploads**: Multer (memory) → GridFS
- **Dev**: nodemon

## Setup

1. Copy `.env.example` to `.env.development`
2. Required vars:
   ```
   PORT=5000
   GEMINI_API_KEY=...
   MONGODB_URI=mongodb://jerry-files:<db_password>@...atlas...
   MONGODB_PASSWORD=your_atlas_password
   FRONTEND_URL=http://localhost:5173
   FIREBASE_PROJECT_ID=...
   FIREBASE_CLIENT_EMAIL=...
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
   ```

## Chat routes

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/chat/new` | Create chat, stream Gemini, `X-Chat-Id` |
| GET | `/api/chat/all` | List chats |
| GET | `/api/chat/recent` | Recent chats |
| GET | `/api/chat/search?q=` | Title search |
| GET | `/api/chat/:chatId` | Messages |
| DELETE | `/api/chat/:chatId` | Delete chat + messages |
| PATCH | `/api/chat/:chatId/rename` | Rename |
| POST | `/api/chat/:chatId/continue` | Continue + stream |
| PUT | `/api/chat/:chatId/edit/:messageId` | Edit + re-stream |
| PATCH | `/api/chat/:chatId/message/:messageId` | Update message |
| DELETE | `/api/chat/:chatId/message/:messageId` | Delete message |
| POST | `/api/chat/upload` | GridFS upload |
| GET | `/api/chat/files/:fileId` | Serve file |
| GET | `/api/auth/me` | Firebase profile |
| POST | `/api/auth/sync` | Upsert Mongo user |

## Frontend contract

1. `Authorization: Bearer ${await getToken()}` on protected calls.
2. Optionally `POST /api/auth/sync` after login.
3. Optional JWT claim `userId` = `{{user.external_id || user.id}}` for faster ownership.

## Mongo schema

```
chats: userId, title, deletedAt?, createdAt, updatedAt
messages: chatId, userId, role, content, attachments[], createdAt, updatedAt
users: uid, clerkId, email, profile fields…
```
