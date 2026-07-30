const { loadEnv } = require('./modules/utils');
const { createEbayClient } = require('./modules/ebayApi');
const { runAutomation } = require('./modules/automation');

loadEnv();

const ebayClient = createEbayClient({
  token: process.env.EBAY_USER_TOKEN,
  env: process.env.EBAY_ENV
});

runAutomation(ebayClient, {
  itemLimit: 10,
  keywords: [],
  maxViews: 0,
  daysLeftThreshold: 15
});
