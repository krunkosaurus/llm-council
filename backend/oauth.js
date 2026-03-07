const crypto = require('crypto');
const http = require('http');
const {
  APP_BASE_URL,
  OPENAI_OAUTH_ISSUER,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_SCOPE,
  ANTHROPIC_OAUTH_CLIENT_ID,
  ANTHROPIC_OAUTH_SCOPE,
  ANTHROPIC_OAUTH_AUTHORIZE_URL_MAX,
  ANTHROPIC_OAUTH_TOKEN_URL,
  ANTHROPIC_OAUTH_REDIRECT_URI,
} = require('./config');
const { getProviderToken, setProviderToken, clearProviderToken } = require('./oauthStorage');
const { getSelectedProviderModel, getAvailableProviderModels } = require('./providerSettings');

const PENDING_STATES_TTL_MS = 10 * 60 * 1000;
const REFRESH_GRACE_PERIOD_MS = 60 * 1000;

const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    mode: 'redirect',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    mode: 'code',
  },
};

const pendingOpenAIStates = new Map();
const pendingAnthropicFlows = new Map();
const refreshInFlight = new Map();
const OPENAI_OAUTH_LOCAL_CALLBACK_PORT = Number(
  process.env.OPENAI_OAUTH_LOCAL_CALLBACK_PORT || '1455'
);
const OPENAI_OAUTH_LOCAL_REDIRECT_URI = `http://localhost:${OPENAI_OAUTH_LOCAL_CALLBACK_PORT}/auth/callback`;
let openAICallbackServer = null;
let openAICallbackServerReady = null;

function renderOAuthCallbackPage(ok, message) {
  const escapedMessage = String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const title = ok ? 'OAuth Success' : 'OAuth Failed';
  const statusColor = ok ? '#1f8f45' : '#b42318';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 2rem; color: #1f2937; }
      h1 { margin-top: 0; color: ${statusColor}; }
      p { line-height: 1.5; }
      .hint { margin-top: 1rem; color: #6b7280; font-size: 0.95rem; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${escapedMessage}</p>
    <p class="hint">You can close this window and return to LLM Council.</p>
    <script>setTimeout(() => window.close(), 1200);</script>
  </body>
</html>`;
}

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

function getProviderOrThrow(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    const e = new Error(`Unknown provider: ${providerId}`);
    e.status = 404;
    throw e;
  }
  return provider;
}

function cleanupExpiredPending() {
  const now = Date.now();

  for (const [state, payload] of pendingOpenAIStates.entries()) {
    if (now - payload.created_at > PENDING_STATES_TTL_MS) {
      pendingOpenAIStates.delete(state);
    }
  }

  for (const [flowId, payload] of pendingAnthropicFlows.entries()) {
    if (now - payload.created_at > PENDING_STATES_TTL_MS) {
      pendingAnthropicFlows.delete(flowId);
    }
  }
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

function serializeTokenResponse(tokenResponse, previousToken = null, extra = {}) {
  const expiresInSec = Number(tokenResponse.expires_in || 0);
  const hasExpiry = Number.isFinite(expiresInSec) && expiresInSec > 0;

  return {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || (previousToken && previousToken.refresh_token) || null,
    token_type: tokenResponse.token_type || 'Bearer',
    scope: tokenResponse.scope || null,
    expires_at: hasExpiry ? new Date(Date.now() + expiresInSec * 1000).toISOString() : null,
    obtained_at: new Date().toISOString(),
    ...extra,
  };
}

function parseJwtClaims(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch (_ignored) {
    return null;
  }
}

function extractOpenAIAccountIdFromClaims(claims) {
  if (!claims || typeof claims !== 'object') {
    return null;
  }

  if (claims.chatgpt_account_id) {
    return claims.chatgpt_account_id;
  }

  if (
    claims['https://api.openai.com/auth'] &&
    claims['https://api.openai.com/auth'].chatgpt_account_id
  ) {
    return claims['https://api.openai.com/auth'].chatgpt_account_id;
  }

  if (
    Array.isArray(claims.organizations) &&
    claims.organizations[0] &&
    claims.organizations[0].id
  ) {
    return claims.organizations[0].id;
  }

  return null;
}

function extractOpenAIAccountId(tokenResponse, previousToken = null) {
  const idTokenClaims = parseJwtClaims(tokenResponse.id_token);
  const fromIdToken = extractOpenAIAccountIdFromClaims(idTokenClaims);
  if (fromIdToken) {
    return fromIdToken;
  }

  const accessClaims = parseJwtClaims(tokenResponse.access_token);
  const fromAccessToken = extractOpenAIAccountIdFromClaims(accessClaims);
  if (fromAccessToken) {
    return fromAccessToken;
  }

  return (previousToken && previousToken.account_id) || null;
}

function parseErrorMessage(json, fallback) {
  if (json && typeof json === 'object') {
    if (json.error_description) return json.error_description;
    if (json.error && typeof json.error === 'string') return json.error;
    if (json.error && typeof json.error === 'object' && json.error.message) return json.error.message;
    if (json.message) return json.message;
  }
  return fallback;
}

async function postOpenAIFormToken(form) {
  const response = await fetch(`${OPENAI_OAUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20000),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_ignored) {
    json = null;
  }

  if (!response.ok || !json || !json.access_token) {
    const message = parseErrorMessage(json, text || `HTTP ${response.status}`);
    throw new Error(`OpenAI OAuth token exchange failed: ${message}`);
  }

  return json;
}

async function postAnthropicToken(body) {
  const response = await fetch(ANTHROPIC_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_ignored) {
    json = null;
  }

  if (!response.ok || !json || !json.access_token) {
    const message = parseErrorMessage(json, text || `HTTP ${response.status}`);
    throw new Error(`Anthropic OAuth token exchange failed: ${message}`);
  }

  return json;
}

async function ensureOpenAICallbackServer() {
  if (openAICallbackServer && openAICallbackServer.listening) {
    return;
  }

  if (openAICallbackServerReady) {
    return openAICallbackServerReady;
  }

  openAICallbackServerReady = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url, `http://localhost:${OPENAI_OAUTH_LOCAL_CALLBACK_PORT}`);

      if (requestUrl.pathname !== '/auth/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const error = requestUrl.searchParams.get('error');
      const errorDescription = requestUrl.searchParams.get('error_description');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthCallbackPage(false, errorDescription || error));
        return;
      }

      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');
      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthCallbackPage(false, 'Missing code or state in callback'));
        return;
      }

      const pending = pendingOpenAIStates.get(state);
      pendingOpenAIStates.delete(state);
      if (!pending) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthCallbackPage(false, 'Invalid or expired OAuth state'));
        return;
      }

      try {
        const tokenResponse = await postOpenAIFormToken({
          grant_type: 'authorization_code',
          code,
          redirect_uri: OPENAI_OAUTH_LOCAL_REDIRECT_URI,
          client_id: OPENAI_OAUTH_CLIENT_ID,
          code_verifier: pending.code_verifier,
        });

        const token = serializeTokenResponse(tokenResponse, null, {
          account_id: extractOpenAIAccountId(tokenResponse),
        });
        setProviderToken('openai', token);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthCallbackPage(true, 'ChatGPT connected successfully'));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderOAuthCallbackPage(false, e.message));
      }
    });

    server.on('error', (err) => {
      openAICallbackServerReady = null;
      if (openAICallbackServer === server) {
        openAICallbackServer = null;
      }
      reject(err);
    });

    server.listen(OPENAI_OAUTH_LOCAL_CALLBACK_PORT, '127.0.0.1', () => {
      openAICallbackServer = server;
      openAICallbackServerReady = null;
      resolve();
    });
  });

  return openAICallbackServerReady;
}

function parseAnthropicAuthorizationCode(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return { code: null, state: null };
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const url = new URL(raw);
      let code = url.searchParams.get('code');
      let state = url.searchParams.get('state');

      if (!code && url.hash) {
        const hash = url.hash.slice(1);
        if (hash.includes('=')) {
          const params = new URLSearchParams(hash);
          code = code || params.get('code');
          state = state || params.get('state');
        } else {
          code = hash;
        }
      }

      if (code && code.includes('#')) {
        const [codePart, statePart] = code.split('#');
        return { code: codePart, state: statePart || state || null };
      }

      return {
        code: code || null,
        state: state || null,
      };
    } catch (_ignored) {
      return { code: raw, state: null };
    }
  }

  if (raw.includes('#')) {
    const [code, state] = raw.split('#');
    return { code: code || null, state: state || null };
  }

  return { code: raw, state: null };
}

function buildProviderStatus(providerId) {
  const provider = getProviderOrThrow(providerId);
  const token = getProviderToken(providerId);
  const selectedModel = getSelectedProviderModel(providerId);

  return {
    id: provider.id,
    name: provider.name,
    configured: true,
    connected: Boolean(token && token.access_token),
    expires_at: token && token.expires_at ? token.expires_at : null,
    has_refresh_token: Boolean(token && token.refresh_token),
    connect_method: provider.mode,
    selected_model: selectedModel,
    available_models: getAvailableProviderModels(providerId),
  };
}

function listProviderStatuses() {
  return {
    openai: buildProviderStatus('openai'),
    anthropic: buildProviderStatus('anthropic'),
  };
}

async function buildOpenAIAuthorizationUrl() {
  try {
    await ensureOpenAICallbackServer();
  } catch (e) {
    const msg =
      e && e.code === 'EADDRINUSE'
        ? `Port ${OPENAI_OAUTH_LOCAL_CALLBACK_PORT} is already in use; close the conflicting app and retry ChatGPT connect`
        : `Unable to start local OAuth callback server: ${e.message}`;
    const err = new Error(msg);
    err.status = 500;
    throw err;
  }

  const state = createState();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);

  pendingOpenAIStates.set(state, {
    code_verifier: codeVerifier,
    created_at: Date.now(),
  });

  const redirectUri = OPENAI_OAUTH_LOCAL_REDIRECT_URI;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: OPENAI_OAUTH_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'opencode',
  });

  return {
    provider: 'openai',
    method: 'redirect',
    auth_url: `${OPENAI_OAUTH_ISSUER}/oauth/authorize?${params.toString()}`,
  };
}

function buildAnthropicAuthorizationUrl() {
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const state = codeVerifier;
  const flowId = createState();

  pendingAnthropicFlows.set(flowId, {
    code_verifier: codeVerifier,
    state,
    created_at: Date.now(),
  });

  const params = new URLSearchParams({
    code: 'true',
    client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
    scope: ANTHROPIC_OAUTH_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  return {
    provider: 'anthropic',
    method: 'code',
    auth_url: `${ANTHROPIC_OAUTH_AUTHORIZE_URL_MAX}?${params.toString()}`,
    flow_id: flowId,
    instructions:
      'After approval, copy the authorization code from the callback page (usually code#state) and paste it back in LLM Council.',
  };
}

async function buildAuthorizationUrl(providerId) {
  cleanupExpiredPending();
  getProviderOrThrow(providerId);

  if (providerId === 'openai') {
    return buildOpenAIAuthorizationUrl();
  }

  if (providerId === 'anthropic') {
    return buildAnthropicAuthorizationUrl();
  }

  const e = new Error(`Unsupported provider: ${providerId}`);
  e.status = 400;
  throw e;
}

async function handleOAuthCallback(providerId, queryParams) {
  cleanupExpiredPending();
  const provider = getProviderOrThrow(providerId);

  if (providerId === 'openai') {
    return {
      ok: false,
      message: `ChatGPT OAuth callback is handled on ${OPENAI_OAUTH_LOCAL_REDIRECT_URI}. Please complete login from the popup window.`,
    };
  }

  if (providerId === 'anthropic') {
    return {
      ok: false,
      message: 'Claude OAuth uses a code-paste flow. Please return to LLM Council and paste the code there.',
    };
  }

  return { ok: false, message: `${provider.name} OAuth callback is unsupported` };
}

async function completeOAuthCode(providerId, body) {
  cleanupExpiredPending();
  const provider = getProviderOrThrow(providerId);

  if (providerId !== 'anthropic') {
    return {
      ok: false,
      message: `${provider.name} does not use code completion endpoint`,
    };
  }

  const flowId = body && body.flow_id;
  const codeInput = body && body.code;

  if (!flowId || !codeInput) {
    return { ok: false, message: 'Missing flow_id or code' };
  }

  const flow = pendingAnthropicFlows.get(flowId);
  pendingAnthropicFlows.delete(flowId);

  if (!flow) {
    return { ok: false, message: 'Invalid or expired Anthropic OAuth flow' };
  }

  const parsed = parseAnthropicAuthorizationCode(codeInput);
  if (!parsed.code) {
    return { ok: false, message: 'Authorization code could not be parsed' };
  }

  try {
    const tokenResponse = await postAnthropicToken({
      code: parsed.code,
      state: parsed.state || flow.state,
      grant_type: 'authorization_code',
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
      code_verifier: flow.code_verifier,
    });

    const token = serializeTokenResponse(tokenResponse);
    setProviderToken('anthropic', token);

    return { ok: true, message: `${provider.name} connected successfully` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

async function refreshOpenAIToken(currentToken) {
  const tokenResponse = await postOpenAIFormToken({
    grant_type: 'refresh_token',
    refresh_token: currentToken.refresh_token,
    client_id: OPENAI_OAUTH_CLIENT_ID,
  });

  const refreshed = serializeTokenResponse(tokenResponse, currentToken, {
    account_id: extractOpenAIAccountId(tokenResponse, currentToken),
  });

  setProviderToken('openai', refreshed);
  return refreshed;
}

async function refreshAnthropicToken(currentToken) {
  const tokenResponse = await postAnthropicToken({
    grant_type: 'refresh_token',
    refresh_token: currentToken.refresh_token,
    client_id: ANTHROPIC_OAUTH_CLIENT_ID,
  });

  const refreshed = serializeTokenResponse(tokenResponse, currentToken);
  setProviderToken('anthropic', refreshed);
  return refreshed;
}

async function refreshProviderToken(providerId, currentToken) {
  if (providerId === 'openai') {
    return refreshOpenAIToken(currentToken);
  }

  if (providerId === 'anthropic') {
    return refreshAnthropicToken(currentToken);
  }

  throw new Error(`Unsupported provider refresh: ${providerId}`);
}

async function getProviderAuthorization(providerId) {
  getProviderOrThrow(providerId);

  const token = getProviderToken(providerId);
  if (!token || !token.access_token) {
    return null;
  }

  if (!isTokenExpiring(token) || !token.refresh_token) {
    return {
      accessToken: token.access_token,
      accountId: token.account_id || null,
    };
  }

  if (refreshInFlight.has(providerId)) {
    const pending = await refreshInFlight.get(providerId);
    return {
      accessToken: pending.access_token,
      accountId: pending.account_id || null,
    };
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
  return {
    accessToken: refreshed.access_token,
    accountId: refreshed.account_id || null,
  };
}

async function getProviderAccessToken(providerId) {
  const authorization = await getProviderAuthorization(providerId);
  return authorization ? authorization.accessToken : null;
}

function disconnectProvider(providerId) {
  getProviderOrThrow(providerId);
  clearProviderToken(providerId);
}

module.exports = {
  listProviderStatuses,
  buildAuthorizationUrl,
  handleOAuthCallback,
  completeOAuthCode,
  getProviderAuthorization,
  getProviderAccessToken,
  disconnectProvider,
};
