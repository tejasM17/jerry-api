const { db } = require("../config/firebase");
const {
  streamGeminiResponse,
  generateTitleFromPrompt,
} = require("../services/gemini.service");

exports.createChatAndStream = async (req, res) => {
  try {
    const { prompt } = req.body;
    const userId = req.user.uid;

    if (!prompt) return res.status(400).json({ message: "Prompt required" });

    // 1️⃣ Generate AI title
    const title = await generateTitleFromPrompt(prompt);

    // 2️⃣ Create Chat
    const chatRef = await db.collection("chats").add({
      userId,
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const chatId = chatRef.id;

    // Send chatId to frontend
    res.setHeader("X-Chat-Id", chatId);

    // 3️⃣ Store User Message
    await db.collection("messages").add({
      chatId,
      userId,
      role: "user",
      content: prompt,
      createdAt: new Date(),
    });

    // 4️⃣ Set streaming headers
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    const { withRetry } = require("../config/gemini");
    const systemPrompt = require("../utils/systemPrompt");

    const formattedHistory = [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ];

    let assistantResponse = "";

    await withRetry(async (model) => {
      const result = await model.generateContentStream({
        systemInstruction: {
          role: "system",
          parts: [{ text: systemPrompt }],
        },
        contents: formattedHistory,
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        assistantResponse += text;
        res.write(text);
      }
    });

    res.end();

    // 5️⃣ Save Assistant Message
    await db.collection("messages").add({
      chatId,
      userId,
      role: "assistant",
      content: assistantResponse,
      createdAt: new Date(),
    });

    // Update chat updatedAt
    await db.collection("chats").doc(chatId).update({
      updatedAt: new Date(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

exports.getUserChats = async (req, res) => {
  try {
    const userId = req.user.uid;

    const snapshot = await db
      .collection("chats")
      .where("userId", "==", userId)
      .orderBy("updatedAt", "desc")
      .get();

    const chats = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    console.log("Fetching chats for:", userId);

    res.json(chats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.uid;

    // Verify ownership
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists || chatDoc.data().userId !== userId) {
      return res.status(403).json({ message: "Unauthorized to access this chat" });
    }

    const snapshot = await db
      .collection("messages")
      .where("chatId", "==", chatId)
      .orderBy("createdAt", "asc")
      .get();

    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.uid;

    // Verify ownership
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists || chatDoc.data().userId !== userId) {
      return res.status(403).json({ message: "Unauthorized to delete this chat" });
    }

    // Delete messages
    const messagesSnapshot = await db
      .collection("messages")
      .where("chatId", "==", chatId)
      .get();

    const batch = db.batch();

    messagesSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    batch.delete(db.collection("chats").doc(chatId));

    await batch.commit();

    res.json({ message: "Chat deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.continueChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { prompt } = req.body;
    const userId = req.user.uid;

    if (!chatId) return res.status(400).json({ message: "Chat ID required" });

    // Verify ownership
    const chatDoc = await db.collection("chats").doc(chatId).get();
    if (!chatDoc.exists || chatDoc.data().userId !== userId) {
      return res.status(403).json({ message: "Unauthorized to continue this chat" });
    }

    // 1️⃣ Save user message
    await db.collection("messages").add({
      chatId,
      userId,
      role: "user",
      content: prompt,
      createdAt: new Date(),
    });

    // 2️⃣ Get previous messages
    const snapshot = await db
      .collection("messages")
      .where("chatId", "==", chatId)
      .orderBy("createdAt", "asc")
      .get();

    const history = snapshot.docs.map((doc) => doc.data());

    // 3️⃣ Format for Gemini
    const formattedHistory = history.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const { withRetry } = require("../config/gemini");
    const systemPrompt = require("../utils/systemPrompt");

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    let assistantResponse = "";

    await withRetry(async (model) => {
      const result = await model.generateContentStream({
        systemInstruction: {
          role: "system",
          parts: [{ text: systemPrompt }],
        },
        contents: formattedHistory,
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        assistantResponse += text;
        res.write(text);
      }
    });

    res.end();

    // 4️⃣ Save assistant response
    await db.collection("messages").add({
      chatId,
      role: "assistant",
      content: assistantResponse,
      createdAt: new Date(),
    });

    // 5️⃣ Update chat updatedAt
    await db.collection("chats").doc(chatId).update({
      updatedAt: new Date(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
