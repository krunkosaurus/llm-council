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

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  })
);

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'LLM Council API' });
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

  if (isFirstMessage) {
    const title = await generateConversationTitle(content);
    storage.updateConversationTitle(conversationId, title);
  }

  const [stage1Results, stage2Results, stage3Result, metadata] =
    await runFullCouncil(content);

  storage.addAssistantMessage(conversationId, stage1Results, stage2Results, stage3Result);

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
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    storage.addUserMessage(conversationId, content);

    // Start title generation in parallel (don't await yet)
    let titlePromise = null;
    if (isFirstMessage) {
      titlePromise = generateConversationTitle(content);
    }

    // Stage 1
    sendEvent({ type: 'stage1_start' });
    const stage1Results = await stage1CollectResponses(content);
    sendEvent({ type: 'stage1_complete', data: stage1Results });

    // Stage 2
    sendEvent({ type: 'stage2_start' });
    const [stage2Results, labelToModel] = await stage2CollectRankings(content, stage1Results);
    const aggregateRankings = calculateAggregateRankings(stage2Results, labelToModel);
    sendEvent({
      type: 'stage2_complete',
      data: stage2Results,
      metadata: { label_to_model: labelToModel, aggregate_rankings: aggregateRankings },
    });

    // Stage 3
    sendEvent({ type: 'stage3_start' });
    const stage3Result = await stage3SynthesizeFinal(content, stage1Results, stage2Results);
    sendEvent({ type: 'stage3_complete', data: stage3Result });

    // Wait for title generation
    if (titlePromise) {
      const title = await titlePromise;
      storage.updateConversationTitle(conversationId, title);
      sendEvent({ type: 'title_complete', data: { title } });
    }

    // Save complete assistant message
    storage.addAssistantMessage(conversationId, stage1Results, stage2Results, stage3Result);

    // Send completion event
    sendEvent({ type: 'complete' });
  } catch (e) {
    sendEvent({ type: 'error', message: e.message });
  }

  res.end();
});

const PORT = 8001;
app.listen(PORT, () => {
  console.log(`LLM Council API running on http://localhost:${PORT}`);
});
