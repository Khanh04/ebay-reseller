const { chromium } = require('playwright');
const { handleLogin } = require('./modules/auth');
const { navigateToActiveListings, navigateToEndedListings } = require('./modules/navigation');
const { processAndEndListingsPageByPage } = require('./modules/listings');
const { applyBrandFilter } = require('./modules/filters');
const { resellEndedListings } = require('./modules/reseller');
const {
  waitForDelay,
  promptUser,
  logBrandProcessingStart,
  logBrandProcessingComplete,
  logAllBrandsComplete,
  logStepStart,
  logAutomationComplete
} = require('./modules/utils');

async function ebayAutomation(accounts) {
  const browser = await chromium.launch({ headless: false });

  for (const account of accounts) {
    console.log(`\n========================================`);
    console.log(`Processing account: ${account.email}`);
    console.log(`========================================`);

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto('https://www.ebay.com/');
      await handleLogin(page, account);

      const brands = account.keywords && account.keywords.length > 0 ? account.keywords : [null];

      for (let i = 0; i < brands.length; i++) {
        logBrandProcessingStart(i, brands.length, brands[i] || 'all items');
        await processBrandCompletely(page, brands[i], account.amount);
        logBrandProcessingComplete(brands[i] || 'all items');
        if (i < brands.length - 1) {
          await waitForDelay(3000, 'Waiting 3 seconds before processing next brand...');
        }
      }

      logAllBrandsComplete();
    } catch (error) {
      console.error(`Error for account ${account.email}:`, error.message);
    }
  }

  logAutomationComplete();
  await new Promise(() => {});
}

async function processBrandCompletely(page, brandName, itemLimit) {
  logStepStart(1, `Finding and ending active listings for "${brandName || 'all items'}"`);

  let totalEnded = 0;
  try {
    await navigateToActiveListings(page);
    if (brandName) await applyBrandFilter(page, brandName);
    totalEnded = await processAndEndListingsPageByPage(page, itemLimit);
    if (totalEnded === 0) {
      console.log(`No items found for ${brandName || 'all items'}. Skipping to next brand.`);
      return;
    }
    console.log(`Successfully ended ${totalEnded} listings for "${brandName || 'all items'}"`);
  } catch (error) {
    console.error(`Step 1 failed: ${error.message}`);
    await promptUser('\nFix it in the browser, then press Enter to continue to step 2 (or Ctrl+C to abort): ');
    // ponytail: use itemLimit as best-guess count since we don't know how many were manually ended
    totalEnded = itemLimit;
  }

  await waitForDelay(60000, 'Waiting 1 minute before proceeding to resell...');

  logStepStart(2, 'Reselling ended listings');
  try {
    await navigateToEndedListings(page);
    await resellEndedListings(page, totalEnded, brandName);
    console.log(`Successfully completed all steps for "${brandName || 'all items'}"`);
  } catch (error) {
    console.error(`Step 2 failed: ${error.message}`);
    await promptUser('\nFix it in the browser, then press Enter to continue (or Ctrl+C to abort): ');
  }
}

ebayAutomation([
  {
    email: '',
    password: '',
    amount: 10,
    keywords: []
  }
]);