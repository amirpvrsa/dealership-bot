const { google } = require('googleapis');
const fs = require('fs');

let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) {
    return sheetsClient;
  }

  try {
    // Look for service account key file
    const keyFilePath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './service-account-key.json';
    
    if (!fs.existsSync(keyFilePath)) {
      console.error(`[${new Date().toISOString()}] Google Sheets service account key file not found at: ${keyFilePath}`);
      console.error(`[${new Date().toISOString()}] Please download the service account JSON key from Google Cloud Console and save it as service-account-key.json`);
      return null;
    }

    const credentials = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    return sheetsClient;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error initializing Google Sheets client:`, error.message);
    return null;
  }
}

async function getNextFinanceManager() {
  try {
    const client = await getSheetsClient();
    if (!client) {
      return null;
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const sheetName = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
    const cell = process.env.GOOGLE_SHEET_CELL || 'B2';

    if (!spreadsheetId) {
      console.error(`[${new Date().toISOString()}] GOOGLE_SHEET_ID not set in environment variables`);
      return null;
    }

    const response = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${cell}`
    });

    if (response.data.values && response.data.values.length > 0) {
      const fmName = response.data.values[0][0];
      console.log(`[${new Date().toISOString()}] Retrieved next finance manager from Google Sheets: ${fmName}`);
      return fmName;
    }

    console.error(`[${new Date().toISOString()}] No value found in Google Sheets at ${sheetName}!${cell}`);
    return null;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error reading from Google Sheets:`, error.message);
    if (error.response) {
      console.error(`[${new Date().toISOString()}] Google Sheets API error:`, JSON.stringify(error.response.data));
    }
    return null;
  }
}

module.exports = {
  getNextFinanceManager
};
