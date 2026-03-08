const {
  OPENAI_CODEX_API_URL,
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  ANTHROPIC_MAX_TOKENS,
  MANUS_TASK_TIMEOUT_MS,
  PROVIDER_DEFINITIONS,
} = require('./config');
const { getProviderAuthorization } = require('./oauth');

const ANTHROPIC_REQUIRED_BETAS = ['oauth-2025-04-20', 'interleaved-thinking-2025-05-14'];
const OPENAI_PROMPT_BASE_URL =
  'https://raw.githubusercontent.com/openai/codex/refs/heads/main/codex-rs/core';
const OPENAI_PROMPT_URLS = {
  'gpt-5.4': `${OPENAI_PROMPT_BASE_URL}/prompt.md`,
  'gpt-5.3-codex': `${OPENAI_PROMPT_BASE_URL}/gpt_5_codex_prompt.md`,
  'gpt-5.2': `${OPENAI_PROMPT_BASE_URL}/gpt_5_2_prompt.md`,
  'gpt-5.2-codex': `${OPENAI_PROMPT_BASE_URL}/gpt-5.2-codex_prompt.md`,
  'gpt-5.1-codex-max': `${OPENAI_PROMPT_BASE_URL}/gpt-5.1-codex-max_prompt.md`,
  'gpt-5.1-codex': `${OPENAI_PROMPT_BASE_URL}/gpt_5_codex_prompt.md`,
  'gpt-5.1-codex-mini': `${OPENAI_PROMPT_BASE_URL}/gpt_5_codex_prompt.md`,
  'gpt-5-codex': `${OPENAI_PROMPT_BASE_URL}/gpt_5_codex_prompt.md`,
  'gpt-5-codex-mini': `${OPENAI_PROMPT_BASE_URL}/gpt_5_codex_prompt.md`,
};
const OPENAI_PROMPT_CACHE = new Map();
const DEFAULT_OPENAI_INSTRUCTIONS =
  'You are Codex, a terminal-based coding assistant. Be accurate, safe, and concise.';

function normalizeModelForProvider(model, provider) {
  const prefix = `${provider}/`;
  if (typeof model === 'string' && model.startsWith(prefix)) {
    const normalized = model.slice(prefix.length);
    return provider === 'anthropic' ? normalized.replace(/\./g, '-') : normalized;
  }

  return model;
}

function inferProviderFromModel(model) {
  if (typeof model !== 'string') {
    return null;
  }

  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  const providerId = model.slice(0, slashIndex);
  return PROVIDER_DEFINITIONS[providerId] ? providerId : null;
}

function parseMessageContent(message) {
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
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        return '';
      })
      .join('')
      .trim();
  }

  return String(message.content);
}

function buildPlainMessages(messages) {
  return messages
    .filter(
      (message) =>
        message &&
        (message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    )
    .map((message) => ({
      role: message.role,
      content: parseMessageContent(message),
    }))
    .filter((message) => message.content && message.content.trim());
}

function buildRoleTranscript(messages) {
  return buildPlainMessages(messages)
    .map((message) => `[${message.role.toUpperCase()}]\n${message.content}`)
    .join('\n\n')
    .trim();
}

function parseChatCompletionResponse(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.choices)) {
    return null;
  }

  const message = data.choices[0] && data.choices[0].message;
  return parseMessageContent(message);
}

function buildOpenAICompatiblePayload(model, messages) {
  return {
    model: normalizeModelForProvider(model, inferProviderFromModel(model)),
    messages: buildPlainMessages(messages),
    stream: false,
  };
}

function getOpenAICompatibleRequestBody(providerId, model) {
  const provider = PROVIDER_DEFINITIONS[providerId];
  if (!provider) {
    return {};
  }

  const modelDefinition = Array.isArray(provider.models)
    ? provider.models.find((candidate) => candidate && candidate.id === model)
    : null;

  return {
    ...(provider.request_body || {}),
    ...(modelDefinition && modelDefinition.request_body ? modelDefinition.request_body : {}),
  };
}

function getOpenAICompatiblePromptSuffix(providerId, model) {
  const provider = PROVIDER_DEFINITIONS[providerId];
  if (!provider) {
    return '';
  }

  const modelDefinition = Array.isArray(provider.models)
    ? provider.models.find((candidate) => candidate && candidate.id === model)
    : null;

  const modelSuffix = modelDefinition && typeof modelDefinition.prompt_suffix === 'string'
    ? modelDefinition.prompt_suffix
    : '';
  if (modelSuffix) {
    return modelSuffix;
  }

  return typeof provider.prompt_suffix === 'string' ? provider.prompt_suffix : '';
}

function shouldStripThinkBlocks(providerId, model) {
  const provider = PROVIDER_DEFINITIONS[providerId];
  if (!provider) {
    return false;
  }

  const modelDefinition = Array.isArray(provider.models)
    ? provider.models.find((candidate) => candidate && candidate.id === model)
    : null;

  if (modelDefinition && typeof modelDefinition.strip_think_blocks === 'boolean') {
    return modelDefinition.strip_think_blocks;
  }

  return Boolean(provider.strip_think_blocks);
}

function applyPromptSuffixToMessages(messages, promptSuffix) {
  if (!promptSuffix) {
    return messages;
  }

  const plainMessages = buildPlainMessages(messages);
  for (let index = plainMessages.length - 1; index >= 0; index -= 1) {
    const message = plainMessages[index];
    if (message.role === 'user') {
      return plainMessages.map((candidate, candidateIndex) =>
        candidateIndex === index
          ? { ...candidate, content: `${candidate.content}${promptSuffix}` }
          : candidate
      );
    }
  }

  return plainMessages;
}

function stripThinkBlocks(text) {
  if (typeof text !== 'string' || !text) {
    return text;
  }

  const stripped = text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s+|\s+$/g, '');

  return stripped || text.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOpenAIInputMessages(messages) {
  const inputMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const text = parseMessageContent(message);
      if (!text || !text.trim()) {
        return null;
      }

      return {
        role: message.role,
        content: [
          {
            type: 'input_text',
            text,
          },
        ],
      };
    })
    .filter(Boolean);

  if (inputMessages.length > 0) {
    return inputMessages;
  }

  return [
    {
      role: 'user',
      content: [{ type: 'input_text', text: '' }],
    },
  ];
}

async function fetchOpenAIPrompt(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = (await response.text()).trim();
  if (!text) {
    throw new Error('Prompt file was empty');
  }

  return text;
}

async function getOpenAIInstructions(model) {
  const normalizedModel = normalizeModelForProvider(model, 'openai');
  const promptUrl = OPENAI_PROMPT_URLS[normalizedModel];

  if (!promptUrl) {
    return DEFAULT_OPENAI_INSTRUCTIONS;
  }

  if (!OPENAI_PROMPT_CACHE.has(promptUrl)) {
    OPENAI_PROMPT_CACHE.set(
      promptUrl,
      fetchOpenAIPrompt(promptUrl).catch((error) => {
        OPENAI_PROMPT_CACHE.delete(promptUrl);
        console.error(
          `Failed to load OpenAI instructions for ${normalizedModel} from ${promptUrl}: ${error.message}`
        );
        return DEFAULT_OPENAI_INSTRUCTIONS;
      })
    );
  }

  return OPENAI_PROMPT_CACHE.get(promptUrl);
}

function buildOpenAIOAuthPayload(model, messages, instructions) {
  return {
    model: normalizeModelForProvider(model, 'openai'),
    instructions,
    input: buildOpenAIInputMessages(messages),
    stream: true,
    store: false,
  };
}

function parseOpenAIOutputItems(items) {
  if (!Array.isArray(items)) {
    return '';
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      if (typeof item.text === 'string') {
        return item.text;
      }

      if (Array.isArray(item.content)) {
        return parseOpenAIOutputItems(item.content);
      }

      return '';
    })
    .join('')
    .trim();
}

function parseOpenAIResponse(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const text = data.output
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return '';
        }

        if (typeof item.text === 'string') {
          return item.text;
        }

        if (Array.isArray(item.content)) {
          return item.content
            .map((content) => {
              if (!content || typeof content !== 'object') {
                return '';
              }

              if (typeof content.text === 'string') {
                return content.text;
              }

              if (typeof content.output_text === 'string') {
                return content.output_text;
              }

              return '';
            })
            .join('');
        }

        return '';
      })
      .join('')
      .trim();

    if (text) {
      return text;
    }
  }

  if (data.message) {
    return parseMessageContent(data.message);
  }

  if (data.choices && data.choices[0] && data.choices[0].message) {
    return parseMessageContent(data.choices[0].message);
  }

  if (Array.isArray(data.content)) {
    const text = parseOpenAIOutputItems(data.content);
    return text || null;
  }

  return null;
}

function parseOpenAIStreamError(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  if (event.type === 'error' && event.error) {
    if (typeof event.error === 'string') {
      return event.error;
    }
    if (typeof event.error.message === 'string') {
      return event.error.message;
    }
  }

  if (event.type === 'response.completed' && event.response && event.response.error) {
    if (typeof event.response.error === 'string') {
      return event.response.error;
    }
    if (typeof event.response.error.message === 'string') {
      return event.response.error.message;
    }
  }

  return null;
}

async function readOpenAIStream(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    return text || null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outputText = '';
  let latestResponse = null;
  let streamError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');

    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = rawEvent.split('\n');
      let data = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          data += line.slice(6);
        }
      }

      if (data && data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          const errorMessage = parseOpenAIStreamError(parsed);
          if (errorMessage) {
            streamError = errorMessage;
          }

          if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
            outputText += parsed.delta;
          }

          if (parsed.type === 'response.completed' && parsed.response) {
            latestResponse = parsed.response;
          }
        } catch (_ignored) {
          // Ignore non-JSON stream lines and keep consuming deltas.
        }
      }

      boundary = buffer.indexOf('\n\n');
    }
  }

  if (streamError) {
    throw new Error(streamError);
  }

  const finalText = outputText.trim();
  if (finalText) {
    return finalText;
  }

  return parseOpenAIResponse(latestResponse);
}

async function queryViaOpenAIOAuth(model, messages, timeout = 120000) {
  const auth = await getProviderAuthorization('openai');
  if (!auth || !auth.accessToken) {
    console.error(`OpenAI OAuth token unavailable; skipping model ${model}`);
    return null;
  }

  const instructions = await getOpenAIInstructions(model);
  const payload = buildOpenAIOAuthPayload(model, messages, instructions);

  try {
    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
      originator: 'llm-council',
      'User-Agent': 'llm-council/0.1',
    };

    if (auth.accountId) {
      headers['ChatGPT-Account-Id'] = auth.accountId;
    }

    const response = await fetch(OPENAI_CODEX_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const content = await readOpenAIStream(response);

    return {
      content,
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
    .map((message) => parseMessageContent(message))
    .filter(Boolean)
    .join('\n\n');

  const anthropicMessages = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: parseMessageContent(message),
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
  const auth = await getProviderAuthorization('anthropic');
  if (!auth || !auth.accessToken) {
    console.error(`Claude OAuth token unavailable; skipping model ${model}`);
    return null;
  }

  const payload = toAnthropicPayload(model, messages);

  try {
    const url = new URL(ANTHROPIC_API_URL);
    if (url.pathname === '/v1/messages' && !url.searchParams.has('beta')) {
      url.searchParams.set('beta', 'true');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': ANTHROPIC_REQUIRED_BETAS.join(','),
        'user-agent': 'claude-cli/2.1.2 (external, cli)',
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

async function queryViaOpenAICompatibleProvider(providerId, model, messages, timeout = 120000) {
  const provider = PROVIDER_DEFINITIONS[providerId];
  const auth = await getProviderAuthorization(providerId);
  if (!provider || !auth || !auth.baseURL) {
    console.error(`Configured provider ${providerId} is unavailable; skipping model ${model}`);
    return null;
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(auth.headers || {}),
  };

  if (auth.accessToken) {
    headers.Authorization = `Bearer ${auth.accessToken}`;
  }

  try {
    const promptSuffix = getOpenAICompatiblePromptSuffix(providerId, model);
    const payload = {
      model: normalizeModelForProvider(model, inferProviderFromModel(model)),
      messages: applyPromptSuffixToMessages(messages, promptSuffix),
      stream: false,
      ...getOpenAICompatibleRequestBody(providerId, model),
    };

    const response = await fetch(`${auth.baseURL}/chat/completions`, {
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
    const content = parseChatCompletionResponse(data);
    return {
      content: shouldStripThinkBlocks(providerId, model) ? stripThinkBlocks(content) : content,
      reasoning_details: null,
    };
  } catch (error) {
    console.error(`Error querying OpenAI-compatible provider ${providerId} (${model}): ${error.message}`);
    return null;
  }
}

function parseManusOutputText(output) {
  if (!Array.isArray(output)) {
    return null;
  }

  const assistantMessages = output.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      item.role === 'assistant' &&
      Array.isArray(item.content) &&
      item.content.length > 0
  );

  const source = assistantMessages.length > 0 ? assistantMessages : output;

  return source
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      if (Array.isArray(item.content)) {
        return item.content
          .map((content) => {
            if (!content || typeof content !== 'object') {
              return '';
            }
            return typeof content.text === 'string' ? content.text : '';
          })
          .join('\n');
      }

      return '';
    })
    .join('\n')
    .trim();
}

async function pollManusTask(auth, taskId, timeout) {
  const startedAt = Date.now();
  let notFoundCount = 0;
  const headers = {
    'Content-Type': 'application/json',
    API_KEY: auth.apiKey,
  };

  while (Date.now() - startedAt < timeout) {
    const response = await fetch(`${auth.baseURL}/v1/tasks/${taskId}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(Math.min(timeout, 20000)),
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404 && /task not found/i.test(text) && notFoundCount < 5) {
        notFoundCount += 1;
        await sleep(1000);
        continue;
      }
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    notFoundCount = 0;
    const task = await response.json();
    const status = typeof task.status === 'string' ? task.status.toLowerCase() : '';

    if (status === 'completed') {
      return task;
    }

    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(task.error || task.message || `Task ended with status ${task.status}`);
    }

    if (status === 'awaiting_input') {
      throw new Error('Task is waiting for follow-up input, which LLM Council does not support yet');
    }

    await sleep(2000);
  }

  throw new Error('Timed out waiting for Manus task completion');
}

async function queryViaManus(model, messages, timeout = MANUS_TASK_TIMEOUT_MS) {
  const auth = await getProviderAuthorization('manus');
  if (!auth || !auth.apiKey || !auth.baseURL) {
    console.error(`Manus API key unavailable; skipping model ${model}`);
    return null;
  }

  const prompt = buildRoleTranscript(messages);

  try {
    const createResponse = await fetch(`${auth.baseURL}/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        API_KEY: auth.apiKey,
      },
      body: JSON.stringify({
        prompt,
        agentProfile: normalizeModelForProvider(model, 'manus'),
      }),
      signal: AbortSignal.timeout(Math.min(timeout, 20000)),
    });

    if (!createResponse.ok) {
      const text = await createResponse.text();
      throw new Error(`HTTP ${createResponse.status}: ${text}`);
    }

    const task = await createResponse.json();
    if (!task || !task.task_id) {
      throw new Error('Task creation did not return a task_id');
    }

    const finalTask = await pollManusTask(auth, task.task_id, timeout);
    return {
      content: parseManusOutputText(finalTask.output),
      reasoning_details: null,
    };
  } catch (error) {
    console.error(`Error querying Manus model ${model}: ${error.message}`);
    return null;
  }
}

/**
 * Query a single model via the configured provider transport.
 * Unsupported providers or missing credentials return null.
 */
async function queryModel(model, messages, timeout = 120000) {
  const provider = inferProviderFromModel(model);

  if (!provider) {
    console.error(`Unsupported model provider for ${model}`);
    return null;
  }

  if (provider === 'openai') {
    return queryViaOpenAIOAuth(model, messages, timeout);
  }

  if (provider === 'anthropic') {
    return queryViaAnthropicOAuth(model, messages, timeout);
  }

  if (provider === 'manus') {
    return queryViaManus(model, messages, timeout);
  }

  if (PROVIDER_DEFINITIONS[provider] && PROVIDER_DEFINITIONS[provider].transport === 'openai-compatible') {
    return queryViaOpenAICompatibleProvider(provider, model, messages, timeout);
  }

  console.error(`Unsupported transport for ${model}`);
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
