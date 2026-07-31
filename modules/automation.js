const { endLowTrafficListings } = require('./listings');
const { resellEndedListings } = require('./reseller');
const { waitForDelay } = require('./utils');

async function runAutomation(ebayClient, { itemLimit, keywords, maxViews, daysLeftThreshold }, log = console.log, { dryRun = false } = {}) {
  const brands = keywords && keywords.length > 0 ? keywords : [null];
  const searchCriteria = { maxViews, daysLeftThreshold };
  const ended = [];
  const resold = [];

  for (let i = 0; i < brands.length; i++) {
    const brandName = brands[i];
    log(`--- Brand ${i + 1} of ${brands.length}: "${brandName || 'all items'}" ---`);

    let endedItems = [];
    try {
      endedItems = await endLowTrafficListings(ebayClient, itemLimit, brandName, searchCriteria, { dryRun });
      if (endedItems.length === 0) {
        log(`No items found for ${brandName || 'all items'}. Skipping.`);
        continue;
      }
      log(`${dryRun ? 'Would end' : 'Ended'} ${endedItems.length} listing(s).`);
      ended.push(...endedItems.map(item => ({ ...item, brand: brandName })));
    } catch (error) {
      log(`Step 1 failed: ${error.message}`);
      continue;
    }

    // Dry-run stops here: reselling has no separate eligibility filter beyond
    // "did it get ended," so "would be resold" is exactly the same set.
    if (!dryRun) {
      try {
        const resoldItems = await resellEndedListings(ebayClient, endedItems);
        log(`Relisted ${resoldItems.length} item(s).`);
        resold.push(...resoldItems.map(item => ({ ...item, brand: brandName })));
      } catch (error) {
        log(`Step 2 failed: ${error.message}`);
      }
    }

    if (i < brands.length - 1) {
      await waitForDelay(3000, 'Waiting 3 seconds before next brand...');
    }
  }

  log(dryRun ? 'Preview complete.' : 'Automation complete.');
  return { ended, resold };
}

module.exports = { runAutomation };
