# Jerry AI Backend

## Overview
Jerry AI Backend is a pure Node.js RESTful API that powers the Jerry AI chatbot. It provides Firebase ID‑token based authentication, stores chat history and uploaded files in MongoDB (using GridFS), and generates AI responses via Google Gemini. The code runs unchanged on Windows, macOS, and Linux.

**Frontend repository:** https://github.com/tejasM17/jerry

## Features
- AI‑powered chat using **Gemini 2.0 Flash**.
- **Multimodal support** – upload images and documents to chat.
- **Auto‑title generation** – creates concise titles for new chat sessions.
- **Message editing** – edit previous prompts and re‑generate AI responses with history branching.
- **Reliability & rotation** – automatic Gemini API‑key rotation and retry logic for high availability.
- **System instructions** – customizable AI personality via a central system prompt.
- **Authentication** – Firebase ID‑token based auth.
- **Streaming responses** – real‑time text streaming for a responsive UI.
- **Cloud storage** – chat history in **MongoDB** and files in **MongoDB GridFS**.

## Prerequisites

| Tool | Minimum version | Install guide |
|------|------------------|---------------|
| Node.js | 18.x or newer | Windows: `choco install nodejs`; macOS: `brew install node`; Linux: use distro package manager or `nvm` |
| MongoDB | 4.4+ (or Atlas) | Follow MongoDB's official installation docs |
| Firebase project | – | Create a project in the Firebase console and enable Authentication & Firestore |
| Gemini API key | – | Obtain a key from Google AI Studio (Gemini) |

## Installing Node (cross‑platform)
- **Windows**: Download the Windows Installer from https://nodejs.org/ or run `choco install nodejs`.
- **macOS**: `brew install node` (requires Homebrew) or use the macOS installer.
- **Linux**: `sudo apt-get install -y nodejs npm` (Debian/Ubuntu) or install via `nvm`.

## Setup
```bash
# 1️⃣ Clone the repository
git clone https://github.com/tejasM17/jerry-api.git
cd jerry-api

# 2️⃣ Install npm dependencies
npm install

# 3️⃣ Copy the example environment file
# Bash / sh
cp .env.example .env.development
# PowerShell (Windows)
Copy-Item .env.example .env.development
```
Edit `.env.development` and fill in the required variables (see the table below).

```bash
# start the server in development mode (cross‑env handles NODE_ENV on all OSes)
npm run dev

# start the server in production mode
npm start
```

## Environment variables
| Variable | Required? | Description |
|---|---|---|
| `PORT` | No (default `5000`) | Port on which the API listens |
| `GEMINI_API_KEY` | Yes (or `GEMINI_API_KEYS`) | Gemini API key (single) |
| `GEMINI_API_KEYS` | Optional | Comma‑separated list for rotation |
| `GEMINI_MODEL` | No (default `gemini-3.5-flash`) | Gemini model name |
| `FRONTEND_URL` | No | Front‑end origin for CORS whitelist |
| `CORS_ORIGINS` | Optional | Additional comma‑separated origins |
| `ALLOW_VERCEL_PREVIEWS` | Optional (`false`) | Allow any `*.vercel.app` origin |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `MONGODB_PASSWORD` | Optional | Password to replace `<db_password>` placeholder |
| `MONGODB_DB_NAME` | Optional (`jerry`) | Database name if not present in URI |
| `FIREBASE_PROJECT_ID` | Yes | Firebase project identifier |
| `FIREBASE_CLIENT_EMAIL` | Yes | Service‑account client email |
| `FIREBASE_PRIVATE_KEY` | Yes | PEM‑encoded private key (escaped new‑lines) |
| `NODE_ENV` | No | Set to `development` when running `npm run dev` |

## Platform‑specific notes
- **Windows PowerShell**: Use `Copy-Item` for copying the env file; `cross‑env` works in PowerShell without extra configuration.
- **macOS**: Homebrew is the simplest way to manage Node and related tools.
- **Linux**: If you use `nvm`, run `nvm use 18` before `npm install`.

## Useful npm scripts
| Script | Purpose |
|--------|---------|
| `dev` | Runs the server with hot‑reloading (`cross‑env NODE_ENV=development nodemon server.js`). |
| `start` | Starts the compiled server in production (`node server.js`). |
| `smoke` | Executes a lightweight smoke test (`cross‑env NODE_ENV=development node scripts/smoke-api.js`). |
| `test` | Runs the test suite using Node’s built‑in test runner. |

## Health‑check endpoint
- `GET /health` – Returns a JSON status object reporting the health of the Express server, MongoDB connection, Firebase configuration, and Gemini client.

## API overview
The full API specification is in **Architecture-Backend-API.md**. Key route groups:
- **Auth** – `/api/auth/me`, `/api/auth/sync`
- **Profile** – `/api/profile/*`
- **Chat** – `/api/chat/*` (create, continue, edit, upload files, list, delete, etc.)

## Technologies used
- **Node.js** (≥ 18) – runtime
- **Express 5** – HTTP server & routing
- **MongoDB + GridFS** – persistent chat storage & file storage
- **Firebase Admin SDK** – authentication & user profile sync
- **Google Gemini** (`@google/generative-ai`) – AI generation
- **Multer** – file uploads
- **Cors** – CORS handling
- **dotenv** – environment‑variable loading

## License
MIT © 2024–2026 Tejas

_Last updated_: **2026‑09‑18**