const crypto = require('crypto');
const { APP_BASE_URL, OAUTH_PROVIDERS } = require('./config');
const { getProviderToken, setProviderToken, clearProviderToken } = require('./oauthStorage');

const PENDING_STATES_TTL_MS = 10 * 60 * 1000;
const REFRESH_GRACE_PERIOD_MS = 60 * 1000;

const pendingStates = new Map();
const refreshInFlight = new Map();

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(48));
}

function createCodeChallenge(verifier) {
  return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}

function createState() {
  return base64UrlEncode(crypto.randomBytes(24));
}

function isProviderConfigured(provider) {
  return Boolean(provider && provider.authorize_url && provider.token_url && provider.client_id);
}

function getProviderOrThrow(providerId) {
  const provider = OAUTH_PROVIDERS[providerId];
  if (!provider) {
    const e = new Error(`Unknown provider: ${providerId}`);
    e.status = 404;
    throw e;
  }
  return provider;
}

function getRedirectUri(providerId) {
  return `${APP_BASE_URL}/api/auth/${providerId}/callback`;
}

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [state, payload] of pendingStates.entries()) {
    if (now - payload.created_at > PENDING_STATES_TTL_MS) {
      pendingStates.delete(state);
    }
  }
}

function buildProviderStatus(providerId) {
  const provider = getProviderOrThrow(providerId);
  const token = getProviderToken(providerId);

  return {
    id: provider.id,
    name: provider.name,
    configured: isProviderConfigured(provider),
    connected: Boolean(token && token.access_token),
    expires_at: token && token.expires_at ? token.expires_at : null,
    has_refresh_token: Boolean(token && token.refresh_token),
  };
}

function listProviderStatuses() {
  return {
    openai: buildProviderStatus('openai'),
    anthropic: buildProviderStatus('anthropic'),
  };
}

function buildAuthorizationUrl(providerId) {
  cleanupExpiredStates();

  const provider = getProviderOrThrow(providerId);
  if (!isProviderConfigured(provider)) {
    const e = new Error(`${provider.name} OAuth is not configured in environment variables`);
    e.status = 400;
    throw e;
  }

  const state = createState();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);

  pendingStates.set(state, {
    provider_id: providerId,
    code_verifier: codeVerifier,
    created_at: Date.now(),
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: provider.client_id,
    redirect_uri: getRedirectUri(providerId),
    scope: provider.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  if (provider.audience) {
    params.set('audience', provider.audience);
  }

  return {
    provider: providerId,
    auth_url: `${provider.authorize_url}?${params.toString()}`,
  };
}

function isTokenExpiring(token) {
  if (!token || !token.expires_at) {
    return false;
  }

  const expiresAtMs = Date.parse(token.expires_at);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= Date.now() + REFRESH_GRACE_PERIOD_MS;
}

function serializeTokenResponse(tokenResponse, previousToken = null) {
  const expiresInSec = Number(tokenResponse.expires_in || 0);
  const hasExpiry = Number.isFinite(expiresInSec) && expiresInSec > 0;

  return {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || (previousToken && previousToken.refresh_token) || null,
    token_type: tokenResponse.token_type || 'Bearer',
    scope: tokenResponse.scope || null,
    expires_at: hasExpiry ? new Date(Date.now() + expiresInSec * 1000).toISOString() : null,
    obtained_at: new Date().toISOString(),
  };
}

async function requestToken(providerId, params) {
  const provider = getProviderOrThrow(providerId);

  const body = new URLSearchParams(params);
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (provider.token_auth_method === 'client_secret_basic') {
    if (!provider.client_secret) {
      throw new Error(`${provider.name} requires client secret for token exchange`);
    }
    const creds = Buffer.from(`${provider.client_id}:${provider.client_secret}`).toString('base64');
    headers.Authorization = `Basic ${creds}`;
  } else {
    body.set('client_id', provider.client_id);
    if (provider.client_secret) {
      body.set('client_secret', provider.client_secret);
    }
  }

  const response = await fetch(provider.token_url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(20000),
  });

  const responseText = await response.text();
  let json = null;
  try {
    json = JSON.parse(responseText);
  } catch (_ignored) {
    json = null;
  }

  if (!response.ok) {
    const message =
      (json && (json.error_description || json.error || json.message)) || responseText || response.status;
    throw new Error(`${provider.name} token exchange failed: ${message}`);
  }

  if (!json || !json.access_token) {
    throw new Error(`${provider.name} token exchange did not return access_token`);
  }

  return json;
}

async function handleOAuthCallback(providerId, queryParams) {
  cleanupExpiredStates();

  const provider = getProviderOrThrow(providerId);

  if (!isProviderConfigured(provider)) {
    return { ok: false, message: `${provider.name} OAuth is not configured` };
  }

  const error = queryParams.error;
  const errorDescription = queryParams.error_description;
  if (error) {
    return { ok: false, message: `${provider.name} authorization failed: ${errorDescription || error}` };
  }

  const code = queryParams.code;
  const state = queryParams.state;

  if (!code || !state) {
    return { ok: false, message: 'Missing code or state in callback' };
  }

  const pending = pendingStates.get(state);
  pendingStates.delete(state);

  if (!pending || pending.provider_id !== providerId) {
    return { ok: false, message: 'Invalid or expired OAuth state' };
  }

  try {
    const tokenResponse = await requestToken(providerId, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(providerId),
      code_verifier: pending.code_verifier,
    });

    const token = serializeTokenResponse(tokenResponse);
    setProviderToken(providerId, token);

    return { ok: true, message: `${provider.name} connected successfully` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

async function refreshProviderToken(providerId, currentToken) {
  const tokenResponse = await requestToken(providerId, {
    grant_type: 'refresh_token',
    refresh_token: currentToken.refresh_token,
  });

  const refreshed = serializeTokenResponse(tokenResponse, currentToken);
  setProviderToken(providerId, refreshed);
  return refreshed;
}

async function getProviderAccessToken(providerId) {
  const token = getProviderToken(providerId);
  if (!token || !token.access_token) {
    return null;
  }

  if (!isTokenExpiring(token)) {
    return token.access_token;
  }

  if (!token.refresh_token) {
    return token.access_token;
  }

  if (refreshInFlight.has(providerId)) {
    const pending = await refreshInFlight.get(providerId);
    return pending.access_token;
  }

  const refreshPromise = refreshProviderToken(providerId, token)
    .catch((e) => {
      console.error(`Failed refreshing ${providerId} token: ${e.message}`);
      return token;
    })
    .finally(() => {
      refreshInFlight.delete(providerId);
    });

  refreshInFlight.set(providerId, refreshPromise);

  const refreshed = await refreshPromise;
  return refreshed.access_token;
}

function disconnectProvider(providerId) {
  getProviderOrThrow(providerId);
  clearProviderToken(providerId);
}

module.exports = {
  listProviderStatuses,
  buildAuthorizationUrl,
  handleOAuthCallback,
  getProviderAccessToken,
  disconnectProvider,
};
