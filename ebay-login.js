const { chromium } = require('playwright');

async function ebayAutomation(itemLimit = 10, brandNames = []) {
  // Launch the browser
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to eBay
    await page.goto('https://www.ebay.com/');
    
    // Check if already logged in by looking for a sign-in link
    const needsLogin = await page.$('a[href*="signin"]');
    
    if (needsLogin) {
      console.log('Not logged in. Opening login page...');
      // Click on the Sign In link
      await needsLogin.click();
      
      console.log('Please log in manually. The script will wait until login is complete.');
      
      // Wait for login to complete by detecting either:
      // 1. Redirect to homepage after login, or
      // 2. Presence of user menu that indicates logged-in state
      await Promise.race([
        // Wait for navigation to complete (if redirected to homepage)
        page.waitForNavigation({ timeout: 300000 }), // 5 minute timeout
        // Wait for an element that only appears when logged in (user menu)
        page.waitForSelector('.gh-identity, .gh-account, .account-info', { timeout: 300000 })
      ]);
      
      console.log('Login detected! Proceeding...');
    } else {
      console.log('Already logged in. Proceeding...');
    }
    
    // If brandNames array is provided and not empty, process each brand individually
    if (brandNames && brandNames.length > 0) {
      console.log(`Will process ${brandNames.length} brand(s): ${brandNames.join(', ')}`);
      
      for (let i = 0; i < brandNames.length; i++) {
        const brandName = brandNames[i];
        console.log(`\n========================================`);
        console.log(`Processing brand ${i + 1} of ${brandNames.length}: "${brandName}"`);
        console.log(`========================================`);
        
        // Process this brand completely (end listings and resell)
        await processBrandCompletely(page, brandName, itemLimit);
        
        console.log(`Completed processing for brand: "${brandName}"`);
        
        // Add a delay between brands to avoid overwhelming eBay
        if (i < brandNames.length - 1) {
          console.log('Waiting 3 seconds before processing next brand...');
          await page.waitForTimeout(3000);
        }
      }
      
      console.log('\n========================================');
      console.log('All brands processed successfully!');
      console.log('========================================');
      
    } else {
      // No brand filtering - process all items at once
      console.log('No brand filtering specified, processing all items...');
      await processBrandCompletely(page, null, itemLimit);
    }
    
    // Keep browser open for manual review
    console.log('Automation complete. Browser will remain open for you to review.');
    console.log('Press Ctrl+C in your terminal to exit when finished.');
    await new Promise(() => {});
    
  } catch (error) {
    console.error('Error during automation:', error);
    console.error(error.stack);
  }
  // Browser remains open for manual review
}

// New function to process a single brand completely (end listings + resell)
async function processBrandCompletely(page, brandName, itemLimit) {
  try {
    // Step 1: Navigate to active listings and apply brand filter
    console.log(`\n--- Step 1: Finding and ending active listings for "${brandName || 'all items'}" ---`);
    
    // Navigate to the active listings sorted by visit count page
    await page.goto('https://www.ebay.com/sh/lst/active?action=sort&sort=visitCount');
    await page.waitForLoadState('networkidle');
    
    if (brandName) {
      // Apply brand filter
      await applyBrandFilter(page, brandName);
    }
    
    // Process pages one by one, ending items as we go
    const totalEnded = await processAndEndListingsPageByPage(page, itemLimit);
    
    if (totalEnded === 0) {
      console.log(`No items found for ${brandName || 'all items'}. Skipping to next brand.`);
      return;
    }
    
    console.log(`Successfully ended ${totalEnded} listings for "${brandName || 'all items'}"`);

    console.log('Waiting 1 minute before proceeding to resell...');
    await page.waitForTimeout(60000);
    
    // Step 2: Navigate to ended listings and resell
    console.log(`\n--- Step 2: Reselling ended listings ---`);
    await resellEndedListings(page, totalEnded, brandName);
    
    console.log(`Successfully completed all steps for "${brandName || 'all items'}"`);
    
  } catch (error) {
    console.error(`Error processing brand "${brandName || 'all items'}":`, error);
    throw error;
  }
}

// New function to process and end listings page by page
async function processAndEndListingsPageByPage(page, itemLimit) {
  console.log(`Looking for up to ${itemLimit} items to end, processing page by page...`);
  
  let totalItemsEnded = 0;
  let currentPage = 1;
  let maxPages = 50; // Safety limit to prevent infinite loops
  
  while (totalItemsEnded < itemLimit && currentPage <= maxPages) {
    console.log(`\n--- Processing page ${currentPage} ---`);
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Find matching items on current page
    const pageItems = await processListingsForCriteria(page);
    console.log(`Found ${pageItems.length} matching items on page ${currentPage}`);
    
    if (pageItems.length === 0) {
      console.log('No matching items on this page, moving to next page...');
    } else {
      // Calculate how many items we can process from this page
      const remainingNeeded = itemLimit - totalItemsEnded;
      const itemsToProcess = Math.min(pageItems.length, remainingNeeded);
      
      console.log(`Will end ${itemsToProcess} items from this page (${remainingNeeded} still needed)`);
      
      // Select and end items from this page
      const itemsActuallyEnded = await selectAndEndItemsOnCurrentPage(page, pageItems.slice(0, itemsToProcess));
      totalItemsEnded += itemsActuallyEnded;
      
      console.log(`Ended ${itemsActuallyEnded} items from page ${currentPage}. Total ended so far: ${totalItemsEnded}`);
      
      // If we've ended enough items, break
      if (totalItemsEnded >= itemLimit) {
        console.log(`✓ Reached target of ${itemLimit} items ended`);
        break;
      }
      
      // Wait before continuing to next page
      console.log('Waiting 5 seconds before moving to next page...');
      await page.waitForTimeout(5000);
    }
    
    // Try to navigate to next page
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

// Function to select and end items on the current page
async function selectAndEndItemsOnCurrentPage(page, itemsToProcess) {
  try {
    console.log(`Selecting ${itemsToProcess.length} items on current page...`);
    
    // Select all the matching items on this page
    for (let i = 0; i < itemsToProcess.length; i++) {
      try {
        await itemsToProcess[i].checkbox.click();
        console.log(`✓ Selected item ${i + 1}/${itemsToProcess.length}`);
        // Small delay between clicks to avoid rate limiting
        await page.waitForTimeout(200);
      } catch (error) {
        console.error(`Error selecting item ${i + 1}:`, error);
      }
    }
    
    console.log(`Successfully selected ${itemsToProcess.length} items`);
    
    // End the selected listings
    await endSelectedListings(page);
    
    return itemsToProcess.length;
    
  } catch (error) {
    console.error('Error in selectAndEndItemsOnCurrentPage:', error);
    return 0;
  }
}

// Function to end currently selected listings
async function endSelectedListings(page) {
  try {
    // Click on the "Actions" dropdown button first
    console.log('Opening Actions dropdown menu...');
    await page.click('button.fake-menu-button__button:has-text("Actions")');
    
    // Small pause to ensure the menu is fully expanded
    await page.waitForTimeout(500);
    
    // Click on the "End listings" option in the menu
    console.log('Selecting "End listings" from Actions dropdown...');
    
    // Try multiple approaches to click the "End listings" button
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
    
    // Wait for any potential dialog that might appear after clicking
    await page.waitForTimeout(2000);
    
    // Wait for potential dialog to appear
    await page.waitForLoadState('networkidle');

    console.log('Waiting for confirmation dialog to appear...');
    
    // Wait for the confirmation button to appear
    await page.waitForSelector('button.btn--primary:has-text("End listings")', { timeout: 10000 });
    console.log('Confirmation dialog detected');
    
    // Small delay to ensure the dialog is fully rendered
    await page.waitForTimeout(500);
    
    // Click the confirmation button
    console.log('Clicking the confirmation button...');
    await page.click('button.btn--primary:has-text("End listings")');
    
    console.log('Successfully confirmed ending listings');
    
    // Wait for the process to complete
    await page.waitForTimeout(3000);
    console.log('Ending listings process completed for current page');
    
  } catch (error) {
    console.error('Error in endSelectedListings function:', error);
    throw error;
  }
}

// Function to navigate to the next page
async function navigateToNextPage(page) {
  try {
    console.log('Looking for next page button...');
    
    // Check if next button exists and is not disabled
    const nextButton = await page.$('a.pagination__next[aria-label="Go to next page"]');
    
    if (!nextButton) {
      console.log('Next page button not found');
      return false;
    }
    
    // Check if the button is disabled (usually means last page)
    const isDisabled = await nextButton.getAttribute('aria-disabled');
    if (isDisabled === 'true') {
      console.log('Next page button is disabled (last page reached)');
      return false;
    }
    
    // Click the next button
    console.log('Clicking next page button...');
    await nextButton.click();
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    console.log('Successfully navigated to next page');
    return true;
    
  } catch (error) {
    console.error('Error navigating to next page:', error);
    return false;
  }
}

// Function to handle reselling ended listings
async function resellEndedListings(page, totalItemsEnded, brandName) {
  try {
    console.log('Navigating to unsold/not relisted items page...');
    await page.goto('https://www.ebay.com/sh/lst/ended?status=UNSOLD_NOT_RELISTED');
    
    // Wait for the page to load completely
    await page.waitForLoadState('networkidle');
    console.log('Unsold/not relisted items page loaded');
        
    // Wait a bit more for dynamic content to fully load
    await page.waitForTimeout(3000);
    
    // Find all listing rows
    const endedRows = await page.$$('tr.grid-row');
    console.log(`Found ${endedRows.length} ended listings.`);
    
    // Select the same number of rows as the totalItemsEnded
    const rowsToSelect = Math.min(endedRows.length, totalItemsEnded);
    console.log(`Will select the first ${rowsToSelect} ended listings.`);
    
    if (rowsToSelect === 0) {
      console.log('No ended listings found to resell.');
      return;
    }
    
    // Select the first N rows
    for (let i = 0; i < rowsToSelect; i++) {
      try {
        // Get the checkbox for this row
        const checkbox = await endedRows[i].$('input[type="checkbox"]');
        if (checkbox) {
          await checkbox.click();
          console.log(`Selected ended listing ${i+1} of ${rowsToSelect}`);
          // Small delay between clicks to avoid rate limiting
          await page.waitForTimeout(200);
        }
      } catch (error) {
        console.error(`Error selecting ended listing ${i+1}:`, error);
      }
    }
    
    console.log(`Successfully selected ${rowsToSelect} ended listings.`);
    
    // Click on the "Actions" dropdown button
    console.log('Opening Actions dropdown menu for ended listings...');
    await page.click('button.fake-menu-button__button:has-text("Actions")');
    
    // Wait for the dropdown menu to appear
    await page.waitForTimeout(500);
    
    // Click on the "Sell similar" option in the menu
    console.log('Selecting "Sell similar" from Actions dropdown...');
    try {
      await page.click('button.btn.fake-btn.actionGroupLink:has-text("Sell similar")');
    } catch (error) {
      console.log('First sell similar approach failed, trying alternatives...');
      try {
        await page.click('button:has-text("Sell similar")');
      } catch (error) {
        console.log('Second sell similar approach failed, trying more general selector...');
        try {
          await page.click('text="Sell similar"');
        } catch (error) {
          console.log('Third sell similar approach failed, trying another method...');
          await page.click('xpath=//button[contains(text(),"Sell similar")]');
        }
      }
    }
    
    // Wait for the listing form to load
    console.log('Waiting for listing form to load...');
    await page.waitForLoadState('networkidle');
    
    // Additional wait to ensure the form is fully loaded
    await page.waitForTimeout(5000);
    
    console.log('Sell similar process completed - now on listing form page');
    
    // Select all items and submit
    await selectAllAndSubmit(page);
    
  } catch (error) {
    console.error('Error in resellEndedListings function:', error);
    throw error;
  }
}

// Function to handle selecting all items and submitting
async function selectAllAndSubmit(page) {
  try {
    // First, check the "Select all items" checkbox
    console.log('Looking for "Select all items" checkbox...');
    try {
      // Wait for the checkbox to be visible
      await page.waitForSelector('.bg-checkbox input.checkbox__control[type="checkbox"][aria-label="Select all items for bulk edit."]', {
        timeout: 10000,
        state: 'visible'
      });
      
      console.log('Found "Select all items" checkbox, clicking it...');
      
      // Click the checkbox
      await page.click('.bg-checkbox input.checkbox__control[type="checkbox"][aria-label="Select all items for bulk edit."]');
      
      console.log('Successfully checked "Select all items" checkbox');
      
      // Small delay after checking the checkbox
      await page.waitForTimeout(1000);
    } catch (error) {
      console.error('Error clicking "Select all items" checkbox:', error);
      console.log('Trying alternative selector methods...');
      
      try {
        await page.click('input.checkbox__control[type="checkbox"][aria-label="Select all items for bulk edit."]');
        console.log('Clicked checkbox using more general selector');
      } catch (secondError) {
        console.error('Could not click checkbox with alternate method:', secondError);
        console.log('Trying even more general selector...');
        
        try {
          await page.click('th .checkbox input[type="checkbox"]');
          console.log('Clicked checkbox using th selector');
        } catch (thirdError) {
          console.error('Could not click any checkbox in table header:', thirdError);
          console.log('Manual intervention may be required to select all items');
        }
      }
    }
    
    // Then, wait for the Submit button and click it
    console.log('Looking for "Submit" button...');
    try {
      // Wait for the button to be visible
      await page.waitForSelector('button.bg-button.call-to-actions__submit-btn.btn.btn--small.btn--primary', {
        timeout: 10000,
        state: 'visible'
      });
      
      console.log('Found "Submit" button, clicking it...');
      
      // Click the Submit button
      await page.click('button.bg-button.call-to-actions__submit-btn.btn.btn--small.btn--primary');
      
      // Wait for the submission to complete
      console.log('Waiting for confirmation dialog to appear...');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      
      // Wait for and click the Submit button on the confirmation dialog
      await handleConfirmationDialog(page);
      
    } catch (error) {
      console.error('Error clicking "Submit" button:', error);
      console.log('Trying alternative selector methods...');
      
      try {
        await page.click('button:has-text("Submit")');
        console.log('Clicked "Submit" using text selector');
        
        // Wait for the submission to complete
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);
      } catch (secondError) {
        console.error('Could not click "Submit" button with alternate method:', secondError);
        console.log('Manual intervention may be required to submit the listing');
      }
    }
    
  } catch (error) {
    console.error('Error in selectAllAndSubmit function:', error);
    throw error;
  }
}

async function handleConfirmationDialog(page) {
    // First, verify that the dialog is present using correct selector syntax
    console.log('Waiting for confirmation dialog to appear...');
    await page.waitForSelector('.lightbox-dialog__window.lightbox-dialog__window--animate.keyboard-trap--active', {
      timeout: 15000,
      state: 'visible'
    });
    
    console.log('Confirmation dialog is visible, now finding the Submit button within it...');
    
    // Wait a moment for the dialog to fully render
    await page.waitForTimeout(1000);
    
    // Target the Submit button in the lightbox-dialog__footer with multiple approaches
    let submitButtonClicked = false;
    
    // Approach 1: Direct selector to the Submit button
    try {
      const dialogSubmitButton = await page.waitForSelector(
        '.lightbox-dialog__footer button.btn--primary', 
        { timeout: 5000, state: 'visible' }
      );
      
      if (dialogSubmitButton) {
        console.log('Found confirmation dialog Submit button (approach 1), clicking it...');
        await dialogSubmitButton.click();
        submitButtonClicked = true;
      }
    } catch (error) {
      console.log('Approach 1 failed, trying approach 2...');
    }
    
    // Approach 2: Text-based selector
    if (!submitButtonClicked) {
      try {
        await page.click('.lightbox-dialog__footer button:has-text("Submit")');
        console.log('Successfully clicked Submit button using text selector');
        submitButtonClicked = true;
      } catch (error) {
        console.log('Approach 2 failed, trying approach 3...');
      }
    }
    
    // Approach 3: CSS selector with button text
    if (!submitButtonClicked) {
      try {
        // Look for any button in the footer that contains "Submit"
        const buttons = await page.$$('.lightbox-dialog__footer button');
        for (const button of buttons) {
          const buttonText = await button.innerText();
          if (buttonText.includes('Submit')) {
            console.log('Found Submit button by text content, clicking it...');
            await button.click();
            submitButtonClicked = true;
            break;
          }
        }
      } catch (error) {
        console.log('Approach 3 failed, trying approach 4...');
      }
    }
    
    // Approach 4: JavaScript evaluation
    if (!submitButtonClicked) {
      try {
        console.log('Attempting to use JavaScript to click the dialog Submit button...');
        const clicked = await page.evaluate(() => {
          // Look for Submit button in the dialog footer
          const dialog = document.querySelector('.lightbox-dialog__window.lightbox-dialog__window--animate.keyboard-trap--active');
          if (dialog) {
            const footer = dialog.querySelector('.lightbox-dialog__footer');
            if (footer) {
              // Try primary button first
              const primaryButton = footer.querySelector('button.btn--primary');
              if (primaryButton) {
                primaryButton.click();
                return true;
              }
              
              // Fallback: look for any button with "Submit" text
              const buttons = footer.querySelectorAll('button');
              for (const button of buttons) {
                if (button.textContent.includes('Submit')) {
                  button.click();
                  return true;
                }
              }
            }
          }
          return false;
        });
        
        if (clicked) {
          console.log('JavaScript click approach succeeded');
          submitButtonClicked = true;
        }
      } catch (error) {
        console.log('JavaScript approach failed:', error);
      }
    }
    
    if (!submitButtonClicked) {
      throw new Error('Could not click Submit button with any approach');
    }
    
    // Wait for the final submission to complete
    console.log('Waiting for final submission to complete...');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    
    console.log('Successfully completed the listing submission');
}

// Helper function to apply brand filter
async function applyBrandFilter(page, brandName) {
  try {
    console.log(`Applying filter for brand: "${brandName}"`);
    
    // Wait for the search box to be visible
    await page.waitForSelector('#shui-search-box-v3__input', { timeout: 20000 });
    
    // Clear any existing search text
    await page.fill('#shui-search-box-v3__input', '');
    
    // Type the brand name in the search box
    await page.fill('#shui-search-box-v3__input', brandName);
    
    // Press Enter to apply the filter
    await page.press('#shui-search-box-v3__input', 'Enter');
    
    // Wait for the page to reload with filtered results
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    console.log(`Filter applied for brand: "${brandName}"`);
    
  } catch (error) {
    console.error(`Error applying brand filter for "${brandName}":`, error);
    throw error;
  }
}

// Helper function to process listings based on criteria
async function processListingsForCriteria(page) {
  console.log('Analyzing listings on current page...');
  
  // Wait for the table to be visible
  await page.waitForSelector('div.shui-dt', { timeout: 10000 });
  
  // Wait a bit more for dynamic content to fully load
  await page.waitForTimeout(2000);
  
  // Find all listing rows
  const listingRows = await page.$$('tr.grid-row');
  console.log(`Found ${listingRows.length} listings on current page.`);
  
  // Track items to be processed
  const itemsToProcess = [];
  
  // Process each row to find matching criteria
  for (let i = 0; i < listingRows.length; i++) {
    const row = listingRows[i];
    
    try {
      // Get the checkbox for this row
      const checkbox = await row.$('input[type="checkbox"]');
      if (!checkbox) continue;
      
      // Check views (should be 0)
      const viewsElement = await row.$('td.shui-dt-column__visitCount .column-views button');
      const viewsText = viewsElement ? await viewsElement.innerText() : '';
      const views = viewsText ? parseInt(viewsText) : -1;
      
      // Check time left (should be less than 15 days)
      const timeLeftElement = await row.$('td.shui-dt-column__timeRemaining div.shui-dt--text-column div');
      const timeLeftText = timeLeftElement ? await timeLeftElement.innerText() : '';
      let daysLeft = 100; // Default high if not found
      
      if (timeLeftText.includes('d')) {
        // Match patterns like "18d 9h 12m"
        const match = timeLeftText.match(/(\d+)d/);
        daysLeft = match ? parseInt(match[1]) : 100;
      }
      
      // Check sold quantity (should be 0)
      const soldElement = await row.$('td.shui-dt-column__soldQuantity div.shui-dt--text-column div');
      const soldText = soldElement ? await soldElement.innerText() : '0';
      const soldCount = parseInt(soldText) || 0;
      
      // Check available quantity (should be > 0)
      const availableElement = await row.$('td.shui-dt-column__availableQuantity div.shui-dt--text-column div span');
      const availableText = availableElement ? await availableElement.innerText() : '0';
      const availableQuantity = parseInt(availableText) || 0;
      
      // Debug logging for every 10th item to avoid spam
      if (i % 10 === 0) {
        console.log(`Item ${i+1} - Views: ${views}, Days left: ${daysLeft}, Sold: ${soldCount}, Available: ${availableQuantity}`);
      }
      
      // If it meets all criteria, add to our list
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

// Run the automation
ebayAutomation(50, ['DND']);