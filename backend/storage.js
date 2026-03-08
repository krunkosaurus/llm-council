const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getConversationPath(conversationId) {
  return path.join(DATA_DIR, `${conversationId}.json`);
}

function createConversation(conversationId) {
  ensureDataDir();

  const conversation = {
    id: conversationId,
    created_at: new Date().toISOString(),
    title: 'New Conversation',
    messages: [],
  };

  const filePath = getConversationPath(conversationId);
  fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));

  return conversation;
}

function getConversation(conversationId) {
  const filePath = getConversationPath(conversationId);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data);
}

function deleteConversation(conversationId) {
  const filePath = getConversationPath(conversationId);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  return true;
}

function saveConversation(conversation) {
  ensureDataDir();

  const filePath = getConversationPath(conversation.id);
  fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));
}

function listConversations() {
  ensureDataDir();

  const conversations = [];
  const files = fs.readdirSync(DATA_DIR);

  for (const filename of files) {
    if (filename.endsWith('.json')) {
      const filePath = path.join(DATA_DIR, filename);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      let winnerModel = null;

      for (let index = data.messages.length - 1; index >= 0; index -= 1) {
        const message = data.messages[index];
        if (!message || message.role !== 'assistant') {
          continue;
        }

        const aggregateRankings =
          message.metadata && Array.isArray(message.metadata.aggregate_rankings)
            ? message.metadata.aggregate_rankings
            : null;

        if (aggregateRankings && aggregateRankings[0] && typeof aggregateRankings[0].model === 'string') {
          const rankedWinner = aggregateRankings[0].model.trim();
          if (rankedWinner) {
            winnerModel = rankedWinner;
            break;
          }
        }

        if (message.stage3 && typeof message.stage3.model === 'string' && message.stage3.model.trim()) {
          winnerModel = message.stage3.model.trim();
          break;
        }
      }

      const winnerLabel = winnerModel ? winnerModel.split('/')[1] || winnerModel : null;
      conversations.push({
        id: data.id,
        created_at: data.created_at,
        title: data.title || 'New Conversation',
        message_count: data.messages.length,
        winner_model: winnerModel,
        winner_label: winnerLabel,
      });
    }
  }

  conversations.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return conversations;
}

function addUserMessage(conversationId, content) {
  const conversation = getConversation(conversationId);
  if (conversation === null) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  conversation.messages.push({ role: 'user', content });
  saveConversation(conversation);
}

function getLatestAssistantMessage(conversation) {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    if (conversation.messages[index] && conversation.messages[index].role === 'assistant') {
      return { message: conversation.messages[index], index };
    }
  }

  return null;
}

function startAssistantMessage(conversationId) {
  const conversation = getConversation(conversationId);
  if (conversation === null) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  conversation.messages.push({
    role: 'assistant',
    stage1: null,
    stage2: null,
    stage3: null,
    metadata: null,
    loading: {
      stage1: true,
      stage2: false,
      stage3: false,
    },
  });
  saveConversation(conversation);
}

function updateLatestAssistantMessage(conversationId, patch) {
  const conversation = getConversation(conversationId);
  if (conversation === null) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  const latest = getLatestAssistantMessage(conversation);
  if (!latest) {
    throw new Error(`Conversation ${conversationId} has no assistant message to update`);
  }

  conversation.messages[latest.index] = {
    ...latest.message,
    ...patch,
    loading: {
      ...(latest.message.loading || {}),
      ...((patch && patch.loading) || {}),
    },
  };

  saveConversation(conversation);
}

function completeAssistantMessage(conversationId, stage1, stage2, stage3, metadata = null) {
  updateLatestAssistantMessage(conversationId, {
    stage1,
    stage2,
    stage3,
    metadata,
    loading: {
      stage1: false,
      stage2: false,
      stage3: false,
    },
  });
}

function updateConversationTitle(conversationId, title) {
  const conversation = getConversation(conversationId);
  if (conversation === null) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  conversation.title = title;
  saveConversation(conversation);
}

module.exports = {
  ensureDataDir,
  createConversation,
  getConversation,
  deleteConversation,
  saveConversation,
  listConversations,
  addUserMessage,
  startAssistantMessage,
  updateLatestAssistantMessage,
  completeAssistantMessage,
  updateConversationTitle,
};
