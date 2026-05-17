require('dotenv').config();
const fs = require('fs');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
let offset = 0;
const FINANCE_CHAT_ID = 34198841;
const QUEUE_FILE = './queue.json';

// Persistent queue - load from file
let pendingQueue = new Map();
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      pendingQueue = new Map(Object.entries(data));
      log(`Loaded ${pendingQueue.size} email(s) from queue file`);
    }
  } catch (e) {
    log(`Queue load error: ${e.message}`);
  }
}
function saveQueue() {
  try {
    const data = Object.fromEntries(pendingQueue);
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    log(`Queue save error: ${e.message}`);
  }
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description);
  return json.result;
}

async function send(chatId, text) {
  log(`SEND → ${chatId}: ${text.substring(0, 60)}`);
  await tg('sendMessage', { chat_id: chatId, text });
}

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  log(`RECV ← ${chatId}: "${text}"`);
  
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');

  if (cmd === '/start') {
    await send(chatId, '🚗 Dealership bot is online.\n\nCommands:\n/newapp <email>\n/status\n/cancel <email>');
    return;
  }
  
  if (cmd === '/newapp') {
    if (!arg) { await send(chatId, 'Usage: /newapp <email>'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(arg)) { await send(chatId, 'Invalid email format.'); return; }
    if (pendingQueue.has(arg)) { await send(chatId, `Email ${arg} is already being monitored.`); return; }
    pendingQueue.set(arg, { contactId: null, startedAt: Date.now(), salespersonChatId: chatId });
    saveQueue();
    await send(chatId, `✅ Now monitoring ${arg} for finance application submission.`);
    // Notify Finance about upcoming application
    await send(FINANCE_CHAT_ID, `📋 New upcoming application\n👤 Sales: @${msg.from?.username || 'unknown'}\n📧 Email: ${arg}\n\nWaiting for HubSpot form submission...`);
    return;
  }
  
  if (cmd === '/status') {
    const emails = Array.from(pendingQueue.keys());
    if (emails.length === 0) { await send(chatId, 'No emails are currently being monitored.'); return; }
    await send(chatId, `📊 Currently monitoring ${emails.length} email(s):\n\n${emails.map(e => `• ${e}`).join('\n')}`);
    return;
  }
  
  if (cmd === '/cancel') {
    if (!arg) { await send(chatId, 'Usage: /cancel <email>'); return; }
    if (!pendingQueue.has(arg)) { await send(chatId, `Email ${arg} is not being monitored.`); return; }
    pendingQueue.delete(arg);
    saveQueue();
    await send(chatId, `❌ Stopped monitoring ${arg}.`);
    return;
  }
  
  await send(chatId, `You said: ${text}`);
}

async function poll() {
  try {
    const updates = await tg('getUpdates', { offset, timeout: 0 });
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.message) await onMessage(u.message);
    }
  } catch (e) {
    log(`Poll error: ${e.message}`);
  }
  setTimeout(poll, 1000);
}

async function main() {
  log('Starting simple bot...');
  loadQueue(); // Load persistent queue
  const me = await tg('getMe');
  log(`Connected as @${me.username}`);
  const stale = await tg('getUpdates', { offset: -1 });
  if (stale.length > 0) offset = stale[stale.length - 1].update_id + 1;
  log('Polling started - send /start to test');
  poll();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

// Webhook server for HubSpot form submissions
const http = require('http');

const webhookServer = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/webhook/hubspot-form') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        log(`Webhook received: ${body.substring(0, 200)}`);
        const data = JSON.parse(body);
        
        const email = data.email || data.fields?.find(f => f.name === 'email')?.value;
        const firstName = data.firstname || data.fields?.find(f => f.name === 'firstname')?.value;
        const lastName = data.lastname || data.fields?.find(f => f.name === 'lastname')?.value;
        const phone = data.phone || data.fields?.find(f => f.name === 'phone')?.value;
        const employer = data.company || data.fields?.find(f => f.name === 'company')?.value;
        const income = data.annualrevenue || data.fields?.find(f => f.name === 'annualrevenue')?.value;
        
        if (email && pendingQueue.has(email)) {
          const queueData = pendingQueue.get(email);
          pendingQueue.delete(email);
          saveQueue();
          
          let message = `🚨 NEW FINANCE APPLICATION\n\n`;
          message += `👤 Name: ${firstName || ''} ${lastName || ''}\n`;
          message += `📧 Email: ${email}\n`;
          message += `📱 Phone: ${phone || 'N/A'}\n`;
          if (employer) message += `🏢 Employer: ${employer}\n`;
          if (income) message += `💰 Income: $${income}\n`;
          message += `\n✅ Form submitted via website`;
          
          await send(FINANCE_CHAT_ID, message);
          
          if (queueData.salespersonChatId) {
            await send(queueData.salespersonChatId, `✅ Application submitted for ${email}! Finance team notified.`);
          }
          
          log(`Form processed for ${email}, Finance notified`);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        log(`Webhook error: ${e.message}`);
        res.writeHead(500);
        res.end('Error');
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

webhookServer.listen(3000, () => {
  log('Webhook server listening on port 3000');
  log('HubSpot webhook URL: http://174.116.113.81:3000/webhook/hubspot-form');
});
