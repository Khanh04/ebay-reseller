async function applyBrandFilter(page, brandName) {
  try {
    console.log(`Applying filter for brand: "${brandName}"`);
    
    await page.waitForSelector('#shui-search-box__input', { timeout: 20000 });
    
    await page.fill('#shui-search-box__input', '');
    
    await page.fill('#shui-search-box__input', brandName);
    
    await page.press('#shui-search-box__input', 'Enter');

    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await page.waitForSelector('#shui-search-box__input, div.shui-dt, tr.grid-row', { timeout: 30000 });
    await page.waitForTimeout(2000);
    
    console.log(`Filter applied for brand: "${brandName}"`);
    
  } catch (error) {
    console.error(`Error applying brand filter for "${brandName}":`, error);
    throw error;
  }
}

module.exports = {
  applyBrandFilter
};