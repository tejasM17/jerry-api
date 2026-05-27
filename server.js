const path = require("path");
const nodeEnv = (process.env.NODE_ENV || "").trim();
const envFile = nodeEnv === "development" ? ".env.development" : ".env";
require("dotenv").config({ path: path.resolve(process.cwd(), envFile) });

const express = require("express");
const cors = require("cors");

const chatRoutes = require("./routes/chat.routes");
const authRoutes = require("./routes/auth.routes");

const app = express();

const allowedOrigins = ["http://localhost:5173", process.env.FRONTEND_URL];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
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
