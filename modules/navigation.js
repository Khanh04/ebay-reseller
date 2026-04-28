async function waitForSellerListingsReady(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#shui-search-box__input, div.shui-dt, tr.grid-row', { timeout: 30000 });
}

async function navigateToActiveListings(page) {
  console.log('Navigating to active listings...');
  await page.goto('https://www.ebay.com/sh/lst/active?action=sort&sort=visitCount', {
    waitUntil: 'domcontentloaded'
  });
  await waitForSellerListingsReady(page);
}

async function navigateToEndedListings(page) {
  console.log('Navigating to unsold/not relisted items page...');
  await page.goto('https://www.ebay.com/sh/lst/ended?status=UNSOLD_NOT_RELISTED', {
    waitUntil: 'domcontentloaded'
  });
  await waitForSellerListingsReady(page);
  console.log('Unsold/not relisted items page loaded');
  await page.waitForTimeout(3000);
}

async function navigateToNextPage(page) {
  try {
    console.log('Looking for next page button...');
    
    const nextButton = await page.$('a.pagination__next[aria-label="Go to next page"]');
    
    if (!nextButton) {
      console.log('Next page button not found');
      return false;
    }
    
    const isDisabled = await nextButton.getAttribute('aria-disabled');
    if (isDisabled === 'true') {
      console.log('Next page button is disabled (last page reached)');
      return false;
    }
    
    console.log('Clicking next page button...');
    await nextButton.click();
    await waitForSellerListingsReady(page);
    await page.waitForTimeout(2000);
    
    console.log('Successfully navigated to next page');
    return true;
    
  } catch (error) {
    console.error('Error navigating to next page:', error);
    return false;
  }
}

module.exports = {
  navigateToActiveListings,
  navigateToEndedListings,
  navigateToNextPage
};