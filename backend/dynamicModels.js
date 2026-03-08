/**
 * Dynamic model management for providers that support runtime model discovery.
 * Currently supports OpenRouter model querying with caching.
 */

// In-memory cache for dynamic models
// Structure: Map<providerId, { models: [], cachedAt: timestamp, ttl: number }>
const dynamicModelCache = new Map();

/**
 * Fetch available models from OpenRouter API
 * @param {string} apiKey - OpenRouter API key
 * @returns {Promise<Array>} Array of model objects with id, label, metadata
 */
async function fetchOpenRouterModels(apiKey) {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Transform to internal format
  return (data.data || []).map(model => ({
    id: `openrouter/${model.id}`,
    label: model.name || model.id,
    metadata: {
      context_length: model.context_length,
      pricing: model.pricing,
    },
  }));
}

/**
 * Get dynamic models for a provider, using cache if available
 * @param {string} providerId - Provider identifier
 * @param {Function} getProviderAuthorization - Function to get provider auth
 * @param {number} cacheTtlMs - Cache time-to-live in milliseconds
 * @param {boolean} forceRefresh - If true, bypass cache and fetch fresh
 * @returns {Promise<Array>} Array of model objects
 */
async function getProviderDynamicModels(providerId, getProviderAuthorization, cacheTtlMs, forceRefresh = false) {
  // Only OpenRouter supports dynamic models for now
  if (providerId !== 'openrouter') {
    return [];
  }

  const cached = dynamicModelCache.get(providerId);
  const now = Date.now();

  // Return cached models if valid and not forcing refresh
  if (!forceRefresh && cached && (now - cached.cachedAt < cached.ttl)) {
    return cached.models;
  }

  // Get API key
  const auth = await getProviderAuthorization(providerId);
  if (!auth || !auth.apiKey) {
    // No auth available, return cached if exists, else empty
    return cached ? cached.models : [];
  }

  try {
    const models = await fetchOpenRouterModels(auth.apiKey);
    dynamicModelCache.set(providerId, {
      models,
      cachedAt: now,
      ttl: cacheTtlMs,
    });
    return models;
  } catch (error) {
    console.error(`Failed to fetch OpenRouter models: ${error.message}`);
    // Return stale cache if available, else empty array
    return cached ? cached.models : [];
  }
}

/**
 * Clear cached models for a provider
 * @param {string} providerId - Provider identifier
 */
function clearProviderDynamicModels(providerId) {
  dynamicModelCache.delete(providerId);
}

/**
 * Check if a provider supports dynamic model discovery
 * @param {Object} provider - Provider definition object
 * @returns {boolean} True if provider supports dynamic models
 */
function providerSupportsDynamicModels(provider) {
  return provider && provider.dynamic_models === true;
}

module.exports = {
  getProviderDynamicModels,
  clearProviderDynamicModels,
  providerSupportsDynamicModels,
};
