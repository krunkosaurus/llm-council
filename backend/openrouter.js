const { OPENROUTER_API_KEY, OPENROUTER_API_URL } = require('./config');

/**
 * Query a single model via OpenRouter API.
 * Returns { content, reasoning_details } or null on failure.
 */
async function queryModel(model, messages, timeout = 120000) {
  const headers = {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const payload = { model, messages };

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();
    const message = data.choices[0].message;

    return {
      content: message.content || null,
      reasoning_details: message.reasoning_details || null,
    };
  } catch (e) {
    console.error(`Error querying model ${model}: ${e.message}`);
    return null;
  }
}

/**
 * Query multiple models in parallel.
 * Returns object mapping model ID to response (or null).
 */
async function queryModelsParallel(models, messages) {
  const tasks = models.map((model) => queryModel(model, messages));
  const responses = await Promise.all(tasks);

  const result = {};
  models.forEach((model, i) => {
    result[model] = responses[i];
  });
  return result;
}

module.exports = { queryModel, queryModelsParallel };
