const fs = require('fs');
const path = require('path');

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function buildFinanceManagerMessage(contact, formProperties, scoreResult) {
  const firstName = contact.properties.firstname || 'Unknown';
  const lastName = contact.properties.lastname || '';
  const email = contact.properties.email || 'Unknown';
  const phone = contact.properties.phone || 'Not provided';

  const creditRating = formProperties.Estimated_Credit_Rating || 'Not provided';
  const employmentStatus = formProperties.Employment_Status || 'Not provided';
  const company = formProperties.Company || 'Not provided';
  const income = formProperties.Your_monthly_income || 'Not provided';
  const incomeDuration = formProperties.How_long_have_you_been_receiving_this_income || 'Not provided';
  const housing = formProperties.Rent_Own_None_a_House || 'Not provided';
  const vehicleType = formProperties.Vehicle_Type || 'Not specified';
  const budget = formProperties.Budget || 'Not specified';

  return `🔔 New Finance App — Assigned to you

👤 ${firstName} ${lastName}
📧 ${email}
📞 ${phone}

📊 Approval Score: ${scoreResult.score.toFixed(1)} / 10  ${scoreResult.emoji}
━━━━━━━━━━━━━━━━
💳 Credit: ${creditRating}
💼 Employment: ${employmentStatus} @ ${company}
💰 Income: $${income}/month (${incomeDuration})
🏠 Housing: ${housing}
🚗 Looking for: ${vehicleType} | Budget $${budget}/mo`;
}

function buildGroupMessage(contact, financeManagerName, scoreResult) {
  const firstName = contact.properties.firstname || 'Unknown';
  const lastName = contact.properties.lastname || '';
  return `📋 Finance app for ${firstName} ${lastName} assigned to ${financeManagerName} — Score: ${scoreResult.score.toFixed(1)}/10 ${scoreResult.emoji}`;
}

function buildTimeoutMessage(email) {
  return `⏰ Finance application monitoring for ${email} has timed out after 24 hours. No form submission was detected.`;
}

async function sendTelegramMessage(chatId, message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log('sendTelegramMessage: TELEGRAM_BOT_TOKEN not set');
    return false;
  }
  if (!chatId) {
    log('sendTelegramMessage: chatId missing');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });
    if (!res.ok) {
      const body = await res.text();
      log(`Telegram sendMessage failed (${res.status}) chat_id=${chatId}: ${body}`);
      return false;
    }
    log(`Sent Telegram message to chat ID: ${chatId}`);
    return true;
  } catch (err) {
    log(`Error sending Telegram message to ${chatId}:`, err.message);
    return false;
  }
}

function getFinanceManagerTelegramId(managerName) {
  try {
    const managersPath = path.join(__dirname, 'config', 'managers.json');
    const managersData = JSON.parse(fs.readFileSync(managersPath, 'utf8'));
    return managersData[managerName] || null;
  } catch (err) {
    log('Error reading managers.json:', err.message);
    return null;
  }
}

async function notifyFinanceManager(contact, formProperties, scoreResult, financeManagerName) {
  const fmTelegramId = getFinanceManagerTelegramId(financeManagerName);
  const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID;

  const dmMessage = buildFinanceManagerMessage(contact, formProperties, scoreResult);
  const groupMessage = buildGroupMessage(contact, financeManagerName, scoreResult);

  let dmSent = false;
  let groupSent = false;

  if (fmTelegramId) {
    dmSent = await sendTelegramMessage(fmTelegramId, dmMessage);
  } else {
    log(`Finance manager "${financeManagerName}" not found in managers.json`);
  }

  if (groupChatId) {
    groupSent = await sendTelegramMessage(groupChatId, groupMessage);
  }

  // Fallback: if DM failed but group worked, mirror the full DM to the group
  if (!dmSent && groupSent && groupChatId) {
    log('DM failed, sending full message to group chat as fallback');
    await sendTelegramMessage(groupChatId, dmMessage);
  }

  return { dmSent, groupSent };
}

async function notifyTimeout(email, salespersonChatId) {
  return await sendTelegramMessage(salespersonChatId, buildTimeoutMessage(email));
}

module.exports = {
  sendTelegramMessage,
  notifyFinanceManager,
  notifyTimeout,
  buildFinanceManagerMessage,
  buildGroupMessage,
  buildTimeoutMessage,
  getFinanceManagerTelegramId
};
