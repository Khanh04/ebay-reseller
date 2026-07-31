const { matchesCriteria } = require('./ebayApi');

async function endLowTrafficListings(ebayClient, itemLimit, brandName, searchCriteria = {}) {
  const listings = await ebayClient.fetchActiveListings();
  const matches = listings
    .filter(l => matchesCriteria(l, { ...searchCriteria, brandName }))
    .slice(0, itemLimit);

  console.log(`Found ${matches.length} matching listing(s) for ${brandName || 'all items'}.`);

  const endedItemIds = [];
  for (const listing of matches) {
    try {
      // ponytail: fetchActiveListings can lag behind an item's real-time status
      // (e.g. eBay force-ends a listing for a VeRO/IP takedown after it was
      // already matched here) — re-check right before acting on it rather than
      // trusting the list snapshot.
      if (await ebayClient.isItemEnded(listing.itemId)) {
        console.log(`Skipping ${listing.itemId} — already ended (likely by eBay itself since it was listed as active).`);
        continue;
      }

      const hiddenReason = await ebayClient.getHideFromSearchReason(listing.itemId);
      if (hiddenReason) {
        console.log(`Skipping ${listing.itemId} — hidden from search (${hiddenReason}); ending/reselling it won't help.`);
        continue;
      }

      await ebayClient.endItem(listing.itemId);
      console.log(`✓ Ended ${listing.itemId} — "${listing.title}"`);
      endedItemIds.push(listing.itemId);
    } catch (error) {
      console.error(`Error ending item ${listing.itemId}:`, error.message);
    }
  }

  return endedItemIds;
}

module.exports = {
  endLowTrafficListings
};
