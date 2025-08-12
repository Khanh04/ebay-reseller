const { navigateToNextPage } = require('./navigation');

async function processAndEndListingsPageByPage(page, itemLimit) {
  console.log(`Looking for up to ${itemLimit} items to end, processing page by page...`);
  
  let totalItemsEnded = 0;
  let currentPage = 1;
  let maxPages = 50;
  
  while (totalItemsEnded < itemLimit && currentPage <= maxPages) {
    console.log(`\n--- Processing page ${currentPage} ---`);
    
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const pageItems = await processListingsForCriteria(page);
    console.log(`Found ${pageItems.length} matching items on page ${currentPage}`);
    
    if (pageItems.length === 0) {
      console.log('No matching items on this page, moving to next page...');
    } else {
      const remainingNeeded = itemLimit - totalItemsEnded;
      const itemsToProcess = Math.min(pageItems.length, remainingNeeded);
      
      console.log(`Will end ${itemsToProcess} items from this page (${remainingNeeded} still needed)`);
      
      const itemsActuallyEnded = await selectAndEndItemsOnCurrentPage(page, pageItems.slice(0, itemsToProcess));
      totalItemsEnded += itemsActuallyEnded;
      
      console.log(`Ended ${itemsActuallyEnded} items from page ${currentPage}. Total ended so far: ${totalItemsEnded}`);
      
      if (totalItemsEnded >= itemLimit) {
        console.log(`✓ Reached target of ${itemLimit} items ended`);
        break;
      }
      
      console.log('Waiting 5 seconds before moving to next page...');
      await page.waitForTimeout(5000);
    }
    
    const hasNextPage = await navigateToNextPage(page);
    if (!hasNextPage) {
      console.log('No more pages available');
      break;
    }
    
    currentPage++;
  }
  
  console.log(`\n🎯 Final result: Ended ${totalItemsEnded} items total across ${currentPage} pages`);
  return totalItemsEnded;
}

async function selectAndEndItemsOnCurrentPage(page, itemsToProcess) {
  try {
    console.log(`Selecting ${itemsToProcess.length} items on current page...`);
    
    for (let i = 0; i < itemsToProcess.length; i++) {
      try {
        await itemsToProcess[i].checkbox.click();
        console.log(`✓ Selected item ${i + 1}/${itemsToProcess.length}`);
        await page.waitForTimeout(200);
      } catch (error) {
        console.error(`Error selecting item ${i + 1}:`, error);
      }
    }
    
    console.log(`Successfully selected ${itemsToProcess.length} items`);
    
    await endSelectedListings(page);
    
    return itemsToProcess.length;
    
  } catch (error) {
    console.error('Error in selectAndEndItemsOnCurrentPage:', error);
    return 0;
  }
}

async function endSelectedListings(page) {
  try {
    console.log('Opening Actions dropdown menu...');
    await page.click('button.fake-menu-button__button:has-text("Actions")');
    
    await page.waitForTimeout(500);
    
    console.log('Selecting "End listings" from Actions dropdown...');
    
    try {
      await page.click('button.fake-menu-button__item:has-text("End listings")');
    } catch (error) {
      console.log('First approach failed, trying alternative methods...');
      
      try {
        await page.click('.shui-menu-dropdown__primary-text:text("End listings")');
      } catch (error) {
        console.log('Second approach failed, trying another method...');
        
        try {
          await page.click('button:has-text("End listings")');
        } catch (error) {
          console.log('Third approach failed, trying XPath...');
          
          try {
            await page.click('xpath=//button[contains(.,"End listings")]');
          } catch (error) {
            console.log('Fourth approach failed, trying all menu items...');
            
            const menuItems = await page.$$eval('li button', buttons => 
              buttons.map(button => button.textContent.trim())
            );
            console.log('Available menu items:', menuItems);
            
            const firstMenuItem = await page.$('li button');
            if (firstMenuItem) {
              await firstMenuItem.click();
              console.log('Clicked first menu item as fallback');
            } else {
              console.error('Could not find any menu items to click');
              throw new Error('Could not find End listings option');
            }
          }
        }
      }
    }
    
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    console.log('Waiting for confirmation dialog to appear...');
    
    await page.waitForSelector('button.btn--primary:has-text("End listings")', { timeout: 10000 });
    console.log('Confirmation dialog detected');
    
    await page.waitForTimeout(500);
    
    console.log('Clicking the confirmation button...');
    await page.click('button.btn--primary:has-text("End listings")');
    
    console.log('Successfully confirmed ending listings');
    
    await page.waitForTimeout(3000);
    console.log('Ending listings process completed for current page');
    
  } catch (error) {
    console.error('Error in endSelectedListings function:', error);
    throw error;
  }
}

async function processListingsForCriteria(page) {
  console.log('Analyzing listings on current page...');
  
  await page.waitForSelector('div.shui-dt', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  const listingRows = await page.$$('tr.grid-row');
  console.log(`Found ${listingRows.length} listings on current page.`);
  
  const itemsToProcess = [];
  
  for (let i = 0; i < listingRows.length; i++) {
    const row = listingRows[i];
    
    try {
      const checkbox = await row.$('input[type="checkbox"]');
      if (!checkbox) continue;
      
      const viewsElement = await row.$('td.shui-dt-column__visitCount .column-views button');
      const viewsText = viewsElement ? await viewsElement.innerText() : '';
      const views = viewsText ? parseInt(viewsText) : -1;
      
      const timeLeftElement = await row.$('td.shui-dt-column__timeRemaining div.shui-dt--text-column div');
      const timeLeftText = timeLeftElement ? await timeLeftElement.innerText() : '';
      let daysLeft = 100;
      
      if (timeLeftText.includes('d')) {
        const match = timeLeftText.match(/(\d+)d/);
        daysLeft = match ? parseInt(match[1]) : 100;
      }
      
      const soldElement = await row.$('td.shui-dt-column__soldQuantity div.shui-dt--text-column div');
      const soldText = soldElement ? await soldElement.innerText() : '0';
      const soldCount = parseInt(soldText) || 0;
      
      const availableElement = await row.$('td.shui-dt-column__availableQuantity div.shui-dt--text-column div span');
      const availableText = availableElement ? await availableElement.innerText() : '0';
      const availableQuantity = parseInt(availableText) || 0;
      
      if (i % 10 === 0) {
        console.log(`Item ${i+1} - Views: ${views}, Days left: ${daysLeft}, Sold: ${soldCount}, Available: ${availableQuantity}`);
      }
      
      if (views === 0 && daysLeft < 15 && soldCount === 0 && availableQuantity > 0) {
        itemsToProcess.push({
          element: row,
          checkbox: checkbox,
          views: views,
          daysLeft: daysLeft,
          soldCount: soldCount,
          availableQuantity: availableQuantity
        });
        console.log(`✓ Match found: ${views} views, ${daysLeft} days left, ${soldCount} sold, ${availableQuantity} available`);
      }
    } catch (error) {
      console.error(`Error processing row ${i+1}:`, error);
    }
  }
  
  console.log(`Found ${itemsToProcess.length} matching items on this page`);
  return itemsToProcess;
}

module.exports = {
  processAndEndListingsPageByPage,
  selectAndEndItemsOnCurrentPage,
  endSelectedListings,
  processListingsForCriteria
};