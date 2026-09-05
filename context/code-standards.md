# Code Standards

## General

- Keep modules small and single‑purpose.
- Fix root causes — do not layer workarounds.
- Do not mix unrelated concerns in one file or route.
- Respect system boundaries defined in `architecture.md`.

## JavaScript / TypeScript

- Use strict mode (`"use strict"`).
- Prefer explicit TypeScript interfaces or types; avoid `any`.
- Validate all external input at system boundaries before trusting it.
- Keep type definitions colocated with the module they describe.

## Backend (Node.js / Express/Fastify)

- All route handlers must be thin and delegate business logic to the **service** layer.
- Services encapsulate core functionality and external integrations (Gemini AI, MongoDB).
- Middleware handles cross‑cutting concerns such as authentication (`auth.middleware.js`) and file uploads (`upload.middleware.js`).
- Controllers should only translate HTTP request/response objects to/from service calls.
- Errors are standardized via utility helpers in `utils/` and always return a consistent JSON shape.

## Configuration & Secrets

- All configuration lives in `config/` (e.g., `db.js`, `clerk.js`, `gemini.js`) and loads environment variables from `.env` files.
- Never hard‑code secrets or API keys; they must be read from process env variables.

## Data & Storage

- **MongoDB (Mongoose)** stores structured data like user profiles and chat metadata.
- **MongoDB** holds users, chats, and messages; **GridFS** holds uploaded files.
- Do not store large binary blobs directly in MongoDB.

## Auth and Access Model

- Verify Firebase ID tokens in `auth.middleware.js` using `firebase-admin` (`verifyIdToken`).
- Attach `req.user.uid` (prefer Clerk `externalId` / claim `userId` for migrated users) for ownership checks.
- Do not implement email/password login on the API; Clerk owns sign-in on the frontend.
- Services enforce ownership checks to ensure users can only access their own resources.

## File Organization

- `config/` — configuration and initialization of external services.
- `middleware/` — reusable request processing (auth, uploads).
- `routes/` — API route definitions that bind URLs to controllers.
- `controllers/` — thin HTTP layer delegating to services.
- `services/` — business logic and external API integration.
- `models/` — Mongoose schemas for persisted entities.
- `utils/` — helper functions for logging, error handling, and response formatting.
- `context/` — markdown documentation of architectural decisions, standards, and workflow rules.

## Runtime & Performance

- Keep long‑running work out of request handlers; offload to background jobs or the `trigger/` directory.
- Use async/await properly; handle promise rejections to avoid unhandled errors.
- Log structured JSON entries for observability.
- Write unit and integration tests for each service and controller; ensure authentication checks are covered.
