# Dealership Bot

A Telegram bot for car dealership finance application monitoring. Salespeople can register customer emails, and the bot automatically watches HubSpot for finance application submissions, scores them, and assigns them to finance managers via Telegram.

## Features

- **Email Monitoring**: Register customer emails to watch for finance form submissions
- **HubSpot Integration**: Polls HubSpot CRM API every 60 seconds for new form submissions
- **Approval Scoring**: Automatically scores finance applications based on credit, employment, income, housing, and income duration
- **Finance Manager Rotation**: Reads next finance manager from Google Sheets
- **Telegram Notifications**: Sends detailed lead summaries to finance managers via DM and group chat
- **Timeout Handling**: Automatically removes stale entries after 24 hours

## Project Structure

```
dealership-bot/
├── .env                          # Environment variables
├── index.js                      # Telegram bot entry point
├── poller.js                     # HubSpot polling loop
├── hubspot.js                    # HubSpot API functions
├── sheets.js                     # Google Sheets reader
├── scorer.js                     # Approval score calculator
├── notifier.js                   # Telegram message builder + sender
├── config/
│   └── managers.json             # Finance manager Telegram ID mappings
└── service-account-key.json      # Google Sheets service account key (create this)
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Edit `.env` and fill in the following:

```env
HUBSPOT_TOKEN=your_hubspot_access_token
TELEGRAM_BOT_TOKEN=8285894717:AAHGQqQIa82DLaviMUNT7DuL5pYgMvqiOCU
GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_SHEET_NAME=Sheet1
GOOGLE_SHEET_CELL=B2
TELEGRAM_GROUP_CHAT_ID=your_group_chat_id
```

### 3. Set Up Google Sheets Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google Sheets API
4. Create a service account:
   - Go to IAM & Admin > Service Accounts
   - Click "Create Service Account"
   - Give it a name (e.g., "dealership-bot")
5. Create and download a JSON key:
   - Click on the service account
   - Go to "Keys" tab
   - Click "Add Key" > "Create New Key"
   - Select JSON and download
6. Rename the downloaded file to `service-account-key.json` and place it in the project root
7. Share your Google Sheet with the service account email:
   - Open your Google Sheet
   - Click "Share"
   - Add the service account email (found in the JSON key file)
   - Give it "Viewer" access

### 4. Configure Finance Managers

Edit `config/managers.json` to map finance manager names to their Telegram user IDs:

```json
{
  "Sarah": 123456789,
  "Mike": 987654321,
  "Julie": 111222333
}
```

To find a Telegram user ID:
1. Start a conversation with @userinfobot on Telegram
2. It will reply with your user ID

### 5. Set Up Google Sheet

Create a Google Sheet with:
- Sheet name: `Sheet1` (or configure in `.env`)
- Cell B2: Contains the name of the next finance manager in rotation

### 6. Configure HubSpot Form

Ensure your HubSpot form has the following properties:
- `Estimated_Credit_Rating`
- `Employment_Status`
- `Your_monthly_income`
- `Rent_Own_None_a_House`
- `How_long_have_you_been_receiving_this_income`
- `Company`
- `Vehicle_Type`
- `Budget`

The form name should contain "Finance" to be detected by the bot.

## Running the Bot

```bash
npm start
```

## Telegram Bot Commands

- `/newapp <email>` - Register an email to monitor for finance application
  - Example: `/newapp john@email.com`
  
- `/status` - List all emails currently being monitored
  
- `/cancel <email>` - Remove an email from the monitoring queue
  - Example: `/cancel john@email.com`

## Scoring Logic

The bot scores applications out of 10 based on:

| Field | Weight | Criteria |
|---|---|---|
| Credit Rating | 3 pts | Excellent (750+): 3, Good (700-749): 2.5, Fair (650-699): 1.5, Poor (550-649): 0.5, Bad (<550): 0 |
| Employment Status | 2 pts | Employed: 2, Self-employed: 1.5, Other: 0.5 |
| Monthly Income | 2 pts | >5000: 2, 3000-5000: 1.5, 1500-3000: 1, <1500: 0.5 |
| Housing | 1 pt | Own: 1, Rent: 0.5, None: 0 |
| Income Duration | 2 pts | >3 years: 2, 1-3 years: 1.5, 6-12 months: 1, <6 months: 0.5 |

**Score Thresholds:**
- 🟢 Strong file: 7+
- 🟡 Workable file: 4-6.9
- 🔴 Weak file: <4

## Notification Format

### Finance Manager DM

```
🔔 New Finance App — Assigned to you

👤 [First] [Last]
📧 [email]
📞 [phone]

📊 Approval Score: [X.X] / 10  [emoji]
━━━━━━━━━━━━━━━━
💳 Credit: [rating]
💼 Employment: [status] @ [company]
💰 Income: $[amount]/month ([duration])
🏠 Housing: [rent/own]
🚗 Looking for: [vehicle type] | Budget $[budget]/mo
```

### Group Chat

```
📋 Finance app for [Name] assigned to [FM Name] — Score: [X]/10 [emoji]
```

## Troubleshooting

### HubSpot API Errors
- Verify your `HUBSPOT_TOKEN` is valid
- Check that the token has the required permissions (contacts read, form submissions read)

### Google Sheets Errors
- Ensure `service-account-key.json` exists in the project root
- Verify the service account email has access to the Google Sheet
- Check that `GOOGLE_SHEET_ID` is correct

### Telegram Errors
- Verify your `TELEGRAM_BOT_TOKEN` is valid
- Ensure finance manager user IDs in `managers.json` are correct (numbers, not @usernames)
- Check that the bot has permission to send messages to the group chat

## Development

All API errors are logged with timestamps for debugging. The bot will not crash on API errors - it will continue running and log the issue.

Polling runs every 60 seconds and checks all pending emails in the queue.
# dealership-bot
