const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const COUNCIL_PROVIDER_ORDER = ['openai', 'anthropic'];

const PROVIDER_MODEL_CATALOG = {
  openai: [
    { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
    { id: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'openai/gpt-5.2', label: 'GPT-5.2' },
    { id: 'openai/gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { id: 'openai/gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { id: 'openai/gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    { id: 'openai/gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
    { id: 'openai/gpt-5-codex', label: 'GPT-5 Codex' },
    { id: 'openai/gpt-5-codex-mini', label: 'GPT-5 Codex Mini' },
  ],
  anthropic: [
    { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5' },
    { id: 'anthropic/claude-sonnet-4-0', label: 'Claude Sonnet 4' },
    { id: 'anthropic/claude-opus-4-1', label: 'Claude Opus 4.1' },
    { id: 'anthropic/claude-3-7-sonnet-latest', label: 'Claude Sonnet 3.7' },
    { id: 'anthropic/claude-3-5-haiku-latest', label: 'Claude Haiku 3.5' },
  ],
};

const DEFAULT_PROVIDER_MODELS = {
  openai:
    process.env.OPENAI_DEFAULT_MODEL ||
    PROVIDER_MODEL_CATALOG.openai[0].id,
  anthropic:
    process.env.ANTHROPIC_DEFAULT_MODEL ||
    PROVIDER_MODEL_CATALOG.anthropic[0].id,
};

const DATA_DIR = path.join(__dirname, '..', 'data', 'conversations');
const OAUTH_TOKENS_PATH = path.join(__dirname, '..', 'data', 'oauth_tokens.json');
const PROVIDER_SETTINGS_PATH = path.join(__dirname, '..', 'data', 'provider_settings.json');

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:8001';
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';

const OPENAI_OAUTH_ISSUER = process.env.OPENAI_OAUTH_ISSUER || 'https://auth.openai.com';
const OPENAI_OAUTH_CLIENT_ID =
  process.env.OPENAI_OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_OAUTH_SCOPE =
  process.env.OPENAI_OAUTH_SCOPE || 'openid profile email offline_access';
const OPENAI_CODEX_API_URL =
  process.env.OPENAI_CODEX_API_URL || 'https://chatgpt.com/backend-api/codex/responses';

const ANTHROPIC_OAUTH_CLIENT_ID =
  process.env.ANTHROPIC_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const ANTHROPIC_OAUTH_SCOPE =
  process.env.ANTHROPIC_OAUTH_SCOPE || 'org:create_api_key user:profile user:inference';
const ANTHROPIC_OAUTH_AUTHORIZE_URL_MAX =
  process.env.ANTHROPIC_OAUTH_AUTHORIZE_URL_MAX || 'https://claude.ai/oauth/authorize';
const ANTHROPIC_OAUTH_TOKEN_URL =
  process.env.ANTHROPIC_OAUTH_TOKEN_URL || 'https://console.anthropic.com/v1/oauth/token';
const ANTHROPIC_OAUTH_REDIRECT_URI =
  process.env.ANTHROPIC_OAUTH_REDIRECT_URI ||
  'https://console.anthropic.com/oauth/code/callback';

const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
const ANTHROPIC_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS || '2048');

module.exports = {
  COUNCIL_PROVIDER_ORDER,
  PROVIDER_MODEL_CATALOG,
  DEFAULT_PROVIDER_MODELS,
  DATA_DIR,
  OAUTH_TOKENS_PATH,
  PROVIDER_SETTINGS_PATH,
  APP_BASE_URL,
  FRONTEND_BASE_URL,
  OPENAI_OAUTH_ISSUER,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_SCOPE,
  OPENAI_CODEX_API_URL,
  ANTHROPIC_OAUTH_CLIENT_ID,
  ANTHROPIC_OAUTH_SCOPE,
  ANTHROPIC_OAUTH_AUTHORIZE_URL_MAX,
  ANTHROPIC_OAUTH_TOKEN_URL,
  ANTHROPIC_OAUTH_REDIRECT_URI,
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  ANTHROPIC_MAX_TOKENS,
};
