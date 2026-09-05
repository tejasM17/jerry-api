"use strict";

/**
 * Backend tests for the chat router.
 *
 * Run with: `npm test`
 *
 * Strategy:
 *   - Use Node's built-in `node:test` + `supertest`.
 *   - Avoid real Firebase, real Mongo, real Gemini by pre-seeding
 *     `require.cache` with lightweight stubs BEFORE the router,
 *     models, and middleware modules are loaded.
 *   - Build a minimal Express app, mount the real `routes/chat.routes.js`,
 *     and exercise the router end-to-end (auth → mongo → handler → stream).
 *
 * Covers:
 *   1. /api/chat/all without auth → 401
 *   2. /api/chat/all with mocked auth + mocked Mongo → 200 JSON
 *   3. /api/chat/new with mocked Mongo + mocked Gemini (success) →
 *      streams text, sets X-Session-Id and X-Request-Id, persists messages.
 *   4. /api/chat/new with mocked Gemini THROW →
 *      fallback message reaches client + persisted as assistant message.
 *   5. Gemini error is logged with a diagnostic hint (no key material).
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SUPERTEST_PATH = require.resolve("supertest");
const SUPERTEST_REQ = SUPERTEST_PATH.replace(/lib\/supertest\.js$/, "lib");
require(SUPERTEST_REQ); // ensure module is loadable; supertest is required fresh below

// ---------------------------------------------------------------------------
// 1) Build stubs and inject them into require.cache BEFORE the router loads.
// ---------------------------------------------------------------------------

const TEST_USER_ID = "user_test_123";
const FAKE_SESSION_ID = "11111111-2222-4333-8444-555555555555";
const FAKE_REQUEST_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// In-memory stores for Chat / Message so the real Chat.service can persist rows
// even though mongoose is faked.
const chatStore = new Map(); // _id -> doc
const messageStore = []; // [{ _id, chatId, ... }]
let nextObjectId = 1;
// Deterministic per-test message timestamps — `truncateFromMessage` filters by
// `createdAt > target.createdAt`, so messages created in the same millisecond
// would otherwise be ambiguous.
let messageTimestampBase = 1_700_000_000_000;

function fakeObjectId() {
  // Mint a fresh 24-char hex id (Mongo ObjectId shape) so isValidObjectId()
  // passes for these ids. toString() and valueOf() both return the id so
  // String(_id) and _id.valueOf() agree and the id is stable for the
  // lifetime of the object.
  const id = nextObjectId++;
  const hex = id.toString(16).padStart(24, "0");
  return { toString: () => hex, valueOf: () => hex };
}

function fakeChatCreate({ userId, title, sessionId }) {
  const _id = fakeObjectId();
  const now = new Date();
  const doc = {
    _id,
    sessionId: sessionId || FAKE_SESSION_ID,
    userId,
    title: title || "New chat",
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  chatStore.set(String(_id.valueOf()), doc);
  return doc;
}

function fakeMessageCreate(input) {
  const _id = fakeObjectId();
  const now = new Date(messageTimestampBase++);
  const doc = {
    _id,
    chatId: input.chatId,
    userId: input.userId,
    role: input.role,
    content: input.content || "",
    attachments: input.attachments || [],
    requestId: input.requestId || null,
    createdAt: now,
    updatedAt: now,
  };
  messageStore.push(doc);
  return doc;
}

// --- Stub @google/generative-ai -------------------------------------------
let geminiBehavior = "success"; // "success" | "throw-auth" | "throw-model"
let geminiCalls = 0;

const fakeGenerativeModel = {
  generateContentStream: async ({ contents }) => {
    geminiCalls += 1;
    if (geminiBehavior === "throw-auth") {
      const err = new Error("API key not valid");
      err.status = 401;
      throw err;
    }
    if (geminiBehavior === "throw-model") {
      const err = new Error("model not found");
      err.status = 404;
      throw err;
    }
    const promptText =
      (contents &&
        contents[0] &&
        contents[0].parts &&
        contents[0].parts[0] &&
        contents[0].parts[0].text) ||
      "";
    const reply = `pong for: ${promptText.slice(0, 10)}`;
    async function* gen() {
      yield { text: () => reply.split(" ")[0] + " " };
      yield { text: () => reply.split(" ").slice(1).join(" ") };
    }
    return { stream: gen() };
  },
};

const fakeGenAi = {
  getGenerativeModel: () => fakeGenerativeModel,
};

const geminiStub = {
  GoogleGenerativeAI: function () {
    return fakeGenAi;
  },
};

// --- Stub firebase-admin (ID token verify) --------------------------------
const firebaseAdminStub = {
  apps: [{}],
  initializeApp() {},
  credential: { cert: () => ({}) },
  auth: () => ({
    verifyIdToken: async (token) => {
      if (!token) throw new Error("No token provided");
      return {
        uid: TEST_USER_ID,
        email: "test@example.com",
        name: "Test User",
        picture: null,
      };
    },
  }),
  isFirebaseConfigured: () => true,
};

// --- Stub mongoose --------------------------------------------------------
function makeChainable(queryResult) {
  const chain = {
    select() {
      return chain;
    },
    sort() {
      return chain;
    },
    limit() {
      return chain;
    },
    lean: async () => queryResult(),
  };
  return chain;
}

function findChatByFilter(filter) {
  for (const doc of chatStore.values()) {
    if (filter.sessionId && doc.sessionId === filter.sessionId) return doc;
    if (filter._id && String(doc._id.valueOf()) === String(filter._id))
      return doc;
    if (filter.userId && doc.userId === filter.userId) return doc;
  }
  return null;
}

const fakeChatModel = {
  create: async (input) => fakeChatCreate(input),
  findOne: (filter) => ({
    select() {
      return this;
    },
    lean: async () => findChatByFilter(filter || {}),
  }),
  find: (filter = {}) => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => {
      const rows = [];
      for (const doc of chatStore.values()) {
        if (filter.userId && doc.userId !== filter.userId) continue;
        if (filter.deletedAt === null && doc.deletedAt !== null) continue;
        rows.push(doc);
      }
      return rows;
    },
  }),
  updateOne: async () => ({ acknowledged: true }),
  findOneAndUpdate: async (filter) => findChatByFilter(filter || {}),
};

const fakeMessageModel = {
  create: async (input) => fakeMessageCreate(input),
  find: (filter) => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => {
      let rows = messageStore.filter(
        (m) =>
          !filter.chatId ||
          String(m.chatId.valueOf()) === String(filter.chatId.valueOf()),
      );
      // Honour simple { createdAt: { $gt: someDate } } filters used by
      // truncateFromMessage when tests assert post-delete state directly.
      if (filter.createdAt && filter.createdAt.$gt) {
        const cutoff = filter.createdAt.$gt;
        rows = rows.filter((m) => m.createdAt > cutoff);
      }
      return rows;
    },
  }),
  findOne: (filter) => {
    const match =
      messageStore.find(
        (m) =>
          (!filter.chatId ||
            String(m.chatId.valueOf()) ===
              String(filter.chatId.valueOf())) &&
          (!filter._id || String(m._id.valueOf()) === String(filter._id)),
      ) || null;
    // Real mongoose's `findOne(...)` returns a Query (chainable + thenable)
    // that exposes `.lean()`. Service code does
    // `Message.findOne(...).lean()` and then awaits it.
    return {
      lean: () => Promise.resolve(match),
    };
  },
  findOneAndDelete: async (filter) => {
    const match = messageStore.find(
      (m) =>
        (!filter.chatId ||
          String(m.chatId.valueOf()) === String(filter.chatId.valueOf())) &&
        (!filter._id || String(m._id.valueOf()) === String(filter._id)),
    );
    if (!match) return null;
    const idx = messageStore.indexOf(match);
    messageStore.splice(idx, 1);
    return match;
  },
  findByIdAndUpdate: (id, update) => {
    const target = messageStore.find(
      (m) => String(m._id.valueOf()) === String(id),
    );
    if (!target) return null;
    if (update && update.$set) {
      Object.assign(target, update.$set);
      target.updatedAt = new Date();
    }
    // Real mongoose's `findByIdAndUpdate(...)` returns a Query that
    // exposes `.lean()` — service code chains `.lean()` and awaits it.
    return {
      lean: () => Promise.resolve(target),
    };
  },
  updateOne: async (filter, update) => {
    const target = messageStore.find(
      (m) =>
        (!filter._id ||
          String(m._id.valueOf()) === String(filter._id.valueOf())),
    );
    if (target && update && update.$set) {
      Object.assign(target, update.$set);
      target.updatedAt = new Date();
      return { acknowledged: true, matchedCount: 1 };
    }
    return { acknowledged: true, matchedCount: 0 };
  },
  deleteMany: async (filter) => {
    let removed = 0;
    for (let i = messageStore.length - 1; i >= 0; i--) {
      const m = messageStore[i];
      const sameChat =
        !filter.chatId ||
        String(m.chatId.valueOf()) === String(filter.chatId.valueOf());
      if (!sameChat) continue;
      if (filter.createdAt && filter.createdAt.$gt) {
        if (m.createdAt > filter.createdAt.$gt) {
          messageStore.splice(i, 1);
          removed += 1;
        }
      } else {
        messageStore.splice(i, 1);
        removed += 1;
      }
    }
    return { acknowledged: true, deletedCount: removed };
  },
};

function makeFakeMongoose() {
  const connection = {
    readyState: 1,
  };

  function makeSchema() {
    const statics = {};
    const schema = {
      index() {
        return this;
      },
      set() {
        return this;
      },
      static(name, fn) {
        statics[name] = fn;
        return this;
      },
      methods() {
        return this;
      },
      virtual() {
        return this;
      },
      statics,
    };
    return schema;
  }
  makeSchema.Types = {
    ObjectId: function () {},
  };

  const conn = {
    connection,
    Types: { ObjectId: { isValid: () => true } },
    Schema: makeSchema,
    mongo: { GridFSBucket: function () {} },
    model: (name) => {
      if (name === "Chat") return fakeChatModel;
      if (name === "Message") return fakeMessageModel;
      return {};
    },
    connect: async () => {
      connection.readyState = 1;
      return { connection };
    },
    set: () => {},
  };
  return conn;
}

// --- Stub config/db -------------------------------------------------------
const fakeDb = {
  connectDB: async () => {},
  getGridFSBucket: () => ({}),
  isMongoConnected: () => true,
  resolveMongoUri: () => "mongodb://stub",
};

// --- Inject stubs BEFORE the router is loaded -----------------------------
function inject(name, exports) {
  const resolved = require.resolve(name);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

inject("@google/generative-ai", geminiStub);
inject("firebase-admin", firebaseAdminStub);
inject("mongoose", makeFakeMongoose());
inject(path.resolve(__dirname, "..", "config/db.js"), fakeDb);
inject(path.resolve(__dirname, "..", "config/firebase.js"), firebaseAdminStub);

require("../middleware/auth.middleware");

// --- Build a minimal app for testing --------------------------------------
const express = require("express");
const requireMongo = require("../middleware/mongo.middleware");
const chatRoutes = require("../routes/chat.routes");

function buildApp() {
  const app = express();
  app.use(express.json());

  // Firebase ID token verification is stubbed via firebase-admin.
  app.use("/api/chat", chatRoutes);
  return app;
}

const request = require("supertest");

// ---------------------------------------------------------------------------
// 2) Tests
// ---------------------------------------------------------------------------

let app;
before(async () => {
  // Make sure GEMINI_API_KEY is present so config/gemini.js doesn't throw.
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test_key";
  process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-test";
  app = buildApp();
});

beforeEach(() => {
  geminiBehavior = "success";
  geminiCalls = 0;
  chatStore.clear();
  messageStore.length = 0;
  nextObjectId = 1;
  messageTimestampBase = 1_700_000_000_000;
});

after(() => {
  // No background handles to close.
});

function authHeader() {
  return { Authorization: `Bearer ${TEST_USER_ID}-jwt` };
}

test("GET /api/chat/all without Authorization header returns 401", async () => {
  const res = await request(app).get("/api/chat/all");
  assert.equal(res.status, 401);
});

test("GET /api/chat/all with mocked Firebase + Mongo returns 200 JSON", async () => {
  // Seed a chat so listChats has something to return.
  fakeChatCreate({ userId: TEST_USER_ID, title: "Hello" });

  const res = await request(app)
    .get("/api/chat/all")
    .set(authHeader());

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].title, "Hello");
});

test("POST /api/chat/new happy path: streams text and sets X-Session-Id", async () => {
  geminiBehavior = "success";
  const res = await request(app)
    .post("/api/chat/new")
    .set(authHeader())
    .send({ prompt: "hello gemini" });

  // supertest buffers streams via .text() — fall back if not present
  const body = res.text || "";
  assert.equal(res.status, 200);
  assert.match(body, /pong for: hello gemi/);
  // X-Session-Id is a generated UUID; assert shape only.
  assert.match(
    res.headers["x-session-id"] || "",
    /^[0-9a-f-]{36}$/i,
    "X-Session-Id must be a UUID",
  );
  assert.ok(res.headers["x-request-id"], "X-Request-Id must be set");
  // X-User-Message-Id must be the just-persisted user message's ObjectId
  // (24-char hex) so the SPA can pin it onto its optimistic local copy and
  // pass it to the edit endpoint later.
  assert.match(
    res.headers["x-user-message-id"] || "",
    /^[0-9a-f]{24}$/i,
    "X-User-Message-Id must be a 24-char hex ObjectId",
  );
  assert.ok(geminiCalls >= 1, "Gemini must be called at least once");
});

test("POST /api/chat/:chatId/continue: streams and sets X-User-Message-Id", async () => {
  const chat = fakeChatCreate({ userId: TEST_USER_ID, title: "Continue me" });
  fakeMessageCreate({
    chatId: chat._id,
    userId: TEST_USER_ID,
    role: "user",
    content: "first",
    requestId: null,
  });

  const res = await request(app)
    .post(`/api/chat/${chat.sessionId}/continue`)
    .set(authHeader())
    .send({ prompt: "second" });

  assert.equal(res.status, 200);
  // The stub echoes contents[0].parts[0].text (the first user message in
  // history), not the new prompt — that is fine, we just want a 200 stream.
  assert.match(res.text || "", /pong for: /);
  assert.match(
    res.headers["x-user-message-id"] || "",
    /^[0-9a-f]{24}$/i,
    "X-User-Message-Id must be a 24-char hex ObjectId",
  );
});

test("POST /api/chat/new with Gemini error: client receives fallback message", async () => {
  geminiBehavior = "throw-auth";

  const res = await request(app)
    .post("/api/chat/new")
    .set(authHeader())
    .send({ prompt: "hello" });

  assert.equal(res.status, 200);
  const body = res.text || "";
  assert.match(
    body,
    /\[Error generating response\. Please try again\.\]/,
    "client must receive the fallback message",
  );

  // The fallback assistant message must also be persisted so the conversation
  // stays consistent on reload.
  const assistantMsgs = messageStore.filter(
    (m) => m.role === "assistant" && m.content.startsWith("[Error generating"),
  );
  assert.ok(
    assistantMsgs.length >= 1,
    "fallback assistant message must be persisted",
  );
});

test("POST /api/chat/new with Gemini model-not-found: client receives fallback", async () => {
  geminiBehavior = "throw-model";
  const res = await request(app)
    .post("/api/chat/new")
    .set(authHeader())
    .send({ prompt: "hello" });

  assert.equal(res.status, 200);
  assert.match(res.text, /\[Error generating response\. Please try again\.\]/);
});

test("POST /api/chat/new rejects empty prompt with 400", async () => {
  const res = await request(app)
    .post("/api/chat/new")
    .set(authHeader())
    .send({ prompt: "   " });

  assert.equal(res.status, 400);
});

test("GET /api/chat/:chatId returns messages for the owner", async () => {
  const chat = fakeChatCreate({ userId: TEST_USER_ID, title: "Owned" });
  fakeMessageCreate({
    chatId: chat._id,
    userId: TEST_USER_ID,
    role: "user",
    content: "hi",
    requestId: null,
  });

  const res = await request(app)
    .get(`/api/chat/${chat.sessionId}`)
    .set(authHeader());

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].role, "user");
  assert.equal(res.body[0].content, "hi");
});

test("GET /api/chat/:chatId returns 403 for an unknown chat", async () => {
  const res = await request(app)
    .get(`/api/chat/${FAKE_SESSION_ID}`)
    .set(authHeader());

  // controller returns 403 via chatService.getMessages → forbidden
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// PUT /api/chat/:chatId/edit/:messageId  (editMessage)
// ---------------------------------------------------------------------------

function seedConversation() {
  // Returns { chat, userMsg, assistantMsg, afterAssistant } — three messages
  // with strictly-increasing createdAt so we can assert truncation precisely.
  const chat = fakeChatCreate({ userId: TEST_USER_ID, title: "Edit me" });
  const userMsg = fakeMessageCreate({
    chatId: chat._id,
    userId: TEST_USER_ID,
    role: "user",
    content: "hi",
    requestId: FAKE_REQUEST_ID,
  });
  const assistantMsg = fakeMessageCreate({
    chatId: chat._id,
    userId: TEST_USER_ID,
    role: "assistant",
    content: "hello there",
    requestId: FAKE_REQUEST_ID,
  });
  const afterAssistant = fakeMessageCreate({
    chatId: chat._id,
    userId: TEST_USER_ID,
    role: "user",
    content: "and one more",
    requestId: null,
  });
  return { chat, userMsg, assistantMsg, afterAssistant };
}

test("PUT /api/chat/:chatId/edit/:messageId without auth returns 401", async () => {
  const { chat, userMsg } = seedConversation();
  const res = await request(app)
    .put(`/api/chat/${chat.sessionId}/edit/${String(userMsg._id.valueOf())}`)
    .send({ prompt: "updated" });
  assert.equal(res.status, 401);
});

test("PUT edit/:messageId rejects empty prompt with 400", async () => {
  const { chat, userMsg } = seedConversation();
  const res = await request(app)
    .put(`/api/chat/${chat.sessionId}/edit/${String(userMsg._id.valueOf())}`)
    .set(authHeader())
    .send({ prompt: "   " });
  assert.equal(res.status, 400);
  // No state change on a 400 — all three messages still present.
  assert.equal(messageStore.length, 3);
});

test("PUT edit/:messageId returns 404 when messageId is not a valid ObjectId", async () => {
  const { chat } = seedConversation();
  const res = await request(app)
    .put(`/api/chat/${chat.sessionId}/edit/not-an-objectid`)
    .set(authHeader())
    .send({ prompt: "updated" });
  assert.equal(res.status, 404);
  assert.equal(messageStore.length, 3);
});

test("PUT edit/:messageId returns 404 when messageId belongs to a different chat", async () => {
  const { chat, userMsg } = seedConversation();
  // Create a sibling chat and a message there — referencing it from `chat`'s
  // route must 404 because the chat-scope guard filters it out.
  const other = fakeChatCreate({
    userId: TEST_USER_ID,
    title: "Other",
    sessionId: "22222222-3333-4444-8555-666666666666",
  });
  const otherMsg = fakeMessageCreate({
    chatId: other._id,
    userId: TEST_USER_ID,
    role: "user",
    content: "stranger",
    requestId: null,
  });

  const res = await request(app)
    .put(`/api/chat/${chat.sessionId}/edit/${String(otherMsg._id.valueOf())}`)
    .set(authHeader())
    .send({ prompt: "hijack" });

  assert.equal(res.status, 404);
  // All three original messages still present; nothing was truncated.
  assert.equal(messageStore.length, 4);
});

test("PUT edit/:messageId rejects non-user (assistant) target with 400", async () => {
  const { chat, assistantMsg } = seedConversation();
  const res = await request(app)
    .put(
      `/api/chat/${chat.sessionId}/edit/${String(assistantMsg._id.valueOf())}`,
    )
    .set(authHeader())
    .send({ prompt: "nope" });

  assert.equal(res.status, 400);
  // Critical: a non-user edit must NOT truncate the conversation.
  assert.equal(messageStore.length, 3);
  assert.ok(
    messageStore.find((m) => m._id === assistantMsg._id),
    "assistant message still present",
  );
});

test("PUT edit/:messageId happy path: truncates after-target, streams, persists", async () => {
  geminiBehavior = "success";
  const { chat, userMsg, assistantMsg, afterAssistant } = seedConversation();

  const res = await request(app)
    .put(`/api/chat/${chat.sessionId}/edit/${String(userMsg._id.valueOf())}`)
    .set(authHeader())
    .send({ prompt: "hi updated" });

  assert.equal(res.status, 200);
  assert.match(res.text || "", /pong for: hi updated/);

  // Stream headers — public sessionId and requestId must be present.
  assert.match(
    res.headers["x-session-id"] || "",
    /^[0-9a-f-]{36}$/i,
    "X-Session-Id must be a UUID",
  );
  assert.ok(res.headers["x-request-id"], "X-Request-Id must be set");

  // Post-state assertions on the in-memory store.
  // 1. Anything that came after the edited user message is gone.
  assert.ok(
    !messageStore.find((m) => m._id === assistantMsg._id),
    "the assistant reply that came after the edit target was truncated",
  );
  assert.ok(
    !messageStore.find((m) => m._id === afterAssistant._id),
    "the user follow-up that came after the edit target was truncated",
  );

  // 2. The edited user message now carries the new prompt.
  const editedUser = messageStore.find((m) => m._id === userMsg._id);
  assert.ok(editedUser, "edited user message still present");
  assert.equal(editedUser.content, "hi updated");

  // 3. A new assistant reply was persisted with the same requestId.
  const newAssistant = messageStore.find(
    (m) => m.role === "assistant" && m.requestId === res.headers["x-request-id"],
  );
  assert.ok(newAssistant, "new assistant message persisted");
  assert.match(newAssistant.content, /pong for: hi updated/);
});

test("PUT edit/:messageId with Gemini error: fallback persisted, no orphan assistant", async () => {
  geminiBehavior = "throw-auth";
  const { chat, userMsg, assistantMsg } = seedConversation();

  const res = await request(app)
    .put(`/api/chat/${chat.sessionId}/edit/${String(userMsg._id.valueOf())}`)
    .set(authHeader())
    .send({ prompt: "hi again" });

  assert.equal(res.status, 200);
  assert.match(
    res.text || "",
    /\[Error generating response\. Please try again\.\]/,
  );

  // Fallback assistant message must be persisted with the requestId from the
  // stream headers so it pairs with the edited user turn.
  const reqId = res.headers["x-request-id"];
  const fallback = messageStore.find(
    (m) =>
      m.role === "assistant" &&
      m.requestId === reqId &&
      m.content.startsWith("[Error generating"),
  );
  assert.ok(fallback, "fallback assistant message persisted with requestId");

  // The original assistant reply that came after the target is gone.
  assert.ok(
    !messageStore.find((m) => m._id === assistantMsg._id),
    "post-target messages were truncated before the fallback persisted",
  );
});

// ---------------------------------------------------------------------------
// PATCH /api/chat/:chatId/message/:messageId  (updateMessage)
// ---------------------------------------------------------------------------

test("PATCH /api/chat/:chatId/message/:messageId without auth returns 401", async () => {
  const { chat, userMsg } = seedConversation();
  const res = await request(app)
    .patch(
      `/api/chat/${chat.sessionId}/message/${String(userMsg._id.valueOf())}`,
    )
    .send({ content: "noop" });
  assert.equal(res.status, 401);
});

test("PATCH message/:messageId updates content without touching later messages", async () => {
  const { chat, userMsg, assistantMsg, afterAssistant } = seedConversation();

  const res = await request(app)
    .patch(
      `/api/chat/${chat.sessionId}/message/${String(userMsg._id.valueOf())}`,
    )
    .set(authHeader())
    .send({ content: "edited text only" });

  assert.equal(res.status, 200);
  assert.equal(res.body.role, "user");
  assert.equal(res.body.content, "edited text only");
  assert.equal(String(res.body.id), String(userMsg._id.valueOf()));
  assert.equal(res.body.requestId, FAKE_REQUEST_ID);

  // The user message is updated in place.
  const editedUser = messageStore.find((m) => m._id === userMsg._id);
  assert.equal(editedUser.content, "edited text only");

  // PATCH does NOT truncate later messages — only edit (PUT) does.
  assert.equal(messageStore.length, 3);
  assert.ok(
    messageStore.find((m) => m._id === assistantMsg._id),
    "assistant message preserved",
  );
  assert.ok(
    messageStore.find((m) => m._id === afterAssistant._id),
    "follow-up message preserved",
  );
});

test("PATCH message/:messageId returns 404 when message not in chat", async () => {
  const { chat } = seedConversation();
  const other = fakeChatCreate({
    userId: TEST_USER_ID,
    title: "Other",
    sessionId: "33333333-4444-4555-8666-777777777777",
  });
  const otherMsg = fakeMessageCreate({
    chatId: other._id,
    userId: TEST_USER_ID,
    role: "user",
    content: "stranger",
    requestId: null,
  });

  const res = await request(app)
    .patch(
      `/api/chat/${chat.sessionId}/message/${String(otherMsg._id.valueOf())}`,
    )
    .set(authHeader())
    .send({ content: "hijack" });

  assert.equal(res.status, 404);
  // The stranger message must not have been mutated.
  const after = messageStore.find((m) => m._id === otherMsg._id);
  assert.equal(after.content, "stranger");
});
