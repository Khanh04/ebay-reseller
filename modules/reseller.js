const { waitForDelay } = require('./utils');

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 24; // ~2 minutes per item, well above the ~15s lag observed in practice

async function waitUntilEnded(ebayClient, itemId) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (await ebayClient.isItemEnded(itemId)) return true;
    await waitForDelay(POLL_INTERVAL_MS);
  }
  return false;
}

// Resells exactly the items this run ended — not "whatever's in UnsoldList", which
// also contains every historically-ended-unsold item (including ones already
// resold earlier) and would otherwise get reprocessed forever.
async function resellEndedListings(ebayClient, endedItems) {
  console.log(`Reselling ${endedItems.length} item(s) just ended.`);

  const resold = [];
  for (const { itemId, title } of endedItems) {
    try {
      const ended = await waitUntilEnded(ebayClient, itemId);
      if (!ended) {
        console.error(`Timed out waiting for ${itemId} to end — skipping.`);
        continue;
      }
      const newItemId = await ebayClient.sellSimilarItem(itemId);
      console.log(`✓ Sold similar for ${itemId} → ${newItemId}`);
      resold.push({ oldItemId: itemId, newItemId, title });
    } catch (error) {
      console.error(`Error reselling item ${itemId}:`, error.message);
    }
  }

  return resold;
}

module.exports = {
  resellEndedListings
};
