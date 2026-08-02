# AI Workflow Rules

## Approach

This file captures the workflow conventions for the **Jerry backend** (`jerry-api`). It reflects the layered architecture, AI integration, and configuration patterns described in the codebase. The rules below guide how we incrementally develop backend features while keeping documentation, tests, and builds in sync.

## Approach

Build this project incrementally using a spec-driven workflow. Context files define what to build, how to build it, and what the current state of progress is. Always implement against these specs — do not infer or invent behavior from scratch.

## Backend Overview

The **Jerry API** is a Node.js service using Express (or Fastify) with a clear layered architecture:

- **Entry point**: `server.js` creates the HTTP server, loads middleware, connects to MongoDB, and mounts routers.
- **Configuration** lives in `config/` (`db.js`, `clerk.js`, `gemini.js`) so environment‑specific values (DB URIs, API keys) are centralized.
- **Middleware** (`middleware/`) handles cross‑cutting concerns such as authentication (`auth.middleware.js`) and file uploads (`upload.middleware.js`).
- **Routes** (`routes/`) map URLs to controllers; each controller delegates to the **service** layer.
- **Controllers** (`controllers/`) contain thin request‑response handling and call the corresponding service functions.
- **Services** (`services/`) encapsulate business logic and external integrations, e.g., the Gemini AI client (`gemini.js`) used by `chat.controller.js`.
- **Models** (`models/`) define Mongoose schemas for persisted entities like `User`.
- **Utilities** (`utils/`) provide logging, error formatting, and helper functions.
- **Context documentation** (`context/`) stores specification markdown files that guide development and must be kept up‑to‑date.

This structure enables incremental, testable changes: a new feature typically touches only one of the layers (e.g., adding a new service function and its controller) without modifying unrelated parts.



- Work on one feature unit or subsystem at a time.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine unrelated system boundaries in a single implementation step.

## When To Split Work

Split an implementation step if it combines:

- UI changes and background task changes
- Real-time Chat sessions and database persistence
- Multiple unrelated API routes
- Behavior that is not clearly defined in the context files

If a change cannot be verified end to end quickly, the scope is too broad — split it.

## Handling Missing Requirements

- Do not invent product behavior not defined in the context files
- If a requirement is ambiguous, resolve it in the relevant context file before implementing
- If a requirement is missing, add it as an open question in `progress-tracker.md` before continuing

## Protected Files

Do not modify the following unless explicitly instructed:

- `scr/*` — React UI library components
- third-party library internals

These should remain default and reusable.

Project-specific styling, layout changes, and feature logic must be implemented in app-level components instead of modifying foundation components.

Only modify these files when a task explicitly requires it.

## Keeping Docs in Sync

Update the relevant context file whenever implementation changes:

- System architecture or boundaries
- Storage model decisions
- Code conventions or standards
- Feature scope

Progress state must reflect the actual state of the implementation, not the intended state.

## Before Moving to the Next Unit

1. The current unit works end to end within its defined scope
2. No invariant defined in `architecture.md` was violated
3. `progress-tracker.md` reflects the completed work
4. `npm run build` passes
