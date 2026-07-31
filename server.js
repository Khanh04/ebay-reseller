require('./modules/utils').loadEnv();

const crypto = require('crypto');
const path = require('path');
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
// Railway terminates TLS at its edge and forwards plain HTTP internally — without
// this, Express sees every request as insecure, so express-session's `secure: true`
// cookie silently never gets set (no error, just no session, ever).
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: ebayOAuth.ENV === 'production', maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

function requireApiAuth(req, res, next) {
  if (!req.session.clientId) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

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
    return res.redirect('/?authError=' + encodeURIComponent('Invalid OAuth state — please try signing in again.'));
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
    res.redirect('/');
  } catch (error) {
    console.error('OAuth callback failed:', error.message);
    res.redirect('/?authError=' + encodeURIComponent('Failed to connect your eBay account. Please try again.'));
  }
});

// Column allowlist for any `clients` row that goes into a JSON response —
// the real row also has `refresh_token_encrypted` and `ebay_user_id`, which
// must never reach the browser.
const CLIENT_FIELDS = 'ebay_username, item_limit, keywords, max_views, days_left_threshold, max_sold_count, schedule_hours, next_run_at';

async function isClientRunning(clientId) {
  const { rows: [existing] } = await pool.query(
    "SELECT 1 FROM runs WHERE client_id = $1 AND status = 'running'",
    [clientId]
  );
  return Boolean(existing);
}

app.get('/api/session', (req, res) => {
  res.json({ authenticated: Boolean(req.session.clientId) });
});

app.get('/api/dashboard', requireApiAuth, async (req, res) => {
  const { rows: [client] } = await pool.query(`SELECT ${CLIENT_FIELDS} FROM clients WHERE id = $1`, [req.session.clientId]);
  const { rows: runs } = await pool.query(
    'SELECT id, status, started_at, finished_at, log, result FROM runs WHERE client_id = $1 ORDER BY started_at DESC LIMIT 10',
    [req.session.clientId]
  );
  res.json({ client: { ...client, ebay_env: ebayOAuth.ENV }, runs });
});

app.get('/api/runs', requireApiAuth, async (req, res) => {
  const { rows: runs } = await pool.query(
    'SELECT id, status, started_at, finished_at, log, result FROM runs WHERE client_id = $1 ORDER BY started_at DESC LIMIT 10',
    [req.session.clientId]
  );
  res.json({ runs });
});

app.post('/api/dashboard/settings', requireApiAuth, async (req, res) => {
  const itemLimit = Math.max(1, parseInt(req.body.item_limit, 10) || 10);
  const maxViews = Math.max(0, parseInt(req.body.max_views, 10) || 0);
  const daysLeftThreshold = Math.max(1, parseInt(req.body.days_left_threshold, 10) || 15);
  const maxSoldCount = Math.max(0, parseInt(req.body.max_sold_count, 10) || 0);
  const scheduleHours = Math.max(0, parseInt(req.body.schedule_hours, 10) || 0);
  const keywords = (req.body.keywords || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  // Saving always recomputes next_run_at from now, even if schedule_hours
  // didn't change — simplest correct behavior for a "simple interval"
  // schedule, at the minor cost of resetting the countdown on every save.
  const { rows: [client] } = await pool.query(
    `UPDATE clients SET item_limit = $1, keywords = $2, max_views = $3, days_left_threshold = $4, max_sold_count = $5, schedule_hours = $6,
       next_run_at = CASE WHEN $6 > 0 THEN now() + ($6 || ' hours')::interval ELSE NULL END
     WHERE id = $7 RETURNING ${CLIENT_FIELDS}`,
    [itemLimit, JSON.stringify(keywords), maxViews, daysLeftThreshold, maxSoldCount, scheduleHours, req.session.clientId]
  );
  res.json({ client });
});

app.post('/api/dashboard/preview', requireApiAuth, async (req, res) => {
  const { rows: [client] } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.session.clientId]);
  try {
    const refreshToken = decrypt(client.refresh_token_encrypted);
    const accessToken = await ebayOAuth.refreshAccessToken(refreshToken);
    const ebayClient = createEbayClient({ token: accessToken, env: ebayOAuth.ENV });

    const logLines = [];
    const result = await runAutomation(ebayClient, {
      itemLimit: client.item_limit,
      keywords: client.keywords,
      maxViews: client.max_views,
      daysLeftThreshold: client.days_left_threshold,
      maxSoldCount: client.max_sold_count
    }, (line) => logLines.push(line), { dryRun: true });

    res.json({ ended: result.ended, log: logLines.join('\n') });
  } catch (error) {
    console.error('Preview failed:', error.message);
    res.status(500).json({ error: 'preview_failed' });
  }
});

app.post('/api/dashboard/run', requireApiAuth, async (req, res) => {
  if (await isClientRunning(req.session.clientId)) {
    return res.status(409).json({ error: 'already_running' });
  }

  const { rows: [client] } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.session.clientId]);
  const { rows: [run] } = await pool.query(
    "INSERT INTO runs (client_id, status) VALUES ($1, 'running') RETURNING id, status, started_at",
    [client.id]
  );

  // ponytail: fire-and-forget in-process background job — fine for one client's
  // occasional, non-concurrent runs. Add a real queue (BullMQ/etc.) if multiple
  // clients start running this at once.
  runInBackground(run.id, client).catch(error => console.error('Background run crashed:', error));

  res.json({ runId: run.id, status: run.status, started_at: run.started_at });
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

    const result = await runAutomation(ebayClient, {
      itemLimit: client.item_limit,
      keywords: client.keywords,
      maxViews: client.max_views,
      daysLeftThreshold: client.days_left_threshold,
      maxSoldCount: client.max_sold_count
    }, log);

    await pool.query(
      "UPDATE runs SET status = 'success', log = $1, result = $2, finished_at = now() WHERE id = $3",
      [logLines.join('\n'), JSON.stringify(result), runId]
    );
  } catch (error) {
    log(`Run failed: ${error.message}`);
    await pool.query(
      "UPDATE runs SET status = 'failed', log = $1, finished_at = now() WHERE id = $2",
      [logLines.join('\n'), runId]
    );
  }
}

// "Simple interval" scheduling: next_run_at is just "now + schedule_hours,"
// recomputed each time a scheduled run fires (or settings are saved) — no
// time-of-day/timezone logic.
async function checkScheduledRuns() {
  const { rows: dueClients } = await pool.query(
    'SELECT * FROM clients WHERE schedule_hours > 0 AND next_run_at <= now()'
  );

  for (const client of dueClients) {
    if (await isClientRunning(client.id)) {
      console.log(`Scheduled run for client ${client.id} skipped — already running.`);
    } else {
      const { rows: [run] } = await pool.query(
        "INSERT INTO runs (client_id, status) VALUES ($1, 'running') RETURNING id",
        [client.id]
      );
      runInBackground(run.id, client).catch(error => console.error('Scheduled run crashed:', error));
    }

    await pool.query(
      "UPDATE clients SET next_run_at = now() + ($1 || ' hours')::interval WHERE id = $2",
      [client.schedule_hours, client.id]
    );
  }
}

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/dashboard/disconnect', requireApiAuth, async (req, res) => {
  const clientId = req.session.clientId;
  await pool.query('DELETE FROM runs WHERE client_id = $1', [clientId]);
  await pool.query('DELETE FROM clients WHERE id = $1', [clientId]);
  req.session.destroy(() => res.json({ ok: true }));
});

// Any other /api/* request is a typo'd/removed endpoint — 404 it explicitly
// instead of letting it fall through to the SPA catch-all below with a 200.
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

app.use(express.static(path.join(__dirname, 'client/dist')));
// Must be the last route: serves the SPA for any real page URL (including
// old bookmarks like `/dashboard`), which then calls /api/session to decide
// what to show. Express 5's path-to-regexp needs a *named* wildcard here —
// a bare `app.get('*', ...)` throws at startup, and `/*splat` alone won't
// match the bare root `/`.
app.get('{/*splat}', (req, res) => res.sendFile(path.join(__dirname, 'client/dist/index.html')));

const PORT = process.env.PORT || 3000;

const SCHEDULE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
    checkScheduledRuns().catch(error => console.error('Scheduler tick failed:', error));
    setInterval(() => checkScheduledRuns().catch(error => console.error('Scheduler tick failed:', error)), SCHEDULE_CHECK_INTERVAL_MS);
  })
  .catch(error => {
    console.error('Failed to run DB migrations:', error);
    process.exit(1);
  });
