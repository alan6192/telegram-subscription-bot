const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect()
  .then(() => console.log("DB connected"))
  .catch(err => console.error("DB error:", err));
const express = require("express");

const app = express();
app.use(express.json());

const SECRET_TOKEN = process.env.SECRET_TOKEN;

app.post("/webhook", async (req, res) => {

    const incomingSecret = req.headers["x-telegram-bot-api-secret-token"];

    // Validación de seguridad
    if (!incomingSecret || incomingSecret !== SECRET_TOKEN) {
        console.log("Intento no autorizado");
        return res.sendStatus(403);
    }

    console.log("Webhook recibido:");
    console.log(JSON.stringify(req.body, null, 2));

    res.sendStatus(200);
});

app.get("/", (req, res) => {
    res.send("Bot activo en Railway 🚀");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});