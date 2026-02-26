const express = require("express");

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
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