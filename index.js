require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(express.json());

/* ======================
   ENV VARIABLES
====================== */

const BOT_TOKEN = process.env.BOT_TOKEN;
const SECRET_TOKEN = process.env.SECRET_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
let CHANNEL_ID = process.env.CHANNEL_ID || null;

/* ======================
   DATABASE
====================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
.then(()=>console.log("DB connected"))
.catch(console.error);

/* ======================
   TABLES
====================== */

async function createTables(){

await pool.query(`
CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  subscription_status TEXT DEFAULT 'inactive',
  subscription_end DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

await pool.query(`
CREATE TABLE IF NOT EXISTS subscriptions(
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  start_date DATE,
  end_date DATE,
  status TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

await pool.query(`
CREATE TABLE IF NOT EXISTS payments(
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER REFERENCES subscriptions(id),
  amount NUMERIC,
  currency TEXT DEFAULT 'USD',
  paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

console.log("Tables ready");
}

createTables();

/* ======================
   TELEGRAM HELPERS
====================== */

async function sendMessage(chatId,text){
  try{
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id:chatId,text }
    );
  }catch(e){
    console.error(e.response?.data||e.message);
  }
}

async function removeFromChannel(userId){

if(!CHANNEL_ID){
console.log("CHANNEL_ID not defined");
return;
}

try{
await axios.post(
`https://api.telegram.org/bot${BOT_TOKEN}/banChatMember`,
{
chat_id:CHANNEL_ID,
user_id:userId
});
}catch(e){
console.error("Remove error",e.response?.data||e.message);
}
}

/* ======================
   USER REGISTER
====================== */

async function registerUser(user){

await pool.query(`
INSERT INTO users(telegram_id,username,first_name)
VALUES($1,$2,$3)
ON CONFLICT(telegram_id) DO NOTHING
`,
[user.id,user.username||null,user.first_name||null]);

}

/* ======================
   RENEW SUBSCRIPTION
====================== */

async function renewUser(telegramId,days,amount){

const userRes=await pool.query(
`SELECT id FROM users WHERE telegram_id=$1`,
[telegramId]
);

if(!userRes.rowCount) return "User not found";

const userId=userRes.rows[0].id;

/* cerrar anterior */
await pool.query(`
UPDATE subscriptions
SET status='expired'
WHERE user_id=$1 AND status='active'
`,[userId]);

/* crear nueva */

const sub=await pool.query(`
INSERT INTO subscriptions
(user_id,start_date,end_date,status)
VALUES(
$1,
CURRENT_DATE,
CURRENT_DATE + $2 * INTERVAL '1 day',
'active'
)
RETURNING id,end_date
`,
[userId,days]);

const subId=sub.rows[0].id;
const endDate=sub.rows[0].end_date;

/* payment */

await pool.query(`
INSERT INTO payments(subscription_id,amount)
VALUES($1,$2)
`,
[subId,amount||0]);

/* snapshot user */

await pool.query(`
UPDATE users
SET subscription_status='active',
subscription_end=$1
WHERE id=$2
`,
[endDate,userId]);

return `Renewed until ${endDate}`;
}

/* ======================
   BUSINESS STATS
====================== */

async function stats(){

const active=await pool.query(`
SELECT COUNT(*) FROM users
WHERE subscription_status='active'
`);

const mrr=await pool.query(`
SELECT COALESCE(SUM(amount),0) total
FROM payments
WHERE date_trunc('month',paid_at)=date_trunc('month',CURRENT_DATE)
`);

const avg=await pool.query(`
SELECT COALESCE(AVG(amount),0) avg
FROM payments
`);

return `
Active users: ${active.rows[0].count}
MRR: $${mrr.rows[0].total}
Avg Ticket: $${Number(avg.rows[0].avg).toFixed(2)}
`;
}

/* ======================
   DAILY CHECK
====================== */

cron.schedule("0 9 * * *", async()=>{

console.log("Daily subscription check");

/* avisar vencen hoy */

const expiring=await pool.query(`
SELECT telegram_id,username
FROM users
WHERE subscription_status='active'
AND subscription_end=CURRENT_DATE
`);

for(const u of expiring.rows){
await sendMessage(
ADMIN_ID,
`⚠️ vence hoy: ${u.username||u.telegram_id}`
);
}

/* remover tras 3 días */

const expired=await pool.query(`
SELECT telegram_id,id
FROM users
WHERE subscription_status='active'
AND subscription_end <= CURRENT_DATE - INTERVAL '3 day'
`);

for(const u of expired.rows){

await removeFromChannel(u.telegram_id);

await pool.query(`
UPDATE users
SET subscription_status='inactive'
WHERE id=$1
`,[u.id]);

await sendMessage(
ADMIN_ID,
`❌ removido: ${u.telegram_id}`
);
}

});

/* ======================
   WEBHOOK
====================== */

app.post("/webhook",async(req,res)=>{

console.log("Webhook received:",JSON.stringify(req.body));

const incomingSecret=
req.headers["x-telegram-bot-api-secret-token"];

if(incomingSecret!==SECRET_TOKEN)
return res.sendStatus(403);

const update=req.body;

/* ======================
   AUTO DETECT CHANNEL ID
====================== */

if(update.my_chat_member){

const chat=update.my_chat_member.chat;

if(chat.type==="channel"){
CHANNEL_ID=chat.id;

console.log("CHANNEL DETECTED:",CHANNEL_ID);

await sendMessage(
ADMIN_ID,
`✅ Channel detected automatically: ${CHANNEL_ID}`
);
}

return res.sendStatus(200);
}

/* ======================
   USER JOIN CHANNEL
====================== */

if(update.chat_member){

const member=update.chat_member.new_chat_member;
const user=member.user;

if(member.status==="member"){

await registerUser(user);

await sendMessage(
ADMIN_ID,
`✅ User joined channel: ${user.username||user.id}`
);
}

return res.sendStatus(200);
}

/* ======================
   ADMIN COMMANDS
====================== */

if(!update.message) return res.sendStatus(200);

const msg=update.message;
const chatId=msg.chat.id;

if(msg.from.id!==ADMIN_ID)
return res.sendStatus(200);

const text=msg.text||"";

/* renew */

if(text.startsWith("/renew")){

const parts=text.split(" ");

const telegramId=parts[1];
const days=Number(parts[2]);
const amount=Number(parts[3]||0);

const response=
await renewUser(telegramId,days,amount);

await sendMessage(chatId,response);
}

/* stats */

if(text==="/stats"){
const s=await stats();
await sendMessage(chatId,s);
}

res.sendStatus(200);
});

/* ======================
   ROOT
====================== */

app.get("/",(_,res)=>{
res.send("Subscription Bot Running 🚀");
});

/* ======================
   START SERVER
====================== */

const PORT=process.env.PORT||3000;

app.listen(PORT,()=>{
console.log("Server running on port",PORT);
});