const LOGIN_TIMEOUT_MS = 600000;

function isLoginUrl(url) {
  return /signin|auth/i.test(url);
}

async function waitForLoggedInState(page) {
  await page.waitForFunction(() => {
    const onLoginPage = /signin|auth/i.test(window.location.href);
    const hasSignInLink = Boolean(document.querySelector('a[href*="signin"]'));
    const hasLoggedInUi = Boolean(
      document.querySelector('.gh-identity, .gh-account, .account-info, a[title*="My eBay"], button[aria-controls*="account"]')
    );

    return !onLoginPage && (hasLoggedInUi || !hasSignInLink);
  }, null, { timeout: LOGIN_TIMEOUT_MS });
}

async function handleLogin(page) {
  const needsLogin = await page.$('a[href*="signin"]');

  if (!needsLogin && !isLoginUrl(page.url())) {
    console.log('Already logged in. Proceeding...');
    return;
  }

  if (needsLogin) {
    console.log('Not logged in. Opening login page...');
    await needsLogin.click();
  } else {
    console.log('Login page already open. Waiting for manual sign-in...');
  }

  console.log('Please log in manually. The script will wait until login is complete.');

  if (!isLoginUrl(page.url())) {
    await page.waitForURL(/signin|auth/i, { timeout: LOGIN_TIMEOUT_MS }).catch(() => null);
  }

  await waitForLoggedInState(page);

  console.log('Login detected! Proceeding...');
}

module.exports = {
  handleLogin
};