const path = require("path");
const fs = require("fs");
const nodeEnv = (process.env.NODE_ENV || "").trim();
// Prefer .env.development in local/dev; fall back so bare `node server.js` still boots.
const envCandidates =
  nodeEnv === "development"
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

// Connect to Database
connectDB();

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      const isDevelopment = nodeEnv === "development";
      const isLocalhost =
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:");

      if (allowedOrigins.includes(origin) || (isDevelopment && isLocalhost)) {
        callback(null, true);
      } else {
        console.error(`CORS Error: Origin ${origin} not allowed`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    // Let the SPA read streaming chat session metadata (Grok-style ids)
    exposedHeaders: [
      "X-Chat-Id",
      "X-Session-Id",
      "X-Request-Id",
      "X-Chat-Title",
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
  res.json({
    ok: true,
    auth: "firebase",
    mongo: isMongoConnected() ? "connected" : "disconnected",
    chatStore: "mongodb",
    env: nodeEnv || "default",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  // Clerk configuration removed; using Firebase auth
  console.log(`Server running on port ${PORT}`);
  console.log('Auth: Firebase (ID token verification)');
});
