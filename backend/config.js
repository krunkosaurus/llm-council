const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const COUNCIL_MODELS = (process.env.COUNCIL_MODELS ||
  'openai/gpt-5.1,anthropic/claude-sonnet-4.5')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const CHAIRMAN_MODEL = process.env.CHAIRMAN_MODEL || 'openai/gpt-5.1';

const DATA_DIR = path.join(__dirname, '..', 'data', 'conversations');
const OAUTH_TOKENS_PATH = path.join(__dirname, '..', 'data', 'oauth_tokens.json');

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:8001';
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';

const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
const ANTHROPIC_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS || '2048');

const OAUTH_PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    authorize_url: process.env.OPENAI_OAUTH_AUTHORIZE_URL || null,
    token_url: process.env.OPENAI_OAUTH_TOKEN_URL || null,
    client_id: process.env.OPENAI_OAUTH_CLIENT_ID || null,
    client_secret: process.env.OPENAI_OAUTH_CLIENT_SECRET || null,
    scope: process.env.OPENAI_OAUTH_SCOPE || 'openid profile email offline_access',
    audience: process.env.OPENAI_OAUTH_AUDIENCE || null,
    token_auth_method: process.env.OPENAI_OAUTH_TOKEN_AUTH_METHOD || 'client_secret_post',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    authorize_url: process.env.ANTHROPIC_OAUTH_AUTHORIZE_URL || null,
    token_url: process.env.ANTHROPIC_OAUTH_TOKEN_URL || null,
    client_id: process.env.ANTHROPIC_OAUTH_CLIENT_ID || null,
    client_secret: process.env.ANTHROPIC_OAUTH_CLIENT_SECRET || null,
    scope: process.env.ANTHROPIC_OAUTH_SCOPE || 'openid profile email offline_access',
    audience: process.env.ANTHROPIC_OAUTH_AUDIENCE || null,
    token_auth_method:
      process.env.ANTHROPIC_OAUTH_TOKEN_AUTH_METHOD || 'client_secret_post',
  },
};

module.exports = {
  COUNCIL_MODELS,
  CHAIRMAN_MODEL,
  DATA_DIR,
  OAUTH_TOKENS_PATH,
  APP_BASE_URL,
  FRONTEND_BASE_URL,
  OPENAI_API_URL,
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  ANTHROPIC_MAX_TOKENS,
  OAUTH_PROVIDERS,
};
