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
const GM_CHAT_ID = process.env.GM_CHAT_ID || '8616971268';

let offset = 0;

// ---------- GM approval queue ----------
const pendingApprovals = new Map();

// ---------- FM assignment queue ----------
const fmAssignments = new Map();

// ---------- User state tracking ----------
const userStates = new Map();

// ---------- logging ----------
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---------- persistent queue ----------
const QUEUE_PATH = path.join(__dirname, 'queue.json');
const pendingQueue = new Map();

function loadQueue() {
  try {
    if (!fs.existsSync(QUEUE_PATH)) {
      log('No queue.json yet — starting with empty queue');
      return;
    }
    const data = fs.readFileSync(QUEUE_PATH, 'utf-8');
    const entries = JSON.parse(data);
    pendingQueue.clear();
    for (const [k, v] of entries) {
      pendingQueue.set(k, v);
    }
    log(`Loaded ${pendingQueue.size} entries from queue.json`);
  } catch (e) {
    log(`Failed to load queue: ${e.message}`);
  }
}

function saveQueue() {
  try {
    const entries = Array.from(pendingQueue.entries());
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(entries, null, 2));
  } catch (e) {
    log(`Failed to save queue: ${e.message}`);
  }
}

// ---------- Telegram API ----------
async function tg(method, params = {}) {
  const url = `${API}/${method}`;
  const body = JSON.stringify(params);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(json.description || `Telegram API error: ${method}`);
  }
  return json.result;
}

// ---------- send helpers ----------
async function send(chatId, text) {
  log(`SEND → ${chatId}: ${text.substring(0, 60)}`);
  await tg('sendMessage', { chat_id: chatId, text });
}

async function sendWithKeyboard(chatId, text, keyboard) {
  log(`SEND → ${chatId}: ${text.substring(0, 60)} [with keyboard]`);
  await tg('sendMessage', { chat_id: chatId, text, reply_markup: JSON.stringify(keyboard) });
}

async function sendWithReplyKeyboard(chatId, text, keyboard) {
  log(`SEND → ${chatId}: ${text.substring(0, 60)} [with reply keyboard]`);
  await tg('sendMessage', { 
    chat_id: chatId, 
    text, 
    reply_markup: JSON.stringify({
      keyboard: keyboard,
      resize_keyboard: true,
      one_time_keyboard: false
    })
  });
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

  // Handle /cancel at any time
  if (text === '/cancel') {
    userStates.set(chatId, { state: 'idle', timestamp: Date.now() });
    await send(chatId, '❌ Cancelled. What would you like to do?');
    return;
  }

  // Handle waiting for email state (BEFORE command checks)
  const userState = userStates.get(chatId);
  if (userState?.state === 'waiting_email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(text)) {
      const email = text.toLowerCase().trim();
      
      if (pendingQueue.has(email)) {
        await send(chatId, `⚠️ Email ${email} is already being monitored.`);
        userStates.set(chatId, { state: 'idle', timestamp: Date.now() });
        return;
      }
      
      pendingQueue.set(email, {
        contactId: null,
        startedAt: Date.now(),
        salespersonChatId: chatId
      });
      saveQueue();
      
      const keyboard = {
        inline_keyboard: [
          [{ text: '📋 View Status', callback_data: 'menu_status' }],
          [{ text: '➕ Add Another', callback_data: 'menu_newapp' }]
        ]
      };
      await sendWithKeyboard(
        chatId,
        `✅ Now monitoring ${email} for finance application submission.\n\nThe GM will be notified when the customer submits the form.`,
        keyboard
      );
      
      userStates.set(chatId, { state: 'idle', timestamp: Date.now() });
      return;
    } else {
      await send(chatId, '⚠️ That doesn\'t look like a valid email. Please try again or type /cancel to abort.\n\nExample: customer@gmail.com');
      return;
    }
  }

  // Handle reply keyboard buttons
  if (text === '➕ New App') {
    userStates.set(chatId, { state: 'waiting_email', timestamp: Date.now() });
    await send(chatId, '📝 *Please type the customer email address:*\n\nExample: customer@gmail.com\n\nType /cancel to abort.');
    return;
  }
  
  if (text === '📋 Status') {
    const emails = Array.from(pendingQueue.keys());
    if (emails.length === 0) {
      const keyboard = { inline_keyboard: [backButton()] };
      await sendWithKeyboard(chatId, '📭 No applications are currently being monitored.', keyboard);
    } else {
      let statusMsg = '📋 *Currently Monitoring:*\n\n';
      emails.forEach((email, idx) => {
        const entry = pendingQueue.get(email);
        const timeAgo = Math.floor((Date.now() - entry.startedAt) / 60000);
        statusMsg += `${idx + 1}. ${email}\n   ⏱️ ${timeAgo} min ago\n\n`;
      });
      statusMsg += `Total: ${emails.length} application(s)`;
      const keyboard = { inline_keyboard: [backButton()] };
      await sendWithKeyboard(chatId, statusMsg, keyboard);
    }
    return;
  }
  
  if (text === '❌ Cancel') {
    const emails = Array.from(pendingQueue.keys());
    if (emails.length === 0) {
      const keyboard = { inline_keyboard: [backButton()] };
      await sendWithKeyboard(chatId, '📭 No applications to cancel.', keyboard);
    } else {
      const keyboard = {
        inline_keyboard: [
          ...emails.map(email => [{ text: `❌ Cancel ${email}`, callback_data: `cancel_${email}` }]),
          backButton()
        ]
      };
      await sendWithKeyboard(chatId, 'Select which application to cancel:', keyboard);
    }
    return;
  }
  
  if (text === '📊 My Stats') {
    const emails = Array.from(pendingQueue.keys());
    const total = emails.length;
    const yours = emails.filter(e => pendingQueue.get(e).salespersonChatId === chatId).length;
    
    let statsMsg = '📊 *Your Stats*\n\n';
    statsMsg += `Total Active Applications: ${total}\n`;
    statsMsg += `Your Applications: ${yours}\n`;
    if (total > 0) {
      statsMsg += `\nYou have ${yours} application(s) pending submission.`;
    }
    const keyboard = { inline_keyboard: [backButton()] };
    await sendWithKeyboard(chatId, statsMsg, keyboard);
    return;
  }
  
  if (text === '🏠 Home') {
    await showMainMenu(chatId);
    return;
  }
  
  if (text === '🔄 Restart') {
    userStates.set(chatId, { state: 'idle', timestamp: Date.now() });
    pendingQueue.clear();
    saveQueue();
    await send(chatId, '🔄 Bot restarted! Queue cleared.');
    await showMainMenu(chatId);
    return;
  }

  // Commands
  if (cmd === '/start') {
    userStates.set(chatId, { state: 'idle', timestamp: Date.now() });
    await showMainMenu(chatId);
    return;
  }

  if (cmd === '/newapp') {
    if (!email) {
      await send(chatId, 'Usage: /newapp <email>');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await send(chatId, 'Please provide a valid email address.');
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
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '📋 View Status', callback_data: 'menu_status' }],
        [{ text: '➕ Add Another', callback_data: 'menu_newapp' }]
      ]
    };
    await sendWithKeyboard(
      chatId,
      `✅ Now monitoring ${email} for finance application submission.\n\nThe GM will be notified when the customer submits the form.`,
      keyboard
    );
    return;
  }

  if (cmd === '/status') {
    const emails = Array.from(pendingQueue.keys());
    if (emails.length === 0) {
      await send(chatId, 'No emails are currently being monitored.');
      return;
    }
    let msg = '📋 Currently monitoring:\n';
    emails.forEach((e, i) => {
      const entry = pendingQueue.get(e);
      const mins = Math.floor((Date.now() - entry.startedAt) / 60000);
      msg += `${i + 1}. ${e} (${mins} min ago)\n`;
    });
    await send(chatId, msg);
    return;
  }

  if (cmd === '/testfm') {
    const managersPath = path.join(__dirname, 'config', 'managers.json');
    try {
      const managersData = fs.readFileSync(managersPath, 'utf-8');
      const managers = JSON.parse(managersData);
      let msg = '📋 *Finance Managers in system:*\n\n';
      for (const [name, id] of Object.entries(managers)) {
        msg += `• ${name}: ${id}\n`;
      }
      await send(chatId, msg);
      
      // Try sending test to each FM
      for (const [name, id] of Object.entries(managers)) {
        try {
          await send(id, `🧪 Test message from bot! You are registered as "${name}".`);
          await send(chatId, `✅ Test sent to ${name} (${id})`);
        } catch (e) {
          await send(chatId, `❌ Failed to send to ${name} (${id}): ${e.message}`);
        }
      }
    } catch (e) {
      await send(chatId, `Error: ${e.message}`);
    }
    return;
  }

  if (cmd === '/cancel' && arg) {
    const target = email;
    if (!pendingQueue.has(target)) {
      await send(chatId, `Email ${target} is not being monitored.`);
      return;
    }
    pendingQueue.delete(target);
    saveQueue();
    await send(chatId, `❌ Stopped monitoring ${target}.`);
    return;
  }

  // Fallback
  await send(chatId, `You said: ${text}`);
}

// ---------- Callback query handler ----------
function backButton() {
  return [{ text: '🔙 Back to Menu', callback_data: 'menu_back' }];
}

async function showMainMenu(chatId) {
  const replyKeyboard = [
    ['➕ New App', '📋 Status'],
    ['❌ Cancel', '📊 My Stats'],
    ['🏠 Home', '🔄 Restart']
  ];
  
  // Send ONE message with both reply keyboard and inline keyboard
  // Note: Telegram allows both in same message via different markup types
  log(`SEND → ${chatId}: PrioAutoSales menu`);
  await tg('sendMessage', {
    chat_id: chatId,
    text: '🚗 *PrioAutoSales*\n\nWhat would you like to do?\n\nOr tap below:',
    reply_markup: JSON.stringify({
      keyboard: replyKeyboard,
      resize_keyboard: true,
      one_time_keyboard: false,
      inline_keyboard: [
        [{ text: '📋 Financing Application', callback_data: 'menu_finance' }],
        [{ text: '📚 How to Use', callback_data: 'menu_help' }]
      ]
    })
  });
}

async function onCallbackQuery(query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  
  log(`CALLBACK ← ${chatId}: ${data}`);
  
  await tg('answerCallbackQuery', { callback_query_id: query.id });
  
  // Back to menu
  if (data === 'menu_back') {
    await showMainMenu(chatId);
    return;
  }
  
  // Menu buttons
  if (data === 'menu_newapp') {
    userStates.set(chatId, { state: 'waiting_email', timestamp: Date.now() });
    await send(chatId, '📝 *Please type the customer email address:*\n\nExample: customer@gmail.com\n\nType /cancel to abort.');
    return;
  }
  
  if (data === 'menu_finance') {
    const formUrl = process.env.FINANCE_FORM_URL || 'https://app.hubspot.com/your-form-link';
    const msg = `📋 *Financing Application*\n\n` +
      `Share this link with your customer:\n\n` +
      `${formUrl}\n\n` +
      `The customer should fill out this form with their email address. ` +
      `Once submitted, the GM and Finance team will be notified automatically.`;
    const keyboard = { inline_keyboard: [backButton()] };
    await sendWithKeyboard(chatId, msg, keyboard);
    return;
  }
  
  if (data === 'menu_help') {
    const helpText = `📚 *How to Use Dealership Bot*\n\n` +
      `1️⃣ Click *➕ New App* and type customer email\n` +
      `2️⃣ Send the form link to customer\n` +
      `3️⃣ When customer submits, GM reviews & approves\n` +
      `4️⃣ Finance Manager accepts & contacts customer\n\n` +
      `*Commands:*\n` +
      `• /start - Main menu\n` +
      `• /newapp <email> - Add application\n` +
      `• /status - View active applications\n` +
      `• /cancel <email> - Remove application\n` +
      `• /testfm - Test FM connections`;
    
    const keyboard = { inline_keyboard: [backButton()] };
    await sendWithKeyboard(chatId, helpText, keyboard);
    return;
  }
  
  if (data === 'menu_status') {
    const emails = Array.from(pendingQueue.keys());
    if (emails.length === 0) {
      const keyboard = { inline_keyboard: [backButton()] };
      await sendWithKeyboard(chatId, '📭 No applications are currently being monitored.', keyboard);
    } else {
      let statusMsg = '📋 *Currently Monitoring:*\n\n';
      emails.forEach((email, idx) => {
        const entry = pendingQueue.get(email);
        const timeAgo = Math.floor((Date.now() - entry.startedAt) / 60000);
        statusMsg += `${idx + 1}. ${email}\n   ⏱️ ${timeAgo} min ago\n\n`;
      });
      statusMsg += `Total: ${emails.length} application(s)`;
      const keyboard = { inline_keyboard: [backButton()] };
      await sendWithKeyboard(chatId, statusMsg, keyboard);
    }
    return;
  }
  
  if (data === 'menu_cancel') {
    const emails = Array.from(pendingQueue.keys());
    if (emails.length === 0) {
      await send(chatId, '📭 No applications to cancel.');
      return;
    }
    const keyboard = {
      inline_keyboard: emails.map(email => [
        { text: `❌ Cancel ${email}`, callback_data: `cancel_${email}` }
      ])
    };
    await sendWithKeyboard(chatId, 'Select which application to cancel:', keyboard);
    return;
  }
  
  if (data.startsWith('cancel_')) {
    const email = data.replace('cancel_', '');
    if (pendingQueue.has(email)) {
      pendingQueue.delete(email);
      saveQueue();
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: `✅ Cancelled monitoring for ${email}`,
        reply_markup: JSON.stringify({ inline_keyboard: [] })
      });
    } else {
      await send(chatId, `⚠️ ${email} is no longer being monitored.`);
    }
    return;
  }
  
  // GM Approval buttons
  if (data.startsWith('approve_')) {
    const approvalId = data.replace('approve_', '');
    const approval = pendingApprovals.get(approvalId);
    
    if (!approval) {
      await tg('answerCallbackQuery', { callback_query_id: query.id, text: 'Already processed' });
      return;
    }
    
    const { email, contact, formProperties, scoreResult, fmName, salespersonChatId } = approval;
    
    // Get FM's Telegram ID - try exact match first, then partial match
    const managersPath = path.join(__dirname, 'config', 'managers.json');
    let fmChatId = null;
    try {
      const managersData = fs.readFileSync(managersPath, 'utf-8');
      const managers = JSON.parse(managersData);
      // Try exact match
      fmChatId = managers[fmName];
      // Try partial match (e.g., "Sarah" matches "Sarah_FM")
      if (!fmChatId) {
        const lowerName = fmName.toLowerCase();
        for (const [key, value] of Object.entries(managers)) {
          if (key.toLowerCase().includes(lowerName) || lowerName.includes(key.toLowerCase())) {
            fmChatId = value;
            log(`Matched FM "${fmName}" to managers.json key "${key}"`);
            break;
          }
        }
      }
    } catch (e) {
      log(`Could not read managers.json: ${e.message}`);
    }
    
    if (!fmChatId) {
      await send(chatId, `⚠️ Could not find Telegram ID for Finance Manager "${fmName}". Check managers.json.`);
      return;
    }
    
    // Update GM's message
    const updatedText = query.message.text + '\n\n✅ APPROVED - Awaiting FM response (15 min timeout)';
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: updatedText,
      reply_markup: JSON.stringify({ inline_keyboard: [] })
    });
    
    // Send to FM with Accept/Busy buttons
    const fmMessage = `🚨 *NEW APPLICATION ASSIGNED*\n\n` +
      `👤 Customer: ${contact.properties.firstname} ${contact.properties.lastname}\n` +
      `📧 Email: ${email}\n` +
      `📱 Phone: ${contact.properties.phone || 'N/A'}\n\n` +
      `💰 Income: $${formProperties.Your_monthly_income || 'N/A'}\n` +
      `🏢 Company: ${formProperties.Company || 'N/A'}\n` +
      `📊 Credit: ${formProperties.Estimated_Credit_Rating || 'N/A'}\n` +
      `📈 Score: ${scoreResult.score.toFixed(1)}/10 ${scoreResult.emoji}\n\n` +
      `⏱️ *You have 15 minutes to respond*\n\n` +
      `Tap button below:`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ ACCEPT - I will handle this', callback_data: `fm_accept_${email}` }],
        [{ text: '❌ BUSY - Pass to next FM', callback_data: `fm_busy_${email}` }]
      ]
    };
    
    let fmResponse;
    try {
      fmResponse = await tg('sendMessage', {
        chat_id: fmChatId,
        text: fmMessage,
        reply_markup: JSON.stringify(keyboard)
      });
      log(`FM notification sent to ${fmName} (${fmChatId})`);
    } catch (sendErr) {
      log(`Failed to send FM notification to ${fmName} (${fmChatId}): ${sendErr.message}`);
      await send(chatId, `⚠️ Failed to notify ${fmName}. Error: ${sendErr.message}`);
      pendingApprovals.delete(approvalId);
      return;
    }
    
    // 15-minute timeout
    const timeoutId = setTimeout(async () => {
      await handleFMTimeout(email, fmName);
    }, 15 * 60 * 1000);
    
    fmAssignments.set(email, {
      fmName,
      fmChatId,
      contact,
      formProperties,
      scoreResult,
      salespersonChatId,
      assignedAt: Date.now(),
      messageId: fmResponse.result?.message_id,
      timeoutId
    });
    
    if (salespersonChatId) {
      await send(salespersonChatId, `✅ GM Approved! Finance Manager (${fmName}) has been assigned for ${email}. Waiting for their response (15 min timeout). Score: ${scoreResult.score.toFixed(1)}/10`);
    }
    
    pendingApprovals.delete(approvalId);
    log(`GM approved application for ${email}, assigned to ${fmName}`);
    
  } else if (data.startsWith('reject_')) {
    const approvalId = data.replace('reject_', '');
    const approval = pendingApprovals.get(approvalId);
    
    if (!approval) {
      await tg('answerCallbackQuery', { callback_query_id: query.id, text: 'Already processed' });
      return;
    }
    
    const { email, salespersonChatId } = approval;
    
    const updatedText = query.message.text + '\n\n❌ REJECTED - Application declined';
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: updatedText,
      reply_markup: JSON.stringify({ inline_keyboard: [] })
    });
    
    if (salespersonChatId) {
      await send(salespersonChatId, `❌ Application for ${email} was rejected by GM.`);
    }
    
    pendingApprovals.delete(approvalId);
    log(`GM rejected application for ${email}`);
    
  } else if (data.startsWith('fm_accept_')) {
    const email = data.replace('fm_accept_', '');
    const assignment = fmAssignments.get(email);
    
    if (!assignment) {
      await send(chatId, '⚠️ This assignment has expired or been reassigned.');
      return;
    }
    
    const { fmName, contact, salespersonChatId, messageId } = assignment;
    
    if (assignment.timeoutId) {
      clearTimeout(assignment.timeoutId);
    }
    
    const updatedText = query.message.text + '\n\n✅ *ACCEPTED* - You are now handling this application!';
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: updatedText,
      reply_markup: JSON.stringify({ inline_keyboard: [] })
    });
    
    if (salespersonChatId) {
      await send(salespersonChatId, `🎉 Finance Manager ${fmName} has *ACCEPTED* the application for ${email}! They will contact the customer.`);
    }
    
    fmAssignments.delete(email);
    log(`FM ${fmName} accepted assignment for ${email}`);
    
  } else if (data.startsWith('fm_busy_')) {
    const email = data.replace('fm_busy_', '');
    const assignment = fmAssignments.get(email);
    
    if (!assignment) {
      await send(chatId, '⚠️ This assignment has expired or been reassigned.');
      return;
    }
    
    const { fmName, messageId, timeoutId } = assignment;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    const updatedText = query.message.text + '\n\n❌ *DECLINED* - Assignment passed to next FM';
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: updatedText,
      reply_markup: JSON.stringify({ inline_keyboard: [] })
    });
    
    log(`FM ${fmName} declined assignment for ${email}`);
    
    await reassignToNextFM(email, assignment.contact, assignment.formProperties, assignment.scoreResult, assignment.salespersonChatId);
  }
}

// ---------- FM timeout and reassignment ----------
async function handleFMTimeout(email, currentFmName) {
  const assignment = fmAssignments.get(email);
  if (!assignment) return;
  
  const { fmChatId, messageId, contact, formProperties, scoreResult, salespersonChatId } = assignment;
  
  await tg('editMessageText', {
    chat_id: fmChatId,
    message_id: messageId,
    text: `⏱️ *TIMEOUT* - 15 minutes passed. Assignment automatically passed to next FM.`,
    reply_markup: JSON.stringify({ inline_keyboard: [] })
  });
  
  log(`FM ${currentFmName} timed out for ${email}`);
  
  await reassignToNextFM(email, contact, formProperties, scoreResult, salespersonChatId, currentFmName);
}

async function reassignToNextFM(email, contact, formProperties, scoreResult, salespersonChatId, previousFmName = null) {
  try {
    let nextFmName = await sheets.getNextFinanceManager();
    
    // Fallback: if Google Sheets returns null, use first FM from managers.json
    if (!nextFmName || nextFmName === 'null') {
      try {
        const managersPath = path.join(__dirname, 'config', 'managers.json');
        const managersData = fs.readFileSync(managersPath, 'utf-8');
        const managers = JSON.parse(managersData);
        const names = Object.keys(managers);
        if (names.length > 0) {
          nextFmName = names[0];
          log(`Google Sheets returned null in reassign, using first FM from managers.json: ${nextFmName}`);
        }
      } catch (e2) {
        log(`Could not read managers.json fallback in reassign: ${e2.message}`);
      }
    }
    
    if (nextFmName === previousFmName) {
      await send(FINANCE_CHAT_ID, `⚠️ Could not reassign ${email} - only one FM available.`);
      if (salespersonChatId) {
        await send(salespersonChatId, `⚠️ Application for ${email} could not be reassigned.`);
      }
      fmAssignments.delete(email);
      return;
    }
    
    const managersPath = path.join(__dirname, 'config', 'managers.json');
    let fmChatId = null;
    try {
      const managersData = fs.readFileSync(managersPath, 'utf-8');
      const managers = JSON.parse(managersData);
      // Try exact match
      fmChatId = managers[nextFmName];
      // Try partial match
      if (!fmChatId) {
        const lowerName = nextFmName.toLowerCase();
        for (const [key, value] of Object.entries(managers)) {
          if (key.toLowerCase().includes(lowerName) || lowerName.includes(key.toLowerCase())) {
            fmChatId = value;
            log(`Matched FM "${nextFmName}" to managers.json key "${key}" in reassign`);
            break;
          }
        }
      }
    } catch (e) {
      log(`Could not read managers.json: ${e.message}`);
    }
    
    if (!fmChatId) {
      await send(FINANCE_CHAT_ID, `⚠️ Could not find Telegram ID for "${nextFmName}".`);
      fmAssignments.delete(email);
      return;
    }
    
    const fmMessage = `🚨 *NEW APPLICATION REASSIGNED*\n\n` +
      `👤 Customer: ${contact.properties.firstname} ${contact.properties.lastname}\n` +
      `📧 Email: ${email}\n` +
      `📱 Phone: ${contact.properties.phone || 'N/A'}\n\n` +
      `💰 Income: $${formProperties.Your_monthly_income || 'N/A'}\n` +
      `🏢 Company: ${formProperties.Company || 'N/A'}\n` +
      `📊 Credit: ${formProperties.Estimated_Credit_Rating || 'N/A'}\n` +
      `📈 Score: ${scoreResult.score.toFixed(1)}/10 ${scoreResult.emoji}\n\n` +
      `⚠️ *Previous FM was unavailable*\n` +
      `⏱️ *You have 15 minutes to respond*\n\n` +
      `Tap button below:`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ ACCEPT - I will handle this', callback_data: `fm_accept_${email}` }],
        [{ text: '❌ BUSY - Pass to next FM', callback_data: `fm_busy_${email}` }]
      ]
    };
    
    const fmResponse = await tg('sendMessage', {
      chat_id: fmChatId,
      text: fmMessage,
      reply_markup: JSON.stringify(keyboard)
    });
    
    const timeoutId = setTimeout(async () => {
      await handleFMTimeout(email, nextFmName);
    }, 15 * 60 * 1000);
    
    fmAssignments.set(email, {
      fmName: nextFmName,
      fmChatId,
      contact,
      formProperties,
      scoreResult,
      salespersonChatId,
      assignedAt: Date.now(),
      messageId: fmResponse.result?.message_id,
      timeoutId
    });
    
    if (salespersonChatId) {
      await send(salespersonChatId, `🔄 Reassigned! Finance Manager (${nextFmName}) has been assigned for ${email}. Previous FM was unavailable.`);
    }
    
    log(`Reassigned ${email} to ${nextFmName}`);
    
  } catch (e) {
    log(`Error reassigning to next FM: ${e.message}`);
    fmAssignments.delete(email);
  }
}

// ---------- HubSpot webhook ----------
async function handleHubspotWebhook(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  
  req.on('end', async () => {
    try {
      log('=== /webhook/hubspot-form received ===');
      log(`Raw body: ${body.substring(0, 200)}`);

      let data;
      try {
        data = JSON.parse(body || '{}');
      } catch (e) {
        log(`Webhook body not valid JSON: ${e.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
        return;
      }

      function getField(obj, key) {
        if (obj[key] !== undefined) return obj[key];
        if (obj.fields && Array.isArray(obj.fields)) {
          const found = obj.fields.find(f => f.name === key);
          return found ? found.value : undefined;
        }
        return undefined;
      }

      const emailRaw = getField(data, 'email');
      const email = emailRaw ? String(emailRaw).trim().toLowerCase() : null;
      if (!email) {
        log('Webhook missing email field');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing email' }));
        return;
      }

      log(`Webhook email (normalised): ${email}`);
      
      const queuedEntry = pendingQueue.get(email);
      if (!queuedEntry) {
        log(`Email ${email} not in queue — ignoring`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, matched: false }));
        return;
      }

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
      }
      
      // Fallback: if Google Sheets returns null, use first FM from managers.json
      if (!fmName || fmName === 'null') {
        try {
          const managersPath = path.join(__dirname, 'config', 'managers.json');
          const managersData = fs.readFileSync(managersPath, 'utf-8');
          const managers = JSON.parse(managersData);
          const names = Object.keys(managers);
          if (names.length > 0) {
            fmName = names[0];
            log(`Google Sheets returned null, using first FM from managers.json: ${fmName}`);
          } else {
            fmName = 'Unknown';
          }
        } catch (e2) {
          log(`Could not read managers.json fallback: ${e2.message}`);
          fmName = 'Unknown';
        }
      }

      // Store for GM approval
      const approvalId = Date.now().toString();
      pendingApprovals.set(approvalId, {
        email,
        contact,
        formProperties,
        scoreResult,
        fmName,
        salespersonChatId: queuedEntry.salespersonChatId,
        queuedEntry
      });

      // Notify GM with approval button
      const gmMessage = `📋 NEW APPLICATION FOR APPROVAL\n\n` +
        `👤 Customer: ${contact.properties.firstname} ${contact.properties.lastname}\n` +
        `📧 Email: ${email}\n` +
        `📱 Phone: ${contact.properties.phone || 'N/A'}\n\n` +
        `💰 Income: $${formProperties.Your_monthly_income || 'N/A'}\n` +
        `🏢 Company: ${formProperties.Company || 'N/A'}\n` +
        `📊 Score: ${scoreResult.score.toFixed(1)}/10 ${scoreResult.emoji}\n\n` +
        `🏦 Assigned FM: ${fmName}\n\n` +
        `Tap "✅ Approve" to notify ${fmName}`;

      const keyboard = {
        inline_keyboard: [[
          { text: '✅ Approve & Notify FM', callback_data: `approve_${approvalId}` },
          { text: '❌ Reject', callback_data: `reject_${approvalId}` }
        ]]
      };

      await sendWithKeyboard(GM_CHAT_ID, gmMessage, keyboard);
      log(`Sent approval request to GM for ${email}`);

      if (queuedEntry.salespersonChatId) {
        await send(queuedEntry.salespersonChatId, `✅ Application submitted for ${email}! Waiting for GM approval before notifying Finance team (score ${scoreResult.score.toFixed(1)}/10 ${scoreResult.emoji}).`);
      }

      pendingQueue.delete(email);
      saveQueue();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, matched: true, score: scoreResult.score, fm: fmName, status: 'pending_gm_approval' }));
      
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

// ---------- Polling loop ----------
async function poll() {
  try {
    const updates = await tg('getUpdates', { offset, timeout: 0 });
    for (const u of updates) {
      offset = u.update_id + 1;
      if (u.message) await onMessage(u.message);
      if (u.callback_query) await onCallbackQuery(u.callback_query);
    }
  } catch (e) {
    log(`Poll error: ${e.message}`);
  }
  setTimeout(poll, 1000);
}

// ---------- Main ----------
async function main() {
  log('Starting dealership-bot...');
  
  loadQueue();
  
  const me = await tg('getMe');
  log(`Connected as @${me.username}`);
  
  const stale = await tg('getUpdates', { offset: -1 });
  if (stale.length > 0) offset = stale[stale.length - 1].update_id + 1;
  
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/webhook/hubspot-form') {
      handleHubspotWebhook(req, res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    log(`HTTP server listening on port ${PORT}`);
    log(`Webhook path: /webhook/hubspot-form`);
  });
  
  log('Telegram polling started');
  poll();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
