async function handleLogin(page) {
  const needsLogin = await page.$('a[href*="signin"]');
  
  if (needsLogin) {
    console.log('Not logged in. Opening login page...');
    await needsLogin.click();
    
    console.log('Please log in manually. The script will wait until login is complete.');
    
    await Promise.race([
      page.waitForNavigation({ timeout: 300000 }),
      page.waitForSelector('.gh-identity, .gh-account, .account-info', { timeout: 300000 })
    ]);
    
    console.log('Login detected! Proceeding...');
  } else {
    console.log('Already logged in. Proceeding...');
  }
}

module.exports = {
  handleLogin
};