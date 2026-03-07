const {
  OPENAI_API_URL,
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  ANTHROPIC_MAX_TOKENS,
} = require('./config');
const { getProviderAccessToken } = require('./oauth');

function normalizeModelForProvider(model, provider) {
  if (provider === 'openai') {
    return model.replace(/^openai\//, '');
  }

  if (provider === 'anthropic') {
    return model.replace(/^anthropic\//, '').replace(/\./g, '-');
  }

  return model;
}

function inferProviderFromModel(model) {
  if (model.startsWith('openai/')) {
    return 'openai';
  }

  if (model.startsWith('anthropic/')) {
    return 'anthropic';
  }

  return null;
}

function parseOpenAIContent(message) {
  if (!message || message.content === undefined || message.content === null) {
    return null;
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }

  return String(message.content);
}

async function queryViaOpenAIOAuth(model, messages, timeout = 120000) {
  const accessToken = await getProviderAccessToken('openai');
  if (!accessToken) {
    console.error(`OpenAI OAuth token unavailable; skipping model ${model}`);
    return null;
  }

  const payload = {
    model: normalizeModelForProvider(model, 'openai'),
    messages,
  };

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();
    const message = data.choices && data.choices[0] ? data.choices[0].message : null;

    return {
      content: parseOpenAIContent(message),
      reasoning_details: null,
    };
  } catch (e) {
    console.error(`Error querying OpenAI OAuth model ${model}: ${e.message}`);
    return null;
  }
}

function toAnthropicPayload(model, messages) {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');

  const anthropicMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const payload = {
    model: normalizeModelForProvider(model, 'anthropic'),
    max_tokens: ANTHROPIC_MAX_TOKENS,
    messages: anthropicMessages,
  };

  if (systemMessages) {
    payload.system = systemMessages;
  }

  return payload;
}

function parseAnthropicContent(contentBlocks) {
  if (!Array.isArray(contentBlocks)) {
    return null;
  }

  return contentBlocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
}

async function queryViaAnthropicOAuth(model, messages, timeout = 120000) {
  const accessToken = await getProviderAccessToken('anthropic');
  if (!accessToken) {
    console.error(`Claude OAuth token unavailable; skipping model ${model}`);
    return null;
  }

  const payload = toAnthropicPayload(model, messages);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();

    return {
      content: parseAnthropicContent(data.content),
      reasoning_details: null,
    };
  } catch (e) {
    console.error(`Error querying Claude OAuth model ${model}: ${e.message}`);
    return null;
  }
}

/**
 * Query a single model via provider OAuth only.
 * Unsupported providers or missing OAuth credentials return null.
 */
async function queryModel(model, messages, timeout = 120000) {
  const provider = inferProviderFromModel(model);

  if (provider === 'openai') {
    return queryViaOpenAIOAuth(model, messages, timeout);
  }

  if (provider === 'anthropic') {
    return queryViaAnthropicOAuth(model, messages, timeout);
  }

  console.error(`Unsupported model provider for ${model}; only openai/* and anthropic/* are allowed`);
  return null;
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
