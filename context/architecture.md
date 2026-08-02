# Architecture Context

## Stack

| Layer      | Technology                                 | Role |
|------------|--------------------------------------------|------|
| Runtime    | Node.js (v18+) + Express 5                 | Backend HTTP server and routing |
| Auth       | Clerk (`@clerk/backend`)                   | Verify session JWTs for API requests; identity source of truth |
| Database   | MongoDB (via Mongoose)                     | Users, chats, messages; GridFS for file blobs |
| AI Service | Google Gemini API                          | Streams AI responses for chat endpoints |
| Config     | `.env` / `.env.development` + `config/`    | DB URIs, API keys, service credentials |

## System Boundaries

- `server.js` – entry point: middleware, DB connect, route mounts, health.
- `config/` – `db.js`, `clerk.js`, `gemini.js` (no Firebase).
- `middleware/` – `auth.middleware.js` (Clerk JWT + ownership cache), `upload.middleware.js` (multer).
- `routes/` – `/api/auth`, `/api/chat`, `/api/profile`.
- `controllers/` – thin HTTP adapters.
- `services/` – chat persistence (`chat.service.js`), Gemini helpers (`gemini.service.js`).
- `models/` – Mongoose: `User`, `Chat`, `Message`.

## Storage Model

- **MongoDB**
  - `users` — app profile synced from Clerk
  - `chats` — conversation sessions:
    - `_id` — internal ObjectId (message FK)
    - `sessionId` — **public UUID** (URL `/c/{sessionId}`, API path param, list `id`)
    - `userId`, `title`, `deletedAt`, timestamps
  - `messages` — per-chat turns (`chatId` → Chat `_id`, `role`, `content`, `attachments`, `requestId` UUID for `?rid=`)
  - **GridFS** `uploads` — images/files for chat + avatars
- Indexes: unique sparse `sessionId`, `{ userId, updatedAt }`, `{ chatId, createdAt }`, optional text on `title`.

## Public session model (Grok / ChatGPT style)

| Concept | Field | Client URL / header |
| --- | --- | --- |
| Conversation | `Chat.sessionId` (UUID) | `/c/:sessionId`, `X-Session-Id` / `X-Chat-Id` |
| Turn / request | `Message.requestId` (UUID) | `?rid=`, `X-Request-Id` |
| Internal storage | `Chat._id`, `Message.chatId` | never required in SPA routes |

Route params accept **sessionId UUID** (preferred) or legacy **ObjectId** (back-compat). Missing `sessionId` on old rows is backfilled on first ownership load.

## Auth and Access Model

- `Authorization: Bearer <Clerk session JWT>` via `protect`.
- `req.user.uid` — ownership key (`sessionClaims.userId` → Clerk `externalId` → `sub`).
- Short in-memory cache of ownership mapping to avoid Clerk API on every chat request.
- All chat CRUD scoped by `userId === req.user.uid`.

## Chat / AI flow (latency)

1. Client posts prompt → create/continue chat in Mongo (local title, no pre-stream Gemini title call).
2. Stream Gemini tokens immediately (`text/plain`; CORS exposes `X-Session-Id`, `X-Chat-Id`, `X-Request-Id`, `X-Chat-Title`).
3. SPA navigates to `/c/{sessionId}?rid={requestId}` when the stream headers arrive.
4. Persist assistant message after stream ends (same `requestId` as the user turn).
5. List/load use lean projections + compound indexes.
6. Optional: `POST /api/chat/session` mints an empty session for URL-first UX.

## Invariants

1. Database connection attempted before serving traffic; health reports `mongo` status.
2. Protected routes must use `auth.middleware.js`.
3. Config only from env / `config/` — never hard-code secrets.
4. No Firebase Admin / Firestore / client Firebase in this stack.
