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
