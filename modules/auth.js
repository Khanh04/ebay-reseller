const fs = require('fs');

const LOGIN_TIMEOUT_MS = 600000;

function loadEnv() {
  if (!fs.existsSync('.env')) return;
  fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k) process.env[k] = v;
  });
}

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

async function fillCredentials(page, email, password) {
  if (!email && !password) return;

  try {
    const emailInput = await page.waitForSelector('input#userid', { timeout: 10000 });
    if (email) {
      await emailInput.fill(email);
      console.log('Email filled automatically.');
    }
    await page.click('#signin-continue-btn').catch(() =>
      page.click('button[type="submit"]')
    );
  } catch {
    console.log('Could not fill email (page may differ) — fill manually.');
    return;
  }

  try {
    const passInput = await page.waitForSelector('input#pass', { timeout: 10000 });
    if (password) {
      await passInput.fill(password);
      console.log('Password filled automatically.');
    }
    await page.click('#sgnBt').catch(() =>
      page.click('button[type="submit"]')
    );
  } catch {
    console.log('Could not fill password (page may differ) — fill manually.');
  }
}

async function handleLogin(page, credentials = {}) {
  loadEnv();
  const email = credentials.email || process.env.EBAY_EMAIL;
  const password = credentials.password || process.env.EBAY_PASSWORD;

  const needsLogin = await page.$('a[href*="signin"]');

  if (!needsLogin && !isLoginUrl(page.url())) {
    console.log('Already logged in. Proceeding...');
    return;
  }

  if (needsLogin) {
    console.log('Not logged in. Opening login page...');
    await needsLogin.click();
  } else {
    console.log('Login page already open.');
  }

  await page.waitForURL(/signin|auth/i, { timeout: LOGIN_TIMEOUT_MS }).catch(() => null);

  await fillCredentials(page, email, password);

  console.log('Handle 2FA / captcha if prompted, then the script will continue automatically.');
  await waitForLoggedInState(page);
  console.log('Login detected! Proceeding...');
}

module.exports = {
  handleLogin
};
