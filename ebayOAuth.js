const ENV = process.env.EBAY_ENV === 'production' ? 'production' : 'sandbox';
const AUTH_HOST = ENV === 'production' ? 'auth.ebay.com' : 'auth.sandbox.ebay.com';
const API_HOST = ENV === 'production' ? 'api.ebay.com' : 'api.sandbox.ebay.com';
const SCOPE = 'https://api.ebay.com/oauth/api_scope'; // base scope covers Trading API calls

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
}

function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.EBAY_CLIENT_ID,
    redirect_uri: process.env.EBAY_RUNAME,
    response_type: 'code',
    scope: SCOPE,
    state
  });
  return `https://${AUTH_HOST}/oauth2/authorize?${params}`;
}

async function exchangeCodeForToken(code) {
  const res = await fetch(`https://${API_HOST}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader()
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.EBAY_RUNAME
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${data.error_description || data.error || res.status}`);

  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(`https://${API_HOST}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader()
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPE
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Access token refresh failed: ${data.error_description || data.error || res.status}`);

  return data.access_token;
}

module.exports = { ENV, authorizeUrl, exchangeCodeForToken, refreshAccessToken };
