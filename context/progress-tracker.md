# Progress Tracker

Keep this file short. Read feature specs + code for detail.

## Phase

- **Firebase fully removed** — chats/messages/users/files on MongoDB only; no `firebase-admin` / client Firebase.
- **Chat store migration** — `Chat` + `Message` models, `services/chat.service.js`, controllers/routes rewritten.
- **Session URLs (Grok-style)** — public `sessionId` UUID on chats; `requestId` on turns; routes resolve UUID or legacy ObjectId; `POST /api/chat/session`; stream headers `X-Session-Id` / `X-Request-Id`.
- **Latency** — local titles, stream headers early, auth ownership cache, lean list queries.
- **Auth** — Firebase Admin from `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`. Production CORS uses `FRONTEND_URL` (no throw on reject). Private key PEM `\n` + quote stripping for Render.
- **Observability** — per-request logger middleware on chat router (`[chat] METHOD path → status ms`); `withRetry` logs non-retryable Gemini failures with key index, status, and a diagnostic hint (no key material). Fallback assistant message is persisted so the conversation stays consistent on reload.
- **Tests** — `node:test` + `supertest` at `tests/chat.routes.test.js` (19/19 passing); covers auth, gating, streaming happy path, the Gemini-failure fallback path, `editMessage` (PUT) + `updateMessage` (PATCH) routes end-to-end, and `X-User-Message-Id` header on `/chat/new` + `/chat/:chatId/continue`.

## Stack (quick)

| Layer | Tech |
| --- | --- |
| App | Node.js + Express 5 |
| Auth | Firebase Admin (ID tokens) |
| Data | MongoDB Mongoose (`User`, `Chat`, `Message`) + GridFS |
| AI | Google Gemini stream |
| CORS | `FRONTEND_URL` + `CORS_ORIGINS` + localhost; no 500 on reject |

## API map (chat)

`:chatId` = public **sessionId UUID** (preferred) or legacy Mongo ObjectId.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/chat/session` | Empty session JSON `{ id, sessionId, title }` |
| POST | `/api/chat/new` | Create + stream; `X-Session-Id`, `X-Request-Id`, `X-User-Message-Id` |
| GET | `/api/chat/all` | User chats (`id` = sessionId) |
| GET | `/api/chat/recent` | `?limit=` |
| GET | `/api/chat/search` | `?q=` text/regex title |
| GET | `/api/chat/:chatId` | Messages (ownership) |
| DELETE | `/api/chat/:chatId` | Delete chat + messages |
| PATCH | `/api/chat/:chatId/rename` | Rename title |
| POST | `/api/chat/:chatId/continue` | Stream follow-up; `X-User-Message-Id` |
| PUT | `/api/chat/:chatId/edit/:messageId` | Truncate + re-stream |
| PATCH | `/api/chat/:chatId/message/:messageId` | Update content |
| DELETE | `/api/chat/:chatId/message/:messageId` | Delete one message |
| POST | `/api/chat/upload` | GridFS |
| GET | `/api/chat/files/:fileId` | Public binary (img tags) |

## Verification

- `npm run smoke` — public health + 401 on protected routes + firebase-token 404 (7/7).
- `npm test` — `node:test` + `supertest` against the chat router (19/19): auth gating, list, streaming success, Gemini-error fallback (auth + model 404), empty prompt 400, owned fetch, unknown fetch 403, the `editMessage` (PUT) and `updateMessage` (PATCH) routes end-to-end (happy / non-user / 404 / 401 / fallback), and the `X-User-Message-Id` header on `/chat/new` + `/chat/:chatId/continue`.
- Frontend `npm run build` passes.
- Mongo still **disconnected** until `MONGODB_PASSWORD` is set for Atlas user `jerry-files`.

## Open / ops

- **Resolved (2026-08-02):** prod crash "bad auth : authentication failed" on Render. Cause: `MONGODB_URI` on Render still contained the literal `<db_password>` placeholder. The currently deployed commit (May 29, `4cf1c31`) does not perform password substitution and exits 1 on auth failure → restart loop. Fixed by inlining the real password into the Render `MONGODB_URI`; live deploy `dep-d9niif3m8hqs73ee6q10` now connects to Atlas cleanly. Also added a startup guard in `config/db.js` that fails fast with a clear error if a future deploy sees the placeholder without a `MONGODB_PASSWORD` env var.
- Optional Clerk JWT template claim `userId` for zero Clerk round-trips on ownership.
- Harden `getFile` with auth or signed URLs later.

## Architecture invariants

- Clerk is auth source of truth.
- `req.user.uid` owns all chat rows.
- Mongo is the only app data store (no Firestore).
