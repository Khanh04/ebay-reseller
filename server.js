require('./modules/utils').loadEnv();

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const { pool, migrate } = require('./db');
const { encrypt, decrypt } = require('./crypto');
const ebayOAuth = require('./ebayOAuth');
const { createEbayClient } = require('./modules/ebayApi');
const { runAutomation } = require('./modules/automation');

const REQUIRED_ENV_VARS = [
  'DATABASE_URL', 'SESSION_SECRET', 'APP_ENCRYPTION_KEY',
  'EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_RUNAME',
  'EBAY_DELETION_VERIFICATION_TOKEN', 'EBAY_DELETION_ENDPOINT_URL'
];
const missingEnvVars = REQUIRED_ENV_VARS.filter(name => !process.env[name]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variable(s): ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: ebayOAuth.ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.clientId) return res.redirect('/login');
  next();
}

app.get('/login', (req, res) => res.render('login'));
app.get('/privacy', (req, res) => res.render('privacy'));

// eBay's GDPR/CCPA-required "Marketplace Account Deletion/Closure" notification
// endpoint. GET is eBay's one-time handshake verifying you control this URL;
// POST is the actual notification eBay sends when a connected user deletes their
// eBay account, so their stored data (refresh token, settings, run history) can
// be purged. EBAY_DELETION_ENDPOINT_URL must exactly match what's registered in
// the Developer Portal's Alerts & Notifications page, and
// EBAY_DELETION_VERIFICATION_TOKEN must match the token entered there too.
app.get('/ebay/deletion-notification', (req, res) => {
  const challengeCode = req.query.challenge_code;
  const hash = crypto.createHash('sha256');
  hash.update(challengeCode);
  hash.update(process.env.EBAY_DELETION_VERIFICATION_TOKEN);
  hash.update(process.env.EBAY_DELETION_ENDPOINT_URL);
  res.json({ challengeResponse: hash.digest('hex') });
});

app.post('/ebay/deletion-notification', async (req, res) => {
  // ponytail: doesn't verify the X-EBAY-SIGNATURE header (requires fetching
  // eBay's public key by kid and doing ECDSA verification) — the challenge_code
  // handshake above is what production approval actually checks. Add signature
  // verification if this ever needs to be hardened against spoofed requests.
  const ebayUsername = req.body?.notification?.data?.username;

  if (ebayUsername) {
    try {
      const { rows: [client] } = await pool.query('SELECT id FROM clients WHERE ebay_user_id = $1', [ebayUsername]);
      if (client) {
        await pool.query('DELETE FROM runs WHERE client_id = $1', [client.id]);
        await pool.query('DELETE FROM clients WHERE id = $1', [client.id]);
        console.log(`Deleted all data for ${ebayUsername} per eBay account deletion notification.`);
      }
    } catch (error) {
      console.error('Failed to process deletion notification:', error.message);
    }
  }

  res.sendStatus(200);
});

app.get('/auth/ebay/start', (req, res) => {
  req.session.oauthState = crypto.randomBytes(16).toString('hex');
  res.redirect(ebayOAuth.authorizeUrl(req.session.oauthState));
});

app.get('/auth/ebay/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!state || state !== req.session.oauthState) {
    return res.status(400).send('Invalid OAuth state — please try signing in again.');
  }

  try {
    const { accessToken, refreshToken } = await ebayOAuth.exchangeCodeForToken(code);

    const ebayClient = createEbayClient({ token: accessToken, env: ebayOAuth.ENV });
    const userInfo = await ebayClient.callTradingApi('GetUser', `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents"></GetUserRequest>`);
    const ebayUserId = userInfo.User.UserID;

    const { rows } = await pool.query(
      `INSERT INTO clients (ebay_user_id, ebay_username, refresh_token_encrypted)
       VALUES ($1, $1, $2)
       ON CONFLICT (ebay_user_id) DO UPDATE SET refresh_token_encrypted = EXCLUDED.refresh_token_encrypted
       RETURNING id`,
      [ebayUserId, encrypt(refreshToken)]
    );

    req.session.clientId = rows[0].id;
    res.redirect('/dashboard');
  } catch (error) {
    console.error('OAuth callback failed:', error.message);
    res.status(500).send('Failed to connect your eBay account. Please try again.');
  }
});

app.get('/dashboard', requireAuth, async (req, res) => {
  const { rows: [client] } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.session.clientId]);
  const { rows: runs } = await pool.query(
    'SELECT * FROM runs WHERE client_id = $1 ORDER BY started_at DESC LIMIT 10',
    [req.session.clientId]
  );
  res.render('dashboard', { client, runs });
});

app.post('/dashboard/settings', requireAuth, async (req, res) => {
  const itemLimit = Math.max(1, parseInt(req.body.item_limit, 10) || 10);
  const maxViews = Math.max(0, parseInt(req.body.max_views, 10) || 0);
  const daysLeftThreshold = Math.max(1, parseInt(req.body.days_left_threshold, 10) || 15);
  const keywords = (req.body.keywords || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  await pool.query(
    'UPDATE clients SET item_limit = $1, keywords = $2, max_views = $3, days_left_threshold = $4 WHERE id = $5',
    [itemLimit, JSON.stringify(keywords), maxViews, daysLeftThreshold, req.session.clientId]
  );
  res.redirect('/dashboard');
});

app.post('/dashboard/run', requireAuth, async (req, res) => {
  const { rows: [client] } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.session.clientId]);
  const { rows: [run] } = await pool.query(
    "INSERT INTO runs (client_id, status) VALUES ($1, 'running') RETURNING id",
    [client.id]
  );

  // ponytail: fire-and-forget in-process background job — fine for one client's
  // occasional, non-concurrent runs. Add a real queue (BullMQ/etc.) if multiple
  // clients start running this at once.
  runInBackground(run.id, client).catch(error => console.error('Background run crashed:', error));

  res.redirect('/dashboard');
});

async function runInBackground(runId, client) {
  const logLines = [];
  const log = (line) => {
    console.log(`[run ${runId}] ${line}`);
    logLines.push(line);
  };

  try {
    const refreshToken = decrypt(client.refresh_token_encrypted);
    const accessToken = await ebayOAuth.refreshAccessToken(refreshToken);
    const ebayClient = createEbayClient({ token: accessToken, env: ebayOAuth.ENV });

    await runAutomation(ebayClient, {
      itemLimit: client.item_limit,
      keywords: client.keywords,
      maxViews: client.max_views,
      daysLeftThreshold: client.days_left_threshold
    }, log);

    await pool.query(
      "UPDATE runs SET status = 'success', log = $1, finished_at = now() WHERE id = $2",
      [logLines.join('\n'), runId]
    );
  } catch (error) {
    log(`Run failed: ${error.message}`);
    await pool.query(
      "UPDATE runs SET status = 'failed', log = $1, finished_at = now() WHERE id = $2",
      [logLines.join('\n'), runId]
    );
  }
}

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', (req, res) => res.redirect(req.session.clientId ? '/dashboard' : '/login'));

const PORT = process.env.PORT || 3000;

migrate()
  .then(() => app.listen(PORT, () => console.log(`Listening on port ${PORT}`)))
  .catch(error => {
    console.error('Failed to run DB migrations:', error);
    process.exit(1);
  });
