"use strict";

/**
 * Lightweight API smoke checks (no Clerk token required for public routes).
 * Usage: NODE_ENV=development node scripts/smoke-api.js
 */
const path = require("path");
const fs = require("fs");

const envFile = path.resolve(__dirname, "..", ".env.development");
if (fs.existsSync(envFile)) {
  require("dotenv").config({ path: envFile });
}

const BASE = `http://127.0.0.1:${process.env.PORT || 5000}`;

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
    return false;
  }
}

async function main() {
  let ok = 0;
  let fail = 0;

  const run = async (name, fn) => {
    if (await check(name, fn)) ok += 1;
    else fail += 1;
  };

  await run("GET /", async () => {
    const res = await fetch(`${BASE}/`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    if (!/Jerry/i.test(text)) throw new Error("unexpected body");
  });

  await run("GET /health", async () => {
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (!body.ok) throw new Error(JSON.stringify(body));
    if (body.chatStore !== "mongodb") {
      throw new Error(`chatStore=${body.chatStore}`);
    }
    console.log(`  auth=${body.auth} mongo=${body.mongo}`);
  });

  await run("GET /api/chat/all without token → 401", async () => {
    const res = await fetch(`${BASE}/api/chat/all`);
    if (res.status !== 401) throw new Error(`expected 401 got ${res.status}`);
  });

  await run("GET /api/auth/me without token → 401", async () => {
    const res = await fetch(`${BASE}/api/auth/me`);
    if (res.status !== 401) throw new Error(`expected 401 got ${res.status}`);
  });

  await run("POST /api/chat/session without token → 401", async () => {
    const res = await fetch(`${BASE}/api/chat/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.status !== 401) throw new Error(`status=${res.status}`);
  });

  await run("POST /api/chat/new without token → 401", async () => {
    const res = await fetch(`${BASE}/api/chat/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    if (res.status !== 401) throw new Error(`expected 401 got ${res.status}`);
  });

  await run("firebase-token route removed → 404", async () => {
    const res = await fetch(`${BASE}/api/auth/firebase-token`, {
      method: "POST",
    });
    if (res.status !== 404) throw new Error(`expected 404 got ${res.status}`);
  });

  console.log(`\nSmoke: ${ok} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
