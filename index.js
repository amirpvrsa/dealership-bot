console.log('=== index.js: line 1 reached ===');
process.on('uncaughtException', (e) => { console.error('UNCAUGHT:', e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('UNHANDLED REJECTION:', e); process.exit(1); });

require('dotenv').config();
console.log('=== index.js: dotenv loaded ===');

const http = require('http');
const fs = require('fs');
const path = require('path');

const scorer = require('./scorer');
const sheets = require('./sheets');
const notifier = require('./notifier');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const FINANCE_CHAT_ID = 34198841;

let offset = 0;

// ---------- logging ----------
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---------- persistent queue (Map at runtime, JSON on disk) ----------
const QUEUE_PATH = path.join(__dirname, 'queue.json');
const pendingQueue = new Map();

function loadQueue() {
  try {
    if (!fs.existsSync(QUEUE_PATH)) {
      log('No queue.json yet — starting with empty queue');
      return;
    }
    const raw = fs.readFileSync(QUEUE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    for (const [email, data] of Object.entries(parsed)) {
      const key = String(email).trim().toLowerCase();
      pendingQueue.set(key, data);
    }
    log(`Loaded queue.json (${pendingQueue.size} entr${pendingQueue.size === 1 ? 'y' : 'ies'})`);
  } catch (e) {
    log(`Failed to load queue.json: ${e.message}`);
  }
}

function saveQueue() {
  try {
    const obj = {};
    for (const [k, v] of pendingQueue.entries()) obj[k] = v;
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(obj, null, 2));
  } catch (e) {
    log(`Failed to save queue.json: ${e.message}`);
  }
}

// ---------- HubSpot payload helper ----------
// Handles flat, fields[], values[], and properties{} payload shapes.
function getField(data, name) {
  if (!data || typeof data !== 'object') return undefined;

  if (Object.prototype.hasOwnProperty.call(data, name)) {
    const v = data[name];
    if (v !== null && v !== undefined && v !== '') return v;
  }

  if (data.properties && typeof data.properties === 'object') {
    if (Object.prototype.hasOwnProperty.call(data.properties, name)) {
      const v = data.properties[name];
      if (v !== null && v !== undefined && v !== '') return v;
    }
  }

  for (const key of ['fields', 'values']) {
    if (Array.isArray(data[key])) {
      const hit = data[key].find(
        (f) => f && (f.name === name || f.property === name || f.key === name)
      );
      if (hit) {
        const v = hit.value ?? hit.val ?? hit.text;
        if (v !== null && v !== undefined && v !== '') return v;
      }
    }
  }

  return undefined;
}

// ---------- raw Telegram helper (used by command handlers) ----------
async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description);
  return json.result;
}

async function send(chatId, text) {
  log(`SEND → ${chatId}: ${text.substring(0, 60)}`);
  await tg('sendMessage', { chat_id: chatId, text });
}

// ---------- Telegram command handler ----------
async function onMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  log(`RECV ← ${chatId}: "${text}"`);
  if (!text) return;

  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ').trim();
  const email = arg.toLowerCase();

  if (cmd === '/start') {
    await send(
      chatId,
      '🚗 Dealership bot is online.\n\nCommands:\n/newapp <email>\n/status\n/cancel <email>'
    );
    return;
  }

  if (cmd === '/newapp') {
    if (!email) {
      await send(chatId, 'Usage: /newapp <email>');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await send(chatId, 'Invalid email format.');
      return;
    }
    if (pendingQueue.has(email)) {
      await send(chatId, `Email ${email} is already being monitored.`);
      return;
    }
    pendingQueue.set(email, {
      contactId: null,
      startedAt: Date.now(),
      salespersonChatId: chatId
    });
    saveQueue();
    await send(chatId, `✅ Now monitoring ${email} for finance application submission.`);
    await send(
      FINANCE_CHAT_ID,
      `📋 New upcoming application\n👤 Sales: @${msg.from?.username || 'unknown'}\n📧 Email: ${email}\n\nWaiting for HubSpot form submission...`
    );
    return;
  }

  if (cmd === '/status') {
    const emails = Array.from(pendingQueue.keys());
    if (emails.length === 0) {
      await send(chatId, 'No emails are currently being monitored.');
      return;
    }
    await send(
      chatId,
      `📊 Currently monitoring ${emails.length} email(s):\n\n${emails.map((e) => `• ${e}`).join('\n')}`
    );
    return;
  }

  if (cmd === '/cancel') {
    if (!email) {
      await send(chatId, 'Usage: /cancel <email>');
      return;
    }
    if (!pendingQueue.has(email)) {
      await send(chatId, `Email ${email} is not being monitored.`);
      return;
    }
    pendingQueue.delete(email);
    saveQueue();
    await send(chatId, `❌ Stopped monitoring ${email}.`);
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

// ---------- HubSpot webhook ----------
async function handleHubspotWebhook(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  
  req.on('end', async () => {
    try {
      log('=== /webhook/hubspot-form received ===');
      log(`Raw body: ${body.substring(0, 200)}`);

      // Parse JSON
      let data;
      try {
        data = JSON.parse(body || '{}');
      } catch (e) {
        log(`Webhook body not valid JSON: ${e.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
        return;
      }

      // Get email
      const emailRaw = getField(data, 'email');
      const email = emailRaw ? String(emailRaw).trim().toLowerCase() : null;
      if (!email) {
        log('Webhook missing email field');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing email' }));
        return;
      }

      log(`Webhook email (normalised): ${email}`);
      
      // Check if email is in queue
      const queuedEntry = pendingQueue.get(email);
      if (!queuedEntry) {
        log(`Email ${email} not in queue — ignoring`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, matched: false }));
        return;
      }

      // Email is in queue - process the form
      const formProperties = {
        Estimated_Credit_Rating: getField(data, 'Estimated_Credit_Rating'),
        Employment_Status: getField(data, 'Employment_Status'),
        Your_monthly_income: getField(data, 'Your_monthly_income') ?? getField(data, 'annualrevenue'),
        Rent_Own_None_a_House: getField(data, 'Rent_Own_None_a_House'),
        How_long_have_you_been_receiving_this_income: getField(data, 'How_long_have_you_been_receiving_this_income'),
        Company: getField(data, 'Company') ?? getField(data, 'company'),
        Vehicle_Type: getField(data, 'Vehicle_Type'),
        Budget: getField(data, 'Budget')
      };

      const contact = {
        id: queuedEntry.contactId || null,
        properties: {
          email,
          firstname: getField(data, 'firstname') ?? '',
          lastname: getField(data, 'lastname') ?? '',
          phone: getField(data, 'phone') ?? ''
        }
      };

      const scoreResult = scorer.calculateScore(formProperties);
      log(`Scored ${email}: ${scoreResult.score.toFixed(1)} (${scoreResult.label})`);

      let fmName = null;
      try {
        fmName = await sheets.getNextFinanceManager();
      } catch (e) {
        log(`Failed to read next FM from Sheets: ${e.message}`);
        fmName = 'Unknown';
      }

      const result = await notifier.notifyFinanceManager(contact, formProperties, scoreResult, fmName);
      log(`Notification result: dmSent=${result.dmSent} groupSent=${result.groupSent}`);

      // Ping the salesperson
      if (queuedEntry.salespersonChatId) {
        await send(queuedEntry.salespersonChatId, `✅ Application submitted for ${email}! Finance team notified (score ${scoreResult.score.toFixed(1)}/10 ${scoreResult.emoji}).`);
      }

      pendingQueue.delete(email);
      saveQueue();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, matched: true, score: scoreResult.score, fm: fmName }));
      
    } catch (e) {
      log(`Webhook error: ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });

  req.on('error', (err) => {
    log(`Webhook request error: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'request error' }));
  });
}

// ---------- HTTP server ----------
function startServer() {
  const port = process.env.PORT || 3000;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          service: 'prio-auto-bot',
          queueSize: pendingQueue.size
        })
      );
      return;
    }

    if (req.method === 'POST' && req.url === '/webhook/hubspot-form') {
      await handleHubspotWebhook(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  server.listen(port, () => {
    log(`HTTP server listening on port ${port}`);
    log(`Webhook path: /webhook/hubspot-form`);
  });
}

// ---------- boot ----------
async function main() {
  log('Starting dealership-bot...');
  if (!TOKEN) {
    log('FATAL: TELEGRAM_BOT_TOKEN not set in environment');
    process.exit(1);
  }

  loadQueue();
  startServer();

  const me = await tg('getMe');
  log(`Connected as @${me.username}`);

  const stale = await tg('getUpdates', { offset: -1 });
  if (stale.length > 0) offset = stale[stale.length - 1].update_id + 1;
  log('Telegram polling started');
  poll();

  // NOTE: The legacy HubSpot poller (poller.js) is intentionally NOT started here.
  // The new design is webhook-driven; poller.js will be removed or repurposed in a later step.
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
