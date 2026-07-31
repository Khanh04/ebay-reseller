const { matchesCriteria } = require('./ebayApi');

async function endLowTrafficListings(ebayClient, listings, itemLimit, brandName, searchCriteria = {}, { dryRun = false } = {}) {
  const matches = listings
    .filter(l => matchesCriteria(l, { ...searchCriteria, brandName }))
    .slice(0, itemLimit);

  console.log(`Found ${matches.length} matching listing(s) for ${brandName || 'all items'}.`);

  const endedItems = [];
  for (const listing of matches) {
    try {
      // ponytail: fetchActiveListings can lag behind an item's real-time status
      // (e.g. eBay force-ends a listing for a VeRO/IP takedown after it was
      // already matched here) — re-check right before acting on it rather than
      // trusting the list snapshot. Done even in dryRun so a preview accurately
      // reflects what a real run would skip.
      if (await ebayClient.isItemEnded(listing.itemId)) {
        console.log(`Skipping ${listing.itemId} — already ended (likely by eBay itself since it was listed as active).`);
        continue;
      }

      const hiddenReason = await ebayClient.getHideFromSearchReason(listing.itemId);
      if (hiddenReason) {
        console.log(`Skipping ${listing.itemId} — hidden from search (${hiddenReason}); ending/reselling it won't help.`);
        continue;
      }

      if (!dryRun) await ebayClient.endItem(listing.itemId);
      console.log(`${dryRun ? '(preview) would end' : '✓ Ended'} ${listing.itemId} — "${listing.title}"`);
      endedItems.push({ itemId: listing.itemId, title: listing.title });
    } catch (error) {
      console.error(`Error ending item ${listing.itemId}:`, error.message);
    }
  }

  return endedItems;
}

module.exports = {
  endLowTrafficListings
};
