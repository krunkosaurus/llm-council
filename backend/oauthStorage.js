const fs = require('fs');
const path = require('path');
const { OAUTH_TOKENS_PATH } = require('./config');

function ensureOAuthDataDir() {
  fs.mkdirSync(path.dirname(OAUTH_TOKENS_PATH), { recursive: true });
}

function readTokenStore() {
  ensureOAuthDataDir();

  if (!fs.existsSync(OAUTH_TOKENS_PATH)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(OAUTH_TOKENS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (e) {
    console.error(`Failed to read OAuth token store: ${e.message}`);
  }

  return {};
}

function writeTokenStore(store) {
  ensureOAuthDataDir();
  fs.writeFileSync(OAUTH_TOKENS_PATH, JSON.stringify(store, null, 2));
}

function getProviderToken(providerId) {
  const store = readTokenStore();
  const token = store[providerId];
  return token && typeof token === 'object' ? token : null;
}

function setProviderToken(providerId, tokenData) {
  const store = readTokenStore();
  store[providerId] = tokenData;
  writeTokenStore(store);
}

function clearProviderToken(providerId) {
  const store = readTokenStore();
  delete store[providerId];
  writeTokenStore(store);
}

module.exports = {
  getProviderToken,
  setProviderToken,
  clearProviderToken,
};
