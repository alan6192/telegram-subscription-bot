require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const axios = require("axios");

const app = express();
app.use(express.json());

/* =========================
   DATABASE CONFIG
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect()
  .then(() => console.log("DB connected"))
  .catch(err => console.error("DB error:", err));

async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        subscription_status TEXT DEFAULT 'inactive',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Tables ready");
  } catch (error) {
    console.error("Error creating tables:", error);
  }
}

createTables();

/* =========================
   REGISTER USER
========================= */

async function registerUser(user) {
  try {
    await pool.query(
      `
      INSERT INTO users (telegram_id, username, first_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (telegram_id)
      DO NOTHING;
      `,
      [user.id, user.username || null, user.first_name || null]
    );

    console.log("User registered or already exists");
  } catch (error) {
    console.error("Error registering user:", error);
  }
}

/* =========================
   TELEGRAM CONFIG
========================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const SECRET_TOKEN = process.env.SECRET_TOKEN;

async function sendMessage(chatId, text) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
  } catch (error) {
    console.error("Error sending message:", error.response?.data || error.message);
  }
}

/* =========================
   WEBHOOK
========================= */

app.post("/webhook", async (req, res) => {

  const incomingSecret = req.headers["x-telegram-bot-api-secret-token"];

  if (!incomingSecret || incomingSecret !== SECRET_TOKEN) {
    console.log("Unauthorized attempt");
    return res.sendStatus(403);
  }

  const update = req.body;

  console.log("Webhook received:");
  console.log(JSON.stringify(update, null, 2));

  if (update.message && update.message.from) {
    const user = update.message.from;
    const chatId = update.message.chat.id;

    await registerUser(user);

    // Respuesta automática inicial
    await sendMessage(
      chatId,
      "Welcome 🚀 Your registration was successful."
    );
  }

  res.sendStatus(200);
});

/* =========================
   ROOT ENDPOINT
========================= */

app.get("/", (req, res) => {
  res.send("Bot activo en Railway 🚀");
});

/* =========================
   SERVER START
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});