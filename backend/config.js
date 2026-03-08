const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data', 'conversations');
const OAUTH_TOKENS_PATH = path.join(ROOT_DIR, 'data', 'oauth_tokens.json');
const PROVIDER_SETTINGS_PATH = path.join(ROOT_DIR, 'data', 'provider_settings.json');
const THIRD_PARTY_PROVIDER_CONFIG_PATH =
  process.env.THIRD_PARTY_PROVIDER_CONFIG_PATH || path.join(ROOT_DIR, 'providers.json');

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

const MANUS_API_URL = process.env.MANUS_API_URL || 'https://api.manus.ai';
const MANUS_TASK_TIMEOUT_MS = Number(process.env.MANUS_TASK_TIMEOUT_MS || '300000');

const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL_CACHE_TTL_MS = Number(process.env.OPENROUTER_MODEL_CACHE_TTL_MS || '3600000');

const BUILTIN_PROVIDER_DEFINITIONS = {
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    mode: 'redirect',
    transport: 'openai-codex',
    auth_type: 'oauth',
    default_model_env: 'OPENAI_DEFAULT_MODEL',
    models: [
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
  },
  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    mode: 'code',
    transport: 'anthropic-messages',
    auth_type: 'oauth',
    default_model_env: 'ANTHROPIC_DEFAULT_MODEL',
    models: [
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
  },
  manus: {
    id: 'manus',
    name: 'Manus API',
    mode: 'env',
    transport: 'manus-task',
    auth_type: 'api_key',
    api_key_env: 'MANUS_API_KEY',
    base_url: MANUS_API_URL,
    setup_hint: 'Set MANUS_API_KEY to enable Manus API access.',
    default_model_env: 'MANUS_DEFAULT_MODEL',
    models: [
      { id: 'manus/manus-1.6', label: 'Manus 1.6' },
      { id: 'manus/manus-1.6-lite', label: 'Manus 1.6 Lite' },
      { id: 'manus/manus-1.6-max', label: 'Manus 1.6 Max' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    mode: 'env',
    transport: 'openai-compatible',
    auth_type: 'api_key',
    api_key_env: 'OPENROUTER_API_KEY',
    base_url: OPENROUTER_API_URL,
    setup_hint: 'Set OPENROUTER_API_KEY to enable OpenRouter access.',
    default_model_env: 'OPENROUTER_DEFAULT_MODEL',
    models: [],
    dynamic_models: true,
  },
};

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key, value]) => typeof key === 'string' && typeof value === 'string' && key.trim())
      .map(([key, value]) => [key.trim(), value])
  );
}

function sanitizeRequestBody(requestBody) {
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(requestBody)
      .filter(([key]) => typeof key === 'string' && key.trim())
      .map(([key, value]) => [key.trim(), value])
  );
}

function getConfiguredRequestBody(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }

  return sanitizeRequestBody(config.requestBody || config.request_body);
}

function getConfiguredPromptSuffix(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return '';
  }

  const promptSuffix = config.promptSuffix || config.prompt_suffix;
  return typeof promptSuffix === 'string' ? promptSuffix : '';
}

function getConfiguredStripThinkBlocks(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }

  return Boolean(config.stripThinkBlocks || config.strip_think_blocks);
}

function normalizeConfiguredModels(providerId, models) {
  if (!models || typeof models !== 'object' || Array.isArray(models)) {
    return [];
  }

  return Object.entries(models)
    .filter(([modelId]) => typeof modelId === 'string' && modelId.trim())
    .map(([modelId, metadata]) => ({
      id: `${providerId}/${modelId}`,
      label:
        metadata && typeof metadata === 'object' && typeof metadata.name === 'string' && metadata.name.trim()
          ? metadata.name.trim()
          : modelId,
      request_body: getConfiguredRequestBody(metadata),
      prompt_suffix: getConfiguredPromptSuffix(metadata),
      strip_think_blocks: getConfiguredStripThinkBlocks(metadata),
    }));
}

function loadThirdPartyProviderConfig() {
  if (!fs.existsSync(THIRD_PARTY_PROVIDER_CONFIG_PATH)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(THIRD_PARTY_PROVIDER_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error(
      `Failed to read third-party provider config ${THIRD_PARTY_PROVIDER_CONFIG_PATH}: ${error.message}`
    );
    return {};
  }
}

function createOpenAICompatibleProviderDefinition(providerId, providerConfig, globalDefaultModel) {
  const options = providerConfig && typeof providerConfig === 'object' ? providerConfig.options : null;
  const baseURL = options && typeof options.baseURL === 'string' ? options.baseURL.trim().replace(/\/+$/, '') : '';
  const models = normalizeConfiguredModels(providerId, providerConfig && providerConfig.models);

  if (!baseURL || models.length === 0) {
    return null;
  }

  return {
    id: providerId,
    name:
      providerConfig && typeof providerConfig.name === 'string' && providerConfig.name.trim()
        ? providerConfig.name.trim()
        : providerId,
    mode: 'config',
    transport: 'openai-compatible',
    auth_type: options && (typeof options.apiKey === 'string' || typeof options.apiKeyEnv === 'string')
      ? 'api_key'
      : 'none',
    base_url: baseURL,
    api_key: options && typeof options.apiKey === 'string' ? options.apiKey : null,
    api_key_env: options && typeof options.apiKeyEnv === 'string' ? options.apiKeyEnv : null,
    headers: sanitizeHeaders(options && options.headers),
    request_body: getConfiguredRequestBody(options),
    prompt_suffix: getConfiguredPromptSuffix(options),
    strip_think_blocks: getConfiguredStripThinkBlocks(options),
    default_model:
      typeof globalDefaultModel === 'string' && globalDefaultModel.startsWith(`${providerId}/`)
        ? globalDefaultModel
        : null,
    setup_hint:
      options && typeof options.apiKeyEnv === 'string'
        ? `Set ${options.apiKeyEnv} to enable ${providerConfig.name || providerId}.`
        : `Configured via ${path.basename(THIRD_PARTY_PROVIDER_CONFIG_PATH)}.`,
    models,
  };
}

function loadThirdPartyProviderDefinitions() {
  const config = loadThirdPartyProviderConfig();
  const configuredProviders =
    config && typeof config.provider === 'object' && !Array.isArray(config.provider) ? config.provider : {};
  const globalDefaultModel = typeof config.model === 'string' ? config.model.trim() : null;

  return Object.entries(configuredProviders).reduce((acc, [providerId, providerConfig]) => {
    if (!providerId || !providerConfig || typeof providerConfig !== 'object') {
      return acc;
    }

    if (
      providerConfig.npm !== '@ai-sdk/openai-compatible' &&
      providerConfig.type !== 'openai-compatible'
    ) {
      return acc;
    }

    const definition = createOpenAICompatibleProviderDefinition(
      providerId.trim(),
      providerConfig,
      globalDefaultModel
    );

    if (definition) {
      acc[definition.id] = definition;
    }

    return acc;
  }, {});
}

const THIRD_PARTY_PROVIDER_DEFINITIONS = loadThirdPartyProviderDefinitions();
const PROVIDER_DEFINITIONS = {
  ...BUILTIN_PROVIDER_DEFINITIONS,
  ...THIRD_PARTY_PROVIDER_DEFINITIONS,
};

const COUNCIL_PROVIDER_ORDER = Object.keys(PROVIDER_DEFINITIONS);
const PROVIDER_MODEL_CATALOG = Object.fromEntries(
  Object.entries(PROVIDER_DEFINITIONS).map(([providerId, provider]) => [providerId, provider.models || []])
);

const DEFAULT_PROVIDER_MODELS = Object.fromEntries(
  Object.entries(PROVIDER_DEFINITIONS).map(([providerId, provider]) => {
    const envName =
      provider.default_model_env ||
      `${providerId.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_DEFAULT_MODEL`;
    return [providerId, process.env[envName] || provider.default_model || ((provider.models || [])[0] || {}).id || null];
  })
);

module.exports = {
  COUNCIL_PROVIDER_ORDER,
  PROVIDER_DEFINITIONS,
  PROVIDER_MODEL_CATALOG,
  DEFAULT_PROVIDER_MODELS,
  DATA_DIR,
  OAUTH_TOKENS_PATH,
  PROVIDER_SETTINGS_PATH,
  THIRD_PARTY_PROVIDER_CONFIG_PATH,
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
  MANUS_API_URL,
  MANUS_TASK_TIMEOUT_MS,
  OPENROUTER_API_URL,
  OPENROUTER_MODEL_CACHE_TTL_MS,
};
