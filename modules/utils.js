const readline = require('readline');

async function promptUser(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(message, () => { rl.close(); resolve(); }));
}

async function waitForDelay(milliseconds, message = '') {
  if (message) {
    console.log(message);
  }
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function initializeBrowser(chromium, headless = false) {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('https://www.ebay.com/');
  
  return { browser, context, page };
}

function logBrandProcessingStart(brandIndex, totalBrands, brandName) {
  console.log(`\n========================================`);
  console.log(`Processing brand ${brandIndex + 1} of ${totalBrands}: "${brandName}"`);
  console.log(`========================================`);
}

function logBrandProcessingComplete(brandName) {
  console.log(`Completed processing for brand: "${brandName}"`);
}

function logAllBrandsComplete() {
  console.log('\n========================================');
  console.log('All brands processed successfully!');
  console.log('========================================');
}

function logStepStart(stepNumber, description) {
  console.log(`\n--- Step ${stepNumber}: ${description} ---`);
}

function logAutomationComplete() {
  console.log('Automation complete. Browser will remain open for you to review.');
  console.log('Press Ctrl+C in your terminal to exit when finished.');
}

module.exports = {
  waitForDelay,
  promptUser,
  initializeBrowser,
  logBrandProcessingStart,
  logBrandProcessingComplete,
  logAllBrandsComplete,
  logStepStart,
  logAutomationComplete
};