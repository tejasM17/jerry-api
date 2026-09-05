const path = require("path");
const fs = require("fs");
const nodeEnv = (process.env.NODE_ENV || "").trim();
// Local/dev: prefer .env.development. Production (Render) uses dashboard env only —
// never load a committed .env.development file on the host.
const envCandidates =
  nodeEnv === "production"
    ? []
    : nodeEnv === "development"
      ? [".env.development", ".env"]
      : [".env", ".env.development"];
for (const name of envCandidates) {
  const full = path.resolve(process.cwd(), name);
  if (fs.existsSync(full)) {
    require("dotenv").config({ path: full });
    break;
  }
}

const express = require("express");
const cors = require("cors");
const { connectDB } = require("./config/db");

const chatRoutes = require("./routes/chat.routes");
const authRoutes = require("./routes/auth.routes");
const profileRoutes = require("./routes/profile.routes");

const app = express();

// Connect to Database (awaited before listen so /health is accurate)

function normalizeOrigin(url) {
  if (!url) return null;
  return String(url).trim().replace(/\/+$/, "");
}

const extraOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedOrigins = new Set(
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    normalizeOrigin(process.env.FRONTEND_URL),
    ...extraOrigins,
  ].filter(Boolean),
);

function isAllowedOrigin(origin) {
  if (allowedOrigins.has(origin)) return true;
  const isDevelopment = nodeEnv === "development";
  if (
    isDevelopment &&
    (origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:"))
  ) {
    return true;
  }
  if (process.env.ALLOW_VERCEL_PREVIEWS === "true") {
    try {
      const host = new URL(origin).hostname;
      if (host.endsWith(".vercel.app")) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        console.error(`CORS Error: Origin ${origin} not allowed`);
        // false → omit CORS headers (browser blocks). Do not throw: that was a 500 on preflight.
        callback(null, false);
      }
    },
    credentials: true,
    exposedHeaders: [
      "X-Chat-Id",
      "X-Session-Id",
      "X-Request-Id",
      "X-Chat-Title",
      "X-User-Message-Id",
    ],
  }),
);

app.use(express.json());

app.use("/api/chat", chatRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);

app.get("/", (req, res) => {
  res.send("Jerry API Running");
});

app.get("/health", (req, res) => {
  const { isMongoConnected } = require("./config/db");
  const { isFirebaseConfigured } = require("./config/firebase");
  res.json({
    ok: true,
    auth: "firebase",
    firebase: isFirebaseConfigured() ? "configured" : "missing-env",
    mongo: isMongoConnected() ? "connected" : "disconnected",
    chatStore: "mongodb",
    gemini: process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS ? "configured" : "missing-env",
    env: nodeEnv || "default",
  });
});

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log("Auth: Firebase (ID token verification)");
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
