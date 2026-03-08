const fs = require('fs');
const path = require('path');
const {
  PROVIDER_SETTINGS_PATH,
  PROVIDER_MODEL_CATALOG,
  DEFAULT_PROVIDER_MODELS,
  PROVIDER_DEFINITIONS,
  OPENROUTER_MODEL_CACHE_TTL_MS,
} = require('./config');
const {
  getProviderDynamicModels,
  providerSupportsDynamicModels,
} = require('./dynamicModels');

function ensureProviderSettingsDir() {
  fs.mkdirSync(path.dirname(PROVIDER_SETTINGS_PATH), { recursive: true });
}

function readProviderSettingsStore() {
  ensureProviderSettingsDir();

  if (!fs.existsSync(PROVIDER_SETTINGS_PATH)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(PROVIDER_SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (e) {
    console.error(`Failed to read provider settings store: ${e.message}`);
  }

  return {};
}

function writeProviderSettingsStore(store) {
  ensureProviderSettingsDir();
  fs.writeFileSync(PROVIDER_SETTINGS_PATH, JSON.stringify(store, null, 2));
}

async function getProviderCatalog(providerId, getProviderAuthorization = null) {
  const staticModels = Array.isArray(PROVIDER_MODEL_CATALOG[providerId])
    ? PROVIDER_MODEL_CATALOG[providerId]
    : [];

  const provider = PROVIDER_DEFINITIONS[providerId];
  if (providerSupportsDynamicModels(provider) && getProviderAuthorization) {
    const dynamicModels = await getProviderDynamicModels(
      providerId,
      getProviderAuthorization,
      OPENROUTER_MODEL_CACHE_TTL_MS
    );
    return [...staticModels, ...dynamicModels];
  }

  return staticModels;
}

async function getDefaultProviderModel(providerId, getProviderAuthorization = null) {
  const defaultFromEnv = DEFAULT_PROVIDER_MODELS[providerId];
  if (defaultFromEnv) {
    return defaultFromEnv;
  }

  const catalog = await getProviderCatalog(providerId, getProviderAuthorization);
  return (catalog[0] || {}).id || null;
}

async function getProviderCatalogIdSet(providerId, getProviderAuthorization = null) {
  const catalog = await getProviderCatalog(providerId, getProviderAuthorization);
  return new Set(catalog.map((model) => model.id));
}

async function isValidProviderModel(providerId, modelId, getProviderAuthorization = null) {
  const catalog = await getProviderCatalog(providerId, getProviderAuthorization);
  return catalog.some((model) => model.id === modelId);
}

async function getSelectedProviderModel(providerId, getProviderAuthorization = null) {
  const store = readProviderSettingsStore();
  const selectedModel = store[providerId] && store[providerId].selected_model;

  if (selectedModel && await isValidProviderModel(providerId, selectedModel, getProviderAuthorization)) {
    return selectedModel;
  }

  return getDefaultProviderModel(providerId, getProviderAuthorization);
}

async function setSelectedProviderModel(providerId, modelId, getProviderAuthorization = null) {
  if (!await isValidProviderModel(providerId, modelId, getProviderAuthorization)) {
    const e = new Error(`Unsupported model for ${providerId}: ${modelId}`);
    e.status = 400;
    throw e;
  }

  const store = readProviderSettingsStore();
  const existingAdditionalModels = Array.isArray(store[providerId] && store[providerId].additional_models)
    ? store[providerId].additional_models
    : [];
  store[providerId] = {
    ...(store[providerId] || {}),
    selected_model: modelId,
    additional_models: existingAdditionalModels.filter((candidate) => candidate !== modelId),
    updated_at: new Date().toISOString(),
  };
  writeProviderSettingsStore(store);

  return store[providerId];
}

async function getAdditionalProviderModels(providerId, getProviderAuthorization = null) {
  const store = readProviderSettingsStore();
  const selectedModel = await getSelectedProviderModel(providerId, getProviderAuthorization);
  const validModelIds = await getProviderCatalogIdSet(providerId, getProviderAuthorization);
  const rawAdditionalModels = Array.isArray(store[providerId] && store[providerId].additional_models)
    ? store[providerId].additional_models
    : [];

  const seen = new Set();
  return rawAdditionalModels.filter((modelId) => {
    if (typeof modelId !== 'string') {
      return false;
    }
    if (modelId === selectedModel) {
      return false;
    }
    if (!validModelIds.has(modelId)) {
      return false;
    }
    if (seen.has(modelId)) {
      return false;
    }
    seen.add(modelId);
    return true;
  });
}

async function setAdditionalProviderModels(providerId, modelIds, getProviderAuthorization = null) {
  if (!Array.isArray(modelIds)) {
    const e = new Error(`Expected additional models array for ${providerId}`);
    e.status = 400;
    throw e;
  }

  const selectedModel = await getSelectedProviderModel(providerId, getProviderAuthorization);
  const validModelIds = await getProviderCatalogIdSet(providerId, getProviderAuthorization);
  const normalized = [];
  const seen = new Set();
  for (const modelId of modelIds) {
    if (typeof modelId !== 'string' || !modelId.trim()) {
      continue;
    }
    if (modelId === selectedModel || seen.has(modelId)) {
      continue;
    }
    if (!validModelIds.has(modelId)) {
      const e = new Error(`Unsupported model for ${providerId}: ${modelId}`);
      e.status = 400;
      throw e;
    }
    seen.add(modelId);
    normalized.push(modelId);
  }

  const store = readProviderSettingsStore();
  store[providerId] = {
    ...(store[providerId] || {}),
    additional_models: normalized,
    updated_at: new Date().toISOString(),
  };
  writeProviderSettingsStore(store);

  return store[providerId];
}

async function addAdditionalProviderModel(providerId, modelId, getProviderAuthorization = null) {
  const current = await getAdditionalProviderModels(providerId, getProviderAuthorization);
  if (current.includes(modelId)) {
    return readProviderSettingsStore()[providerId] || {};
  }
  return setAdditionalProviderModels(providerId, [...current, modelId], getProviderAuthorization);
}

async function removeAdditionalProviderModel(providerId, modelId, getProviderAuthorization = null) {
  const current = await getAdditionalProviderModels(providerId, getProviderAuthorization);
  return setAdditionalProviderModels(
    providerId,
    current.filter((candidate) => candidate !== modelId),
    getProviderAuthorization
  );
}

async function getAvailableProviderModels(providerId, getProviderAuthorization = null) {
  const selectedModel = await getSelectedProviderModel(providerId, getProviderAuthorization);
  const catalog = await getProviderCatalog(providerId, getProviderAuthorization);
  const orderedCatalog = providerId === 'openrouter'
    ? [...catalog].sort((a, b) => {
        const labelA = String(a.label || a.id || '');
        const labelB = String(b.label || b.id || '');
        return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
      })
    : catalog;

  return orderedCatalog.map((model) => ({
    ...model,
    selected: model.id === selectedModel,
  }));
}

function isProviderEnabled(providerId) {
  const store = readProviderSettingsStore();
  const providerSettings = store[providerId];

  if (!providerSettings || typeof providerSettings !== 'object') {
    return true;
  }

  if (providerSettings.enabled === undefined) {
    return true;
  }

  return providerSettings.enabled !== false;
}

function setProviderEnabled(providerId, enabled) {
  const store = readProviderSettingsStore();
  store[providerId] = {
    ...(store[providerId] || {}),
    enabled: Boolean(enabled),
    updated_at: new Date().toISOString(),
  };
  writeProviderSettingsStore(store);

  return store[providerId];
}

module.exports = {
  getSelectedProviderModel,
  setSelectedProviderModel,
  getAdditionalProviderModels,
  setAdditionalProviderModels,
  addAdditionalProviderModel,
  removeAdditionalProviderModel,
  getAvailableProviderModels,
  isValidProviderModel,
  isProviderEnabled,
  setProviderEnabled,
};
