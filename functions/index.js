const functions = require("firebase-functions");
const admin = require("firebase-admin");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

const bot = new TelegramBot(functions.config().telegram.token);

let adminSessions = {}; // Store temp input states

exports.bot = functions.https.onRequest((req, res) => {
  bot.processUpdate(req.body);
  res.status(200).send("OK");
});

// === UTILITY ===

const isAdmin = async (userId) => {
  const doc = await db.collection("admins").doc(String(userId)).get();
  return doc.exists;
};

const shortenLink = async (url) => {
  const apiKey = functions.config().gplinks.api;
  const response = await axios.get(`https://gplinks.co/api?api=${apiKey}&url=${encodeURIComponent(url)}`);
  return response.data.shortenedUrl || url;
};

// === ADMIN COMMAND ===

bot.onText(/\/addbatch/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(userId))) {
    return bot.sendMessage(chatId, "⛔ You are not authorized.");
  }

  adminSessions[userId] = { step: "batchName" };
  bot.sendMessage(chatId, "🆕 Enter batch name:");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = adminSessions[userId];

  if (!session || msg.text.startsWith("/")) return;

  switch (session.step) {
    case "batchName":
      session.batchName = msg.text.trim();
      session.step = "fileName";
      return bot.sendMessage(chatId, "📁 Enter base file name:");

    case "fileName":
      session.fileName = msg.text.trim();
      session.step = "count";
      return bot.sendMessage(chatId, "🔢 Enter number of parts:");

    case "count":
      session.count = parseInt(msg.text.trim());
      if (isNaN(session.count) || session.count <= 0) {
        return bot.sendMessage(chatId, "❌ Invalid count. Enter a number.");
      }
      session.step = "startId";
      return bot.sendMessage(chatId, "🆔 Enter Start ID:");

    case "startId":
      session.startId = parseInt(msg.text.trim());
      if (isNaN(session.startId) || session.startId <= 0) {
        return bot.sendMessage(chatId, "❌ Invalid ID. Try again.");
      }

      const { batchName, fileName, count, startId } = session;
      const batchRef = db.collection("batches").doc(batchName);
      const filesCol = batchRef.collection("files");

      for (let i = 0; i < count; i++) {
        const currentId = startId + i;
        const fullLink = `https://t.me/YOUR_CHANNEL/${currentId}`;
        const shortLink = await shortenLink(fullLink);

        await filesCol.add({
          fileName: `${fileName} - Part ${i + 1}`,
          originalId: currentId,
          fullLink,
          shortLink,
          partNumber: i + 1,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await batchRef.set({
        fileName,
        createdBy: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      delete adminSessions[userId];
      return bot.sendMessage(chatId, `✅ Batch '${batchName}' added with ${count} parts.`);
  }
});
