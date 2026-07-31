const { XMLParser } = require('fast-xml-parser');

const SITE_ID = 0; // US
const COMPATIBILITY_LEVEL = '1193';

const parser = new XMLParser({ ignoreAttributes: true });

function apiHost(env) {
  return env === 'production' ? 'api.ebay.com' : 'api.sandbox.ebay.com';
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseIsoDurationDays(iso) {
  // "P30DT23H59M20S" -> days as a float. GTC listings have no fixed EndTime (they
  // auto-renew), so TimeLeft (time until next renewal) is what Seller Hub's "time
  // left" column actually reflects, and what daysLeft needs to be based on.
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso || '');
  if (!match) return 100;
  const [, days, hours, minutes, seconds] = match;
  return (Number(days) || 0) + (Number(hours) || 0) / 24 + (Number(minutes) || 0) / 1440 + (Number(seconds) || 0) / 86400;
}

function toListing(item) {
  const soldCount = Number(item.SellingStatus?.QuantitySold) || 0;
  const quantity = Number(item.Quantity) || 0;

  return {
    itemId: String(item.ItemID),
    title: item.Title,
    // ponytail: HitCount never showed up in GetMyeBaySelling responses during
    // sandbox testing (not just zero — absent), so this can't be verified against
    // a listing with real view history. Confirm against a real production listing
    // before trusting "0 views" here; if it's never returned, switch to a GetItem
    // call per item (IncludeItemSpecifics not needed, just the base ItemType).
    views: Number(item.HitCount) || 0,
    daysLeft: parseIsoDurationDays(item.TimeLeft),
    soldCount,
    availableQuantity: quantity - soldCount
  };
}

function matchesCriteria(listing, { brandName, maxViews = 0, daysLeftThreshold = 15 } = {}) {
  if (brandName && !listing.title?.toLowerCase().includes(brandName.toLowerCase())) return false;
  return listing.views <= maxViews && listing.daysLeft < daysLeftThreshold && listing.soldCount === 0 && listing.availableQuantity > 0;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function itemSpecificsXml(nameValueList) {
  return asArray(nameValueList).flatMap(nv =>
    asArray(nv.Value).map(v => `<NameValueList><Name>${escapeXml(nv.Name)}</Name><Value>${escapeXml(v)}</Value></NameValueList>`)
  ).join('');
}

function shippingServiceOptionsXml(options) {
  return asArray(options).map((opt, i) => `
    <ShippingServiceOptions>
      <ShippingServicePriority>${opt.ShippingServicePriority || i + 1}</ShippingServicePriority>
      <ShippingService>${escapeXml(opt.ShippingService)}</ShippingService>
      <ShippingServiceCost>${opt.ShippingServiceCost ?? 0}</ShippingServiceCost>
    </ShippingServiceOptions>`).join('');
}

// Sellers who've opted into eBay's Business Policies must reference their
// existing named policies by ID instead of inline ShippingDetails/ReturnPolicy
// — mixing the two is a hard AddFixedPriceItem error ("use policy IDs rather
// than legacy fields"). GetItem returns SellerProfiles for such sellers; its
// absence means the seller is still on legacy per-listing fields.
function sellerProfilesXml(sellerProfiles) {
  const shippingId = sellerProfiles.SellerShippingProfile?.ShippingProfileID;
  const returnId = sellerProfiles.SellerReturnProfile?.ReturnProfileID;
  const paymentId = sellerProfiles.SellerPaymentProfile?.PaymentProfileID;

  return `<SellerProfiles>
    ${shippingId ? `<SellerShippingProfile><ShippingProfileID>${shippingId}</ShippingProfileID></SellerShippingProfile>` : ''}
    ${returnId ? `<SellerReturnProfile><ReturnProfileID>${returnId}</ReturnProfileID></SellerReturnProfile>` : ''}
    ${paymentId ? `<SellerPaymentProfile><PaymentProfileID>${paymentId}</PaymentProfileID></SellerPaymentProfile>` : ''}
  </SellerProfiles>`;
}

// ponytail: EBAY_USER_TOKEN / a client's stored refresh-derived token is used
// directly via X-EBAY-API-IAF-TOKEN — no OAuth refresh-token exchange needed for
// the long-lived Auth'n'Auth case (CLI usage); the web app's per-client tokens
// come from the real 3-legged OAuth flow instead (see server.js).
function createEbayClient({ token, env }) {
  const host = apiHost(env);

  async function callTradingApi(callName, bodyXml) {
    const res = await fetch(`https://${host}/ws/api.dll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-SITEID': String(SITE_ID),
        'X-EBAY-API-COMPATIBILITY-LEVEL': COMPATIBILITY_LEVEL,
        'X-EBAY-API-CALL-NAME': callName,
        'X-EBAY-API-IAF-TOKEN': token
      },
      body: bodyXml
    });

    const parsed = parser.parse(await res.text());
    const body = parsed[`${callName}Response`];

    if (!body || body.Ack === 'Failure') {
      const errors = body?.Errors ? [].concat(body.Errors) : [];
      const message = errors.map(e => e.LongMessage || e.ShortMessage).join('; ') || `${callName} failed`;
      throw new Error(message);
    }

    return body;
  }

  async function fetchMyEbaySellingList(listName) {
    const listings = [];
    let pageNumber = 1;

    while (true) {
      // ponytail: DetailLevel=ReturnAll is the documented way to get HitCount back;
      // if it comes back 0/missing for real listings, check GetMyeBaySelling docs
      // for an ActiveList-specific flag instead.
      const body = await callTradingApi('GetMyeBaySelling', `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <${listName}>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </${listName}>
</GetMyeBaySellingRequest>`);

      const list = body[listName];
      listings.push(...asArray(list?.ItemArray?.Item).map(toListing));

      // ponytail: fetches every page up front rather than stopping early once
      // enough matches are found — simpler, fine at normal seller-listing
      // volumes; add early exit if a store has thousands of active listings.
      const totalPages = Number(list?.PaginationResult?.TotalNumberOfPages) || 1;
      if (pageNumber >= totalPages) break;
      pageNumber++;
    }

    return listings;
  }

  async function fetchActiveListings() {
    return fetchMyEbaySellingList('ActiveList');
  }

  async function isItemEnded(itemId) {
    const { Item: item } = await callTradingApi('GetItem', `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
</GetItemRequest>`);
    return item.SellingStatus?.ListingStatus === 'Ended' || item.SellingStatus?.ListingStatus === 'Completed';
  }

  // Catches VeRO/policy-violation holds (and other hidden-from-search states)
  // before we end the item — ending one is harmless, but reselling it just
  // recreates the same flagged content and fails the same way every time.
  async function getHideFromSearchReason(itemId) {
    const { Item: item } = await callTradingApi('GetItem', `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
</GetItemRequest>`);
    return item.HideFromSearch === 'true' ? (item.ReasonHideFromSearch || 'unspecified reason') : null;
  }

  async function endItem(itemId) {
    await callTradingApi('EndItem', `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndItemRequest>`);
  }

  // "Sell Similar" in Seller Hub just pre-fills a brand-new listing from an old
  // one's details — unlike Relist, it doesn't reference the original ItemID,
  // isn't bound to the 90-day relist window, and doesn't carry over watchers.
  async function sellSimilarItem(itemId) {
    const { Item: item } = await callTradingApi('GetItem', `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
</GetItemRequest>`);

    const pictureUrls = asArray(item.PictureDetails?.PictureURL).length
      ? asArray(item.PictureDetails.PictureURL)
      : asArray(item.PictureDetails?.GalleryURL);

    const policyXml = item.SellerProfiles
      ? sellerProfilesXml(item.SellerProfiles)
      : `<ReturnPolicy>
      <ReturnsAcceptedOption>${item.ReturnPolicy?.ReturnsAcceptedOption}</ReturnsAcceptedOption>
      <RefundOption>${item.ReturnPolicy?.RefundOption}</RefundOption>
      <ReturnsWithinOption>${item.ReturnPolicy?.ReturnsWithinOption}</ReturnsWithinOption>
      <ShippingCostPaidByOption>${item.ReturnPolicy?.ShippingCostPaidByOption}</ShippingCostPaidByOption>
    </ReturnPolicy>
    <ShippingDetails>
      <ShippingType>${item.ShippingDetails?.ShippingType || 'Flat'}</ShippingType>
      ${shippingServiceOptionsXml(item.ShippingDetails?.ShippingServiceOptions)}
    </ShippingDetails>`;

    const body = await callTradingApi('AddFixedPriceItem', `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <Title>${escapeXml(item.Title)}</Title>
    <Description>${escapeXml(item.Description)}</Description>
    <PrimaryCategory>
      <CategoryID>${item.PrimaryCategory.CategoryID}</CategoryID>
    </PrimaryCategory>
    <ItemSpecifics>${itemSpecificsXml(item.ItemSpecifics?.NameValueList)}</ItemSpecifics>
    <StartPrice>${item.StartPrice ?? item.BuyItNowPrice}</StartPrice>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <ConditionID>${item.ConditionID}</ConditionID>
    <Country>${item.Country}</Country>
    <Currency>${item.Currency}</Currency>
    <DispatchTimeMax>${item.DispatchTimeMax}</DispatchTimeMax>
    <ListingDuration>${item.ListingDuration}</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <PictureDetails>${pictureUrls.map(u => `<PictureURL>${escapeXml(u)}</PictureURL>`).join('')}</PictureDetails>
    ${item.PostalCode ? `<PostalCode>${item.PostalCode}</PostalCode>` : ''}
    <Quantity>${item.Quantity}</Quantity>
    ${policyXml}
    <Site>${item.Site}</Site>
  </Item>
</AddFixedPriceItemRequest>`);

    return String(body.ItemID);
  }

  return {
    callTradingApi,
    fetchActiveListings,
    isItemEnded,
    getHideFromSearchReason,
    endItem,
    sellSimilarItem
  };
}

module.exports = {
  createEbayClient,
  matchesCriteria
};
