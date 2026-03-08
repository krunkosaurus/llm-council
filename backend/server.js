const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const storage = require('./storage');
const {
  runFullCouncil,
  generateConversationTitle,
  stage1CollectResponses,
  stage2CollectRankings,
  stage3SynthesizeFinal,
  calculateAggregateRankings,
} = require('./council');
const {
  listProviderStatuses,
  buildAuthorizationUrl,
  handleOAuthCallback,
  completeOAuthCode,
  disconnectProvider,
} = require('./oauth');
const { setSelectedProviderModel } = require('./providerSettings');
const { FRONTEND_BASE_URL } = require('./config');

const app = express();
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];

const allowedOrigins = new Set(
  [
    ...DEFAULT_ALLOWED_ORIGINS,
    FRONTEND_BASE_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ].filter(Boolean)
);
const allowAllOrigins = allowedOrigins.has('*');

app.use(express.json());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowAllOrigins || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  })
);

function renderOAuthCallbackPage(ok, message) {
  const escapedMessage = String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const title = ok ? 'OAuth Success' : 'OAuth Failed';
  const statusColor = ok ? '#1f8f45' : '#b42318';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 2rem; color: #1f2937; }
      h1 { margin-top: 0; color: ${statusColor}; }
      p { line-height: 1.5; }
      .hint { margin-top: 1rem; color: #6b7280; font-size: 0.95rem; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${escapedMessage}</p>
    <p class="hint">You can close this window and return to LLM Council.</p>
    <script>setTimeout(() => window.close(), 1200);</script>
  </body>
</html>`;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'LLM Council API' });
});

// Lightweight root route for direct backend checks.
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LLM Council API',
    hint: 'Use /api/* endpoints for application requests.',
  });
});

// OAuth provider status
app.get('/api/auth/providers', (req, res) => {
  res.json(listProviderStatuses());
});

// Start OAuth flow
app.get('/api/auth/:provider/start', async (req, res) => {
  try {
    const result = await buildAuthorizationUrl(req.params.provider);
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ detail: e.message });
  }
});

// OAuth callback endpoint
app.get('/api/auth/:provider/callback', async (req, res) => {
  try {
    const result = await handleOAuthCallback(req.params.provider, req.query);
    res.status(result.ok ? 200 : 400).send(renderOAuthCallbackPage(result.ok, result.message));
  } catch (e) {
    res.status(e.status || 400).send(renderOAuthCallbackPage(false, e.message));
  }
});

// Complete code-based OAuth flow (used by Claude flow)
app.post('/api/auth/:provider/complete', async (req, res) => {
  try {
    const result = await completeOAuthCode(req.params.provider, req.body);
    if (!result.ok) {
      return res.status(400).json({ detail: result.message });
    }
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ detail: e.message });
  }
});

// Disconnect OAuth provider
app.post('/api/auth/:provider/disconnect', (req, res) => {
  try {
    disconnectProvider(req.params.provider);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ detail: e.message });
  }
});

// Update selected model for provider
app.post('/api/auth/:provider/model', (req, res) => {
  try {
    const providerId = req.params.provider;
    const modelId = req.body && req.body.model;

    if (!modelId) {
      return res.status(400).json({ detail: 'Missing model' });
    }

    setSelectedProviderModel(providerId, modelId);
    const providers = listProviderStatuses();
    res.json({
      ok: true,
      provider: providers[providerId],
    });
  } catch (e) {
    res.status(e.status || 400).json({ detail: e.message });
  }
});

// List all conversations
app.get('/api/conversations', (req, res) => {
  res.json(storage.listConversations());
});

// Create a new conversation
app.post('/api/conversations', (req, res) => {
  const conversationId = uuidv4();
  const conversation = storage.createConversation(conversationId);
  res.json(conversation);
});

// Get a specific conversation
app.get('/api/conversations/:conversationId', (req, res) => {
  const conversation = storage.getConversation(req.params.conversationId);
  if (conversation === null) {
    return res.status(404).json({ detail: 'Conversation not found' });
  }
  res.json(conversation);
});

// Send message (non-streaming)
app.post('/api/conversations/:conversationId/message', async (req, res) => {
  const { conversationId } = req.params;
  const { content } = req.body;

  const conversation = storage.getConversation(conversationId);
  if (conversation === null) {
    return res.status(404).json({ detail: 'Conversation not found' });
  }

  const isFirstMessage = conversation.messages.length === 0;

  storage.addUserMessage(conversationId, content);
  storage.startAssistantMessage(conversationId);

  if (isFirstMessage) {
    const title = await generateConversationTitle(content);
    storage.updateConversationTitle(conversationId, title);
  }

  const [stage1Results, stage2Results, stage3Result, metadata] = await runFullCouncil(content);

  storage.completeAssistantMessage(conversationId, stage1Results, stage2Results, stage3Result, metadata);

  res.json({
    stage1: stage1Results,
    stage2: stage2Results,
    stage3: stage3Result,
    metadata,
  });
});

// Send message (SSE streaming)
app.post('/api/conversations/:conversationId/message/stream', async (req, res) => {
  const { conversationId } = req.params;
  const { content } = req.body;

  const conversation = storage.getConversation(conversationId);
  if (conversation === null) {
    return res.status(404).json({ detail: 'Conversation not found' });
  }

  const isFirstMessage = conversation.messages.length === 0;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let streamClosed = false;
  const markClosed = () => {
    streamClosed = true;
  };

  req.on('close', markClosed);
  res.on('close', markClosed);

  const sendEvent = (event) => {
    if (streamClosed || res.writableEnded || res.destroyed) {
      return;
    }

    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (_ignored) {
      streamClosed = true;
    }
  };

  res.write(': connected\n\n');

  try {
    storage.addUserMessage(conversationId, content);
    storage.startAssistantMessage(conversationId);

    // Start title generation in parallel (don't await yet)
    let titlePromise = null;
    if (isFirstMessage) {
      titlePromise = generateConversationTitle(content);
    }

    // Stage 1
    sendEvent({ type: 'stage1_start' });
    const [stage1Results, stage1Failures] = await stage1CollectResponses(content);
    storage.updateLatestAssistantMessage(conversationId, {
      stage1: stage1Results,
      metadata: {
        stage1_failures: stage1Failures,
      },
      loading: {
        stage1: false,
        stage2: false,
        stage3: false,
      },
    });
    sendEvent({
      type: 'stage1_complete',
      data: stage1Results,
      metadata: { stage1_failures: stage1Failures },
    });

    // Stage 2
    storage.updateLatestAssistantMessage(conversationId, {
      loading: {
        stage1: false,
        stage2: true,
        stage3: false,
      },
    });
    sendEvent({ type: 'stage2_start' });
    const [stage2Results, labelToModel, stage2Failures] = await stage2CollectRankings(content, stage1Results);
    const aggregateRankings = calculateAggregateRankings(stage2Results, labelToModel);
    const metadata = {
      label_to_model: labelToModel,
      aggregate_rankings: aggregateRankings,
      stage1_failures: stage1Failures,
      stage2_failures: stage2Failures,
    };
    storage.updateLatestAssistantMessage(conversationId, {
      stage2: stage2Results,
      metadata,
      loading: {
        stage1: false,
        stage2: false,
        stage3: false,
      },
    });
    sendEvent({
      type: 'stage2_complete',
      data: stage2Results,
      metadata,
    });

    // Stage 3
    storage.updateLatestAssistantMessage(conversationId, {
      loading: {
        stage1: false,
        stage2: false,
        stage3: true,
      },
    });
    sendEvent({ type: 'stage3_start' });
    const stage3Result = await stage3SynthesizeFinal(content, stage1Results, stage2Results);
    storage.completeAssistantMessage(conversationId, stage1Results, stage2Results, stage3Result, metadata);
    sendEvent({ type: 'stage3_complete', data: stage3Result });

    // Wait for title generation
    if (titlePromise) {
      const title = await titlePromise;
      storage.updateConversationTitle(conversationId, title);
      sendEvent({ type: 'title_complete', data: { title } });
    }

    // Send completion event
    sendEvent({ type: 'complete' });
  } catch (e) {
    try {
      storage.updateLatestAssistantMessage(conversationId, {
        stage3: {
          model: 'error',
          response: `Error: ${e.message}`,
        },
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      });
    } catch (_ignored) {
      // Ignore storage update failures while already handling an error path.
    }
    sendEvent({ type: 'error', message: e.message });
  }

  if (!streamClosed && !res.writableEnded && !res.destroyed) {
    res.end();
  }
});

const PORT = Number(process.env.PORT || '8001');
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`LLM Council backend listening on http://${HOST}:${PORT}`);
});
