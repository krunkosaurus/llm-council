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
      conversations.push({
        id: data.id,
        created_at: data.created_at,
        title: data.title || 'New Conversation',
        message_count: data.messages.length,
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

function addAssistantMessage(conversationId, stage1, stage2, stage3) {
  const conversation = getConversation(conversationId);
  if (conversation === null) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  conversation.messages.push({
    role: 'assistant',
    stage1,
    stage2,
    stage3,
  });
  saveConversation(conversation);
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
  saveConversation,
  listConversations,
  addUserMessage,
  addAssistantMessage,
  updateConversationTitle,
};
