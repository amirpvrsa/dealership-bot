// DEPRECATED — kept only to avoid breaking `git log` history.
//
// The dealership bot is now webhook-driven: HubSpot's custom-code action
// POSTs to /webhook/hubspot-form on every finance form submission, and
// index.js handles the match + score + notify flow inline.
//
// If you want to re-enable polling as a fallback (e.g. for cases where
// HubSpot can't reach the bot), rebuild this file against the current
// notifier.js signature (no `bot` argument — notifier uses raw fetch).
//
// Safe to delete this file entirely.
module.exports = {
  startPolling() {
    console.log(
      `[${new Date().toISOString()}] poller.js: polling is deprecated and intentionally a no-op`
    );
  }
};
