# Jerry Backend

## Overview

Jerry's backend is a Node.js service built with Express that provides API endpoints for authentication (Clerk), chat handling, and Google Gemini AI. All app data lives in **MongoDB** via Mongoose (users, chats, messages); binary assets use **GridFS**. There is **no Firebase** dependency.

## Goals

1. Expose secure RESTful API endpoints for profile sync, optional Firebase token exchange, and chat interactions.
2. Verify Clerk session JWTs on each request to enforce authentication and user‑level access control.
3. Persist user profiles, chat metadata, and related data in MongoDB while using Firestore for real‑time updates.
4. Forward user messages to the Gemini AI service and return generated responses.
5. Provide robust error handling, logging, and observability for production readiness.

## Core API Flow

1. **Authentication** – Clients send Clerk session tokens (`getToken()` from Clerk) as `Authorization: Bearer`. Middleware validates via Clerk JWKS / secret key.
2. **Protected Routes** – Chat and profile routes use `auth.middleware.js`, which attaches `req.user.uid` (legacy Firebase id via `externalId` when migrated).
3. **Chat Endpoint** – `POST /api/chat/message` receives a user message, forwards it to the Gemini service (`services/gemini.service.js`), stores the conversation reference in MongoDB, and returns the AI response.
4. **Profile Management** – Endpoints under `/api/user/*` allow updating user data (e.g., avatar URL). Uploaded files are stored in Firebase Storage via `upload.middleware.js`.

## Features

### Authentication & Authorization
- Firebase admin SDK verifies ID tokens.
- Middleware enforces ownership checks on resources.

### Chat Service
- Integration with Google Gemini API for AI‑generated replies.
- Message persistence in MongoDB (`Message` model).

### User Management
- CRUD endpoints for user profiles stored in MongoDB (`User` model).
- Avatar uploads stored in Firebase Storage.

### Configuration & Secrets
- Centralized in `config/` (`db.js`, `clerk.js`, `gemini.js`).
- Environment variables loaded from `.env` files; no secrets are hard‑coded.

## Architecture Summary

- **Entry Point**: `server.js` – sets up the Express/Fastify app, applies global middleware, connects to databases, and starts the HTTP server.
- **Config**: `config/` – database connections, Firebase admin initialization, Gemini client setup.
- **Middleware**: `middleware/` – authentication verification, file upload handling, request logging.
- **Routes**: `routes/` – defines API route groups and binds them to controllers.
- **Controllers**: `controllers/` – thin HTTP layer that delegates to services.
- **Services**: `services/` – business logic, external API calls (Gemini), and data access.
- **Models**: `models/` – Mongoose schemas for `User`, `Message`, etc.
- **Utils**: `utils/` – helper functions for logging, error formatting, and response standardization.
- **Context**: `context/` – documentation of standards, architecture, and workflow rules.

## Success Criteria

1. All protected endpoints reject unauthenticated requests with appropriate error codes.
2. Valid Firebase ID tokens allow access to user‑specific resources only.
3. Chat messages are correctly processed by Gemini and stored in MongoDB.
4. Avatar uploads succeed, storing files in Firebase Storage and updating user profiles.
5. `npm run test` passes (unit/integration tests for controllers and services) and `npm run build` succeeds.
