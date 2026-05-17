# Dealership Bot Flow Chart

## Overview
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   USER (You)    │────▶│    Telegram     │────▶│   Bot Server    │
│  @amirparsaasl  │     │   @PrioAutoBOT  │     │  (Your MacBook) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                         │                         │
        │   /start                │   Webhook: NONE         │   Poll every 1s
        │   /newapp test@e.com    │   (Long-polling)      │   (timeout: 0)
        │   /status               │                         │
        ▼                         ▼                         ▼
```

## Main Flow: User → Bot → Response

```
┌─────────────┐
│ User sends  │
│  /start     │
└──────┬──────┘
       │
       ▼
┌─────────────────────────┐
│ Telegram servers        │
│ store the message       │
└──────┬──────────────────┘
       │
       │  Bot asks: "Any new messages?"
       │  (every 1 second)
       ▼
┌─────────────────────────┐
│ Bot receives update:    │
│ {                       │
│   message: {            │
│     chat: {id: 6297...},│
│     text: "/start"      │
│   }                     │
│ }                       │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Bot processes command   │
│                         │
│ if text == "/start":    │
│   reply with welcome    │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Bot sends response      │
│ back to Telegram:       │
│ "🚗 Dealership bot..."  │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│ Telegram delivers to    │
│ user's phone/chat      │
└─────────────────────────┘
```

## HubSpot Polling (Background)

```
┌─────────────────────────────────────────────────────────────┐
│                    BACKGROUND PROCESS                        │
│                   (runs every 60 seconds)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────┐   │   ┌─────────────────────────┐
│  pendingQueue Map         │   │   │  Check each email:      │
│  {                        │◀──┘   │  1. Find in HubSpot?    │
│   "test@e.com": {         │────▶  │  2. Form submitted?     │
│     contactId: null,      │       │  3. Score it            │
│     startedAt: Date,       │◀────  │  4. Assign to FM        │
│     salespersonChatId: id │       │  5. Send notification   │
│   }                       │       │  6. Remove from queue   │
│ }                         │       │                         │
└─────────────────────────┘       └─────────────────────────┘
```

## Data Flow for `/newapp`

```
User: /newapp test@example.com
         │
         ▼
┌─────────────────────┐
│ 1. Validate email   │──Invalid?──▶ Reply: "Invalid email"
│    regex check      │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 2. Check duplicate  │──Exists?──▶ Reply: "Already monitoring"
│    in pendingQueue  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ 3. Add to queue     │
│ pendingQueue.set(   │
│   email,            │
│   {contactId:null,  │
│    startedAt: now,  │
│    salesperson: id} │
│ )                   │
└─────────┬───────────┘
          │
          ▼
    Reply: "✅ Now monitoring..."
```

## Full System Architecture

```
                    ┌──────────────────┐
                    │    Telegram      │
                    │   @PrioAutoBOT   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌─────────┐   ┌─────────┐   ┌─────────┐
        │/start   │   │/newapp  │   │/status  │
        │/cancel  │   │ email   │   │         │
        └────┬────┘   └────┬────┘   └────┬────┘
             │             │             │
             └─────────────┴─────────────┘
                           │
                           ▼
              ┌────────────────────┐
              │   Node.js Bot      │
              │   index.js         │
              │                    │
              │  • Telegram poll   │
              │  • Command handler │
              │  • pendingQueue Map│
              └─────────┬──────────┘
                        │
           ┌────────────┴────────────┐
           │                         │
           ▼                         ▼
   ┌──────────────┐          ┌──────────────┐
   │  HubSpot API │          │ Google Sheets│
   │  (contacts)  │          │  (FM rotation)│
   └──────────────┘          └──────────────┘
```

## Files & Their Roles

```
/Users/amirparsa/Desktop/Overall_Auto/
│
├── index.js          ◄── MAIN BOT (Telegram polling + commands)
│                      • Receives /start, /newapp, /status, /cancel
│                      • Stores pending emails in Map
│                      • Polls Telegram every 1 second
│
├── poller.js         ◄── HUBSPOT POLLER (runs every 60s)
│                      • Checks pendingQueue for each email
│                      • Looks up contact in HubSpot
│                      • Checks for form submissions
│                      • Scores applications, assigns FM
│
├── hubspot.js        ◄── HubSpot API wrapper
├── sheets.js         ◄── Google Sheets API (FM rotation)
├── scorer.js         ◄── Application scoring logic
├── notifier.js       ◄── Sends Telegram notifications to FMs
│
├── config/
│   └── managers.json ◄── FM name → Telegram ID mapping
│
└── .env              ◄── Secrets (token, keys)
    • TELEGRAM_BOT_TOKEN
    • HUBSPOT_TOKEN
    • GOOGLE_SHEET_ID
    • TELEGRAM_GROUP_CHAT_ID
```

## Command Cheat Sheet

| Command | What Happens | Response Time |
|---------|-------------|---------------|
| `/start` | Bot sends welcome message | 1-2 seconds |
| `/newapp email@e.com` | Email added to pendingQueue | 1-2 seconds |
| `/status` | Bot lists monitored emails | 1-2 seconds |
| `/cancel email@e.com` | Email removed from queue | 1-2 seconds |
| Type just an email | Same as /newapp | 1-2 seconds |

## The 15-Minute Bug (FIXED)

**Before (broken):**
```
Bot: timeout: 25  (long-polling)
     fetch() waits 25 seconds for Telegram to respond
     Node.js v20 on macOS hangs → never returns
     User waits 15+ minutes
```

**After (fixed):**
```
Bot: timeout: 0   (no wait)
     fetch() returns immediately
     setTimeout(poll, 1000) → poll every 1 second
     User waits 1-2 seconds
```

## HubSpot Flow (Background)

```
Every 60 seconds:

┌────────────────┐
│ poller.js runs │
└───────┬────────┘
        │
        ▼
┌─────────────────────────────────┐
│ For each email in pendingQueue: │
└────────┬────────────────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌──────────┐
│ Timeout│ │ Contact  │
│ 24hrs? │ │ found?   │
└───┬───┘ └────┬─────┘
    │          │
  Yes         No
    │          │
    ▼          ▼
┌────────┐  ┌────────────┐
│ Notify │  │ Keep in    │
│ timeout│  │ queue,     │
│        │  │ check again│
└────────┘  │ next cycle │
              └────┬───────┘
                   │
              ┌────┴────┐
              │         │
              ▼         ▼
        ┌────────┐ ┌──────────┐
        │ Form   │ │ No form  │
        │ sub'd? │ │ yet      │
        └───┬────┘ └────┬─────┘
            │           │
          Yes          No
            │           │
            ▼           ▼
      ┌─────────┐  ┌────────────┐
      │ Score   │  │ Keep in    │
      │ Assign  │  │ queue      │
      │ Notify  │  │            │
      │ Remove  │  │            │
      └─────────┘  └────────────┘
```

## Summary

1. **User sends command** → Telegram stores it
2. **Bot polls every 1s** → "Any new messages?"
3. **Bot processes** → Runs command handler
4. **Bot responds** → Sends message back to user
5. **Background**: Every 60s, HubSpot poller checks for form submissions
6. **On form found** → Scores, assigns FM, notifies, removes from queue
