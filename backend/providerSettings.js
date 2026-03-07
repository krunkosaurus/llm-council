const fs = require('fs');
const path = require('path');
const {
  PROVIDER_SETTINGS_PATH,
  PROVIDER_MODEL_CATALOG,
  DEFAULT_PROVIDER_MODELS,
} = require('./config');

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

function getProviderCatalog(providerId) {
  return Array.isArray(PROVIDER_MODEL_CATALOG[providerId]) ? PROVIDER_MODEL_CATALOG[providerId] : [];
}

function getDefaultProviderModel(providerId) {
  return DEFAULT_PROVIDER_MODELS[providerId] || (getProviderCatalog(providerId)[0] || {}).id || null;
}

function isValidProviderModel(providerId, modelId) {
  return getProviderCatalog(providerId).some((model) => model.id === modelId);
}

function getSelectedProviderModel(providerId) {
  const store = readProviderSettingsStore();
  const selectedModel = store[providerId] && store[providerId].selected_model;

  if (selectedModel && isValidProviderModel(providerId, selectedModel)) {
    return selectedModel;
  }

  return getDefaultProviderModel(providerId);
}

function setSelectedProviderModel(providerId, modelId) {
  if (!isValidProviderModel(providerId, modelId)) {
    const e = new Error(`Unsupported model for ${providerId}: ${modelId}`);
    e.status = 400;
    throw e;
  }

  const store = readProviderSettingsStore();
  store[providerId] = {
    ...(store[providerId] || {}),
    selected_model: modelId,
    updated_at: new Date().toISOString(),
  };
  writeProviderSettingsStore(store);

  return store[providerId];
}

function getAvailableProviderModels(providerId) {
  const selectedModel = getSelectedProviderModel(providerId);
  return getProviderCatalog(providerId).map((model) => ({
    ...model,
    selected: model.id === selectedModel,
  }));
}

module.exports = {
  getSelectedProviderModel,
  setSelectedProviderModel,
  getAvailableProviderModels,
  isValidProviderModel,
};
