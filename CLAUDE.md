# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An eBay reseller automation tool: finds a seller's low-traffic active listings
(few/no views, close to renewal, unsold, in stock), ends them, and creates
replacement listings ("sell similar") from their details. It exists in two
forms that share the same core logic:

- **`main.js`** — a single-operator CLI script, credentials from a local `.env`.
- **`server.js`** — a small multi-tenant web app (Express + Postgres, JSON
  API) with a React SPA frontend (`client/`) where clients connect their own
  eBay account via OAuth and self-serve their settings from a dashboard.

Originally this drove a real Chrome window via Playwright through Seller
Hub's UI. eBay's sign-in wall detects CDP automation and blocks it even on a
brand-new browser profile, so the whole thing was rewritten against eBay's
**Trading API** (XML, not the newer REST APIs) instead — see the `git log` for
that migration and the reasoning behind each subsequent fix.

## Commands

`main.js`, `server.js`, and `modules/` are plain CommonJS Node — no build
step, no bundler there. The `client/` SPA is the one part of this repo with a
build step (Vite): its build is wired into the root `npm run build`, and
**`client/dist` must exist before `npm start` will serve anything but
`/api/*`** — a fresh checkout needs one `npm run build` before its first run.

```
npm install                 # installs everything for both entry points
npm run build                # builds the client/ SPA into client/dist (run once before first `npm start`)
node main.js                # CLI run, reads .env via modules/utils.js loadEnv()
npm start                   # same as `node server.js` — serves client/dist + the /api/* JSON API
node createTestListing.js   # seeds one fake sandbox listing (Trading API AddFixedPriceItem)
```

For SPA development with hot reload, run `node server.js` in one terminal and
`npm run dev` inside `client/` in another — `client/vite.config.js` proxies
`/api`, `/auth`, and `/ebay` to the Express server on `:3000` so the browser
sees everything as same-origin (session cookies work identically in dev and
prod; no CORS config needed).

There's no automated test suite, in `client/` or elsewhere. Verification so
far has been manual: live calls against eBay's **sandbox** environment (see
`EBAY_ENV` below), checked by hand after each change.

## Architecture

### Shared automation core (`modules/`)

Both entry points build an `ebayClient` via `createEbayClient({ token, env })`
in `modules/ebayApi.js`, then hand it to `runAutomation()` in
`modules/automation.js`:

```
runAutomation (modules/automation.js)
  └─ endLowTrafficListings (modules/listings.js) — fetch active listings, filter by matchesCriteria, end matches
  └─ resellEndedListings   (modules/reseller.js) — poll each ended item until it's really Ended, then sellSimilarItem
```

`ebayClient` is a factory, not a singleton — this matters because the web
app builds a fresh one per background run (different client, different
token), while the CLI builds exactly one from `.env` at startup.

`modules/ebayApi.js` is the only place that talks to eBay. Everything else
works with the plain-object "listing" shape it returns
(`{ itemId, title, views, daysLeft, soldCount, availableQuantity }`) — never
raw Trading API XML/JSON outside that file.

**Matching logic** (`matchesCriteria` in `modules/ebayApi.js`): views ≤
`maxViews`, `daysLeft` < `daysLeftThreshold`, `soldCount === 0`,
`availableQuantity > 0`, optional brand-name substring match. `daysLeft` comes
from the `TimeLeft` ISO-8601 duration field, **not** `ListingDetails.EndTime`
— `GTC` (Good-Til-Cancelled) listings have no fixed end time since they
auto-renew, so `TimeLeft` (time until next renewal) is what actually reflects
Seller Hub's "time left" column.

**Reselling** (`modules/reseller.js`) takes the *exact item IDs this run just
ended* and polls `GetItem` per item until its status flips to `Ended` (~15s
observed lag in practice, not the fixed multi-minute sleep this used to have).
It deliberately does not use `GetMyeBaySelling`'s `UnsoldList` to decide what
to resell — that list contains every historically-ended-unsold item forever
(including ones already resold), so slicing off "the first N" from it would
reprocess stale items instead of the ones just ended.

"Sell similar" (`sellSimilarItem`) is not the same as eBay's "Relist" — it
fetches the ended item via `GetItem` (`IncludeItemSpecifics: true` is
required or item specifics silently come back empty even at
`DetailLevel=ReturnAll`) and creates a brand-new, fully independent listing
via `AddFixedPriceItem`. Unlike Relist, it isn't bound to the 90-day relist
window and doesn't carry over the original's watchers — that's an intentional
choice made for this app, not an oversight.

### Two auth models for one Trading API client

- **CLI (`main.js`)**: `EBAY_USER_TOKEN` is a long-lived Auth'n'Auth token
  (~18 month validity) from the Developer Portal's "User Tokens" page, used
  directly as the `X-EBAY-API-IAF-TOKEN` header — no refresh flow needed.
- **Web app (`server.js` + `ebayOAuth.js`)**: real 3-legged OAuth. Each
  client's refresh token is encrypted at rest (`crypto.js`, AES-256-GCM,
  `APP_ENCRYPTION_KEY`) in Postgres; a fresh short-lived access token is
  exchanged from it (`ebayOAuth.refreshAccessToken`) at the start of every
  background run.

Don't conflate these — `EBAY_USER_TOKEN` only matters for `main.js` /
`createTestListing.js`; the web app never reads it.

### Web app request flow (`server.js` + `client/`)

The frontend is a small React SPA (`client/`, built with Vite) — no router
(only two real UI states, logged-out vs. logged-in, decided by `App.jsx`
calling `GET /api/session` on mount), no CSS framework (one global
stylesheet, `client/src/index.css`, using CSS custom properties and a
`prefers-color-scheme` dark-mode override). `server.js` serves the built
`client/dist` as static files plus a catch-all route (`app.get('{/*splat}',
...)` — Express 5's path-to-regexp needs that *named*-wildcard form; a bare
`app.get('*', ...)` throws at startup) so any page URL, including old
bookmarks like `/dashboard`, resolves to the SPA, which then figures out what
to show itself.

`/auth/ebay/start` → eBay's real OAuth consent page → `/auth/ebay/callback`
(exchanges code, calls `GetUser` to identify the account, upserts a `clients`
row) → session established → redirect to `/`. This handshake is a real
full-page redirect and always will be — it can't be done via `fetch`. On
failure it redirects to `/?authError=<message>` rather than rendering a
plain-text error page, so `Login.jsx` can show it styled.

Everything else — settings, running, run history, disconnect — is a JSON API
under `/api/*`, guarded by `requireApiAuth` (401 JSON, not a redirect, when
there's no session). `POST /api/dashboard/run` is fire-and-forget in-process
(no queue — fine at the current single-client scale; note in the code if
that stops being true) and writes its log to a `runs` row; `Dashboard.jsx`
polls `GET /api/runs` every few seconds after starting a run until the
newest run's status stops being `'running'`, so the UI updates live instead
of requiring a manual reload.

**Never `SELECT *` a `clients` row into a `res.json(...)` response** — the
real row includes `refresh_token_encrypted` (and `ebay_user_id`), which must
never reach the browser. Every `/api/*` handler that returns client data uses
the `CLIENT_FIELDS` column allowlist in `server.js`. The EJS-only era
couldn't make this mistake by accident (no template happened to read that
field); the JSON API can, so watch for it in any new endpoint.

**Env vars are validated at boot** (`REQUIRED_ENV_VARS` in `server.js`) — a
missing one fails fast with a clear log line instead of crashing deep inside
a request handler later.

**`app.set('trust proxy', 1)` is required**, not optional: Railway (and most
PaaS) terminates TLS at its edge and forwards plain HTTP internally. Without
trusting the proxy, Express sees every request as insecure, so
`express-session`'s `cookie.secure: true` silently refuses to ever set the
session cookie — no error, login just never works. If OAuth login breaks
again after a hosting change, check this first.

### eBay Marketplace Account Deletion endpoint

`GET/POST /ebay/deletion-notification` is required for production API access
(eBay terminates access without it). GET answers eBay's one-time ownership
challenge: `SHA-256(challengeCode + verificationToken + endpoint)` → hex →
`{"challengeResponse": "..."}` via `res.json()` specifically (a hand-written
string response risks a BOM that breaks eBay's JSON parser). POST is the real
notification when a connected user closes their eBay account — it deletes
their `runs` and `clients` rows. `EBAY_DELETION_ENDPOINT_URL` must exactly
match, character-for-character, what's registered in the Developer Portal —
it's a literal input to the hash, not just routing metadata.

Clients can also self-serve delete via `POST /api/dashboard/disconnect` — the
same delete, triggered manually instead of waiting on eBay's notification.

### eBay sandbox quirks worth knowing before "debugging" further

- `GetCategories` is flaky in sandbox (intermittent 503s per eBay's own
  status history) — `createTestListing.js` hardcodes a known-working
  category rather than looking one up live.
- Sandbox silently forces every `FixedPriceItem` to `GTC` regardless of the
  requested `ListingDuration` — you cannot create a short-lived test listing
  in sandbox to exercise the `daysLeftThreshold` path naturally; temporarily
  raising the threshold above ~31 is the only way to force a match there.
- `HitCount` (views) has never been observed in a `GetMyeBaySelling` response
  in sandbox testing — not zero, absent. The code assumes missing-means-zero;
  this is flagged inline in `modules/ebayApi.js` as unverified against a real
  production listing with actual view history.

### Deployment (Railway)

`DATABASE_URL` and `PORT` are auto-provided by Railway's Postgres addon and
platform respectively. Everything else in `REQUIRED_ENV_VARS` must be set
manually, separately for sandbox vs. production (separate eBay keysets,
separate RuNames, separate deletion-notification tokens — don't reuse
sandbox secrets in production `.env`/Railway vars).
