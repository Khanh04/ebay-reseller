const { chromium } = require('playwright');
const { handleLogin } = require('./modules/auth');
const { navigateToActiveListings, navigateToEndedListings } = require('./modules/navigation');
const { processAndEndListingsPageByPage } = require('./modules/listings');
const { applyBrandFilter } = require('./modules/filters');
const { resellEndedListings } = require('./modules/reseller');
const {
  waitForDelay,
  initializeBrowser,
  logBrandProcessingStart,
  logBrandProcessingComplete,
  logAllBrandsComplete,
  logStepStart,
  logAutomationComplete
} = require('./modules/utils');

async function ebayAutomation(itemLimit = 10, brandNames = []) {
  const { browser, context, page } = await initializeBrowser(chromium);

  try {
    await handleLogin(page);
    
    if (brandNames && brandNames.length > 0) {
      console.log(`Will process ${brandNames.length} brand(s): ${brandNames.join(', ')}`);
      
      for (let i = 0; i < brandNames.length; i++) {
        const brandName = brandNames[i];
        logBrandProcessingStart(i, brandNames.length, brandName);
        
        await processBrandCompletely(page, brandName, itemLimit);
        
        logBrandProcessingComplete(brandName);
        
        if (i < brandNames.length - 1) {
          await waitForDelay(3000, 'Waiting 3 seconds before processing next brand...');
        }
      }
      
      logAllBrandsComplete();
      
    } else {
      console.log('No brand filtering specified, processing all items...');
      await processBrandCompletely(page, null, itemLimit);
    }
    
    logAutomationComplete();
    await new Promise(() => {});
    
  } catch (error) {
    console.error('Error during automation:', error);
    console.error(error.stack);
  }
}

async function processBrandCompletely(page, brandName, itemLimit) {
  try {
    logStepStart(1, `Finding and ending active listings for "${brandName || 'all items'}"`);
    
    await navigateToActiveListings(page);
    
    if (brandName) {
      await applyBrandFilter(page, brandName);
    }
    
    const totalEnded = await processAndEndListingsPageByPage(page, itemLimit);
    
    if (totalEnded === 0) {
      console.log(`No items found for ${brandName || 'all items'}. Skipping to next brand.`);
      return;
    }
    
    console.log(`Successfully ended ${totalEnded} listings for "${brandName || 'all items'}"`);

    await waitForDelay(60000, 'Waiting 1 minute before proceeding to resell...');
    
    logStepStart(2, 'Reselling ended listings');
    await navigateToEndedListings(page);
    await resellEndedListings(page, totalEnded, brandName);
    
    console.log(`Successfully completed all steps for "${brandName || 'all items'}"`);
    
  } catch (error) {
    console.error(`Error processing brand "${brandName || 'all items'}":`, error);
    throw error;
  }
}

ebayAutomation(50, ['DND']);