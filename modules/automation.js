const { endLowTrafficListings } = require('./listings');
const { resellEndedListings } = require('./reseller');
const { waitForDelay } = require('./utils');

async function runAutomation(ebayClient, { itemLimit, keywords, maxViews, daysLeftThreshold }, log = console.log) {
  const brands = keywords && keywords.length > 0 ? keywords : [null];
  const searchCriteria = { maxViews, daysLeftThreshold };

  for (let i = 0; i < brands.length; i++) {
    const brandName = brands[i];
    log(`--- Brand ${i + 1} of ${brands.length}: "${brandName || 'all items'}" ---`);

    let endedItemIds = [];
    try {
      endedItemIds = await endLowTrafficListings(ebayClient, itemLimit, brandName, searchCriteria);
      if (endedItemIds.length === 0) {
        log(`No items found for ${brandName || 'all items'}. Skipping.`);
        continue;
      }
      log(`Ended ${endedItemIds.length} listing(s).`);
    } catch (error) {
      log(`Step 1 failed: ${error.message}`);
      continue;
    }

    try {
      const relisted = await resellEndedListings(ebayClient, endedItemIds);
      log(`Relisted ${relisted} item(s).`);
    } catch (error) {
      log(`Step 2 failed: ${error.message}`);
    }

    if (i < brands.length - 1) {
      await waitForDelay(3000, 'Waiting 3 seconds before next brand...');
    }
  }

  log('Automation complete.');
}

module.exports = { runAutomation };
