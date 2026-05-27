const path = require("path");
const nodeEnv = (process.env.NODE_ENV || "").trim();
const envFile = nodeEnv === "development" ? ".env.development" : ".env";
require("dotenv").config({ path: path.resolve(process.cwd(), envFile) });

const express = require("express");
const cors = require("cors");

const chatRoutes = require("./routes/chat.routes");
const authRoutes = require("./routes/auth.routes");

const app = express();

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
  }),
);

app.use(express.json());

app.use("/api/chat", chatRoutes);
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.send("Firebase AI Backend Running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
