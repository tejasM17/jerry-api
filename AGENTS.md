# AGENTS.md - Jerry AI Backend

## Quick Reference

- **Dev server**: `npm run dev` (sets `NODE_ENV=development`, runs nodemon)
- **Prod server**: `npm start`
- **Env file**: `.env.development` (dev) / `.env` (prod) — loaded by `server.js` via dotenv
- **Module system**: CommonJS (`"type": "commonjs"` in package.json)
- **No lint/typecheck/test scripts** — the repo has none configured

## Architecture

Express.js backend serving a Firebase-backed AI chat app.

**Dual database, not single:**
- **Firestore** (`config/firebase.js` → `db`): stores `chats` and `messages` collections. All chat/message CRUD goes here.
- **MongoDB + GridFS** (`config/db.js` → `getGridFSBucket()`): stores uploaded files only. Not used for chat data.

**Auth is Firebase Admin SDK ID tokens**, not JWT or sessions. Client sends `Authorization: Bearer <ID_TOKEN>`. The `protect` middleware (`middleware/auth.middleware.js`) calls `admin.auth().verifyIdToken()` and attaches `req.user` (contains `uid`).

**Gemini API** (`config/gemini.js`): supports multiple API keys with rotation + retry. Use `withRetry(async (model) => { ... })` for all Gemini calls. Default model: `gemini-2.5-flash` (override via `GEMINI_MODEL` env).

**Streaming responses**: chat endpoints use `res.setHeader("Transfer-Encoding", "chunked")` and `res.write()` chunks. The new-chat endpoint returns `X-Chat-Id` in response headers.

## Route Map

All chat routes are mounted at `/api/chat` (`routes/chat.routes.js`).

| Method | Path | Protect | Notes |
|--------|------|---------|-------|
| POST | `/api/chat/new` | Yes | Creates chat, streams AI response. Returns `X-Chat-Id` header. |
| GET | `/api/chat/all` | Yes | Lists user's chats (ordered by `updatedAt` desc). |
| GET | `/api/chat/recent` | Yes | 10 most recent chats (lightweight: id, title, updatedAt). Supports `?limit=`. |
| GET | `/api/chat/search?q=` | Yes | Prefix search on chat titles. Supports `?limit=`. |
| GET | `/api/chat/:chatId` | Yes | Messages for a chat (ordered by `createdAt` asc). |
| DELETE | `/api/chat/:chatId` | Yes | Deletes chat + all messages (batch). |
| POST | `/api/chat/:chatId/continue` | Yes | Appends message, streams AI response. |
| POST | `/api/chat/upload` | Yes | Multipart file upload (multer, 10MB limit, memory storage). |
| GET | `/api/chat/files/:fileId` | **No** | Streams file from GridFS. Intentionally unprotected for browser `<img>` tags. |
| PUT | `/api/chat/:chatId/edit/:messageId` | Yes | Edits message, truncates subsequent history, re-generates AI. |

Auth routes mounted at `/api/auth`: `POST /register`, `POST /login`.

**Route ordering matters**: `/files/:fileId` is registered before `/:chatId` so "files" isn't captured as a chatId.

## Firestore Schema

```
chats/{chatId}
  - userId: string (Firebase UID)
  - title: string (auto-generated 4-word title)
  - createdAt: Timestamp
  - updatedAt: Timestamp

messages/{messageId}
  - chatId: string
  - userId: string
  - role: "user" | "assistant"
  - content: string
  - attachments: Array<{ fileId, url, mimeType }>  (optional)
  - createdAt: Timestamp
```

Firestore queries in this repo use `where().orderBy()`. If you add new queries, note that Firestore requires composite indexes for `where` + `orderBy` on different fields.

## Known Issues

- `controllers/auth.controller.js` references undefined variables (`User`, `bcrypt`, `generateToken`) — these are dead code from a previous Mongoose-based auth system. Auth is now Firebase-only. Do not call these functions.
- `models/User.model.js` is unused — the project uses Firebase Auth, not a local User model.
- `npm run dev` uses Windows `set` command — will not work on Linux/macOS. Use cross-platform alternative if needed.
- `docs/` directory is empty.

## Env Variables Required

```
PORT=5000
GEMINI_API_KEYS=key1,key2          # comma-separated, supports rotation
# OR
GEMINI_API_KEY=single_key
FRONTEND_URL=http://localhost:5173
MONGODB_URI=mongodb://localhost:27017/jerry-ai
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="..."         # escaped \n in the string
```

## CORS

Hardcoded allowed origins: `localhost:5173`, `localhost:5174`, `127.0.0.1` variants, plus `FRONTEND_URL` env. In development mode, all localhost origins are allowed.

## File Upload Flow

1. Client POSTs multipart to `/api/chat/upload` (field name: `file`)
2. Multer stores buffer in memory (10MB limit)
3. Controller streams buffer to GridFS bucket `uploads`
4. Returns `{ fileId, url, mimeType, name }`
5. Client passes `fileId` in chat `attachments` array
6. Before Gemini calls, `utils/geminiHelper.js` fetches files from GridFS, converts to base64 `inlineData`
