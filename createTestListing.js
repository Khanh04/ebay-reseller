// ponytail: one-off helper for seeding a sandbox test listing, not part of the
// reseller automation itself. Run with `node createTestListing.js`.
const { loadEnv } = require('./modules/utils');
const { createEbayClient } = require('./modules/ebayApi');

loadEnv();

const { callTradingApi } = createEbayClient({
  token: process.env.EBAY_USER_TOKEN,
  env: process.env.EBAY_ENV
});

// ponytail: GetCategories is a known-flaky sandbox call (long history of 503s on
// eBay's own status page), so this hardcodes a leaf category that's widely used
// in working sandbox examples instead of looking one up live. Audiobooks, unlike
// e.g. Shoes, doesn't demand a pile of mandatory item specifics (brand/size/color/...).
const CATEGORY_ID = '29792';

async function createTestListing() {
  const body = await callTradingApi('AddFixedPriceItem', `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <Title>Ponytail Test Listing ${Date.now()}</Title>
    <Description>Test listing created for exercising the eBay Trading API automation.</Description>
    <PrimaryCategory>
      <CategoryID>${CATEGORY_ID}</CategoryID>
    </PrimaryCategory>
    <ItemSpecifics>
      <NameValueList><Name>Language</Name><Value>English</Value></NameValueList>
      <NameValueList><Name>Book Title</Name><Value>Ponytail Test Listing</Value></NameValueList>
      <NameValueList><Name>Author</Name><Value>Test Author</Value></NameValueList>
    </ItemSpecifics>
    <StartPrice>9.99</StartPrice>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <ConditionID>1000</ConditionID>
    <Country>US</Country>
    <Currency>USD</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <PictureDetails>
      <PictureURL>https://placehold.co/500x500.png</PictureURL>
    </PictureDetails>
    <PostalCode>95125</PostalCode>
    <Quantity>1</Quantity>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>USPSPriority</ShippingService>
        <ShippingServiceCost>0.0</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <Site>US</Site>
  </Item>
</AddFixedPriceItemRequest>`);

  console.log(`Created sandbox listing ${body.ItemID}`);
}

createTestListing().catch(error => {
  console.error('Failed to create test listing:', error.message);
  process.exit(1);
});
