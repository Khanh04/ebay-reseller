async function waitForBulkEditPage(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => null);
  await page.waitForSelector(
    '.bg-checkbox input.checkbox__control[type="checkbox"][aria-label="Select all items for bulk edit."], button.bg-button.call-to-actions__submit-btn.btn.btn--small.btn--primary',
    { timeout: 30000 }
  );
}

async function resellEndedListings(page, totalItemsEnded, brandName) {
  try {
    const endedRows = await page.$$('tr.grid-row');
    console.log(`Found ${endedRows.length} ended listings.`);
    
    const rowsToSelect = Math.min(endedRows.length, totalItemsEnded);
    console.log(`Will select the first ${rowsToSelect} ended listings.`);
    
    if (rowsToSelect === 0) {
      console.log('No ended listings found to resell.');
      return;
    }
    
    for (let i = 0; i < rowsToSelect; i++) {
      try {
        const checkbox = await endedRows[i].$('input[type="checkbox"]');
        if (checkbox) {
          await checkbox.click();
          console.log(`Selected ended listing ${i+1} of ${rowsToSelect}`);
          await page.waitForTimeout(200);
        }
      } catch (error) {
        console.error(`Error selecting ended listing ${i+1}:`, error);
      }
    }
    
    console.log(`Successfully selected ${rowsToSelect} ended listings.`);
    
    console.log('Opening Actions dropdown menu for ended listings...');
    await page.click('button.fake-menu-button__button:has-text("Actions")');
    
    await page.waitForTimeout(500);
    
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
          await page.click('xpath=//button[contains(.,"Sell similar")]');
        }
      }
    }
    
    console.log('Waiting for listing form to load...');
    await waitForBulkEditPage(page);
    
    await page.waitForTimeout(5000);
    
    console.log('Sell similar process completed - now on listing form page');
    
    await selectAllAndSubmit(page);
    
  } catch (error) {
    console.error('Error in resellEndedListings function:', error);
    throw error;
  }
}

async function selectAllAndSubmit(page) {
  try {
    console.log('Looking for "Select all items" checkbox...');
    try {
      await page.waitForSelector('.bg-checkbox input.checkbox__control[type="checkbox"][aria-label="Select all items for bulk edit."]', {
        timeout: 10000,
        state: 'visible'
      });
      
      console.log('Found "Select all items" checkbox, clicking it...');
      
      await page.click('.bg-checkbox input.checkbox__control[type="checkbox"][aria-label="Select all items for bulk edit."]');
      
      console.log('Successfully checked "Select all items" checkbox');
      
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
    
    console.log('Looking for "Submit" button...');
    try {
      await page.waitForSelector('button.bg-button.call-to-actions__submit-btn.btn.btn--small.btn--primary', {
        timeout: 10000,
        state: 'visible'
      });
      
      console.log('Found "Submit" button, clicking it...');
      
      await page.click('button.bg-button.call-to-actions__submit-btn.btn.btn--small.btn--primary');
      
      console.log('Waiting for confirmation dialog to appear...');
      await page.waitForTimeout(2000);
      
      await handleConfirmationDialog(page);
      
    } catch (error) {
      console.error('Error clicking "Submit" button:', error);
      console.log('Trying alternative selector methods...');
      
      try {
        await page.click('button:has-text("Submit")');
        console.log('Clicked "Submit" using text selector');
        
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
    console.log('Waiting for confirmation dialog to appear...');
    await page.waitForSelector('.lightbox-dialog__window.lightbox-dialog__window--animate.keyboard-trap--active', {
      timeout: 15000,
      state: 'visible'
    });
    
    console.log('Confirmation dialog is visible, now finding the Submit button within it...');
    
    await page.waitForTimeout(1000);
    
    let submitButtonClicked = false;
    
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
    
    if (!submitButtonClicked) {
      try {
        await page.click('.lightbox-dialog__footer button:has-text("Submit")');
        console.log('Successfully clicked Submit button using text selector');
        submitButtonClicked = true;
      } catch (error) {
        console.log('Approach 2 failed, trying approach 3...');
      }
    }
    
    if (!submitButtonClicked) {
      try {
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
    
    if (!submitButtonClicked) {
      try {
        console.log('Attempting to use JavaScript to click the dialog Submit button...');
        const clicked = await page.evaluate(() => {
          const dialog = document.querySelector('.lightbox-dialog__window.lightbox-dialog__window--animate.keyboard-trap--active');
          if (dialog) {
            const footer = dialog.querySelector('.lightbox-dialog__footer');
            if (footer) {
              const primaryButton = footer.querySelector('button.btn--primary');
              if (primaryButton) {
                primaryButton.click();
                return true;
              }
              
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
    
    console.log('Waiting for final submission to complete...');
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await page.waitForTimeout(5000);
    
    console.log('Successfully completed the listing submission');
}

module.exports = {
  resellEndedListings,
  selectAllAndSubmit,
  handleConfirmationDialog
};