const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const COUNCIL_MODELS = [
  'openai/gpt-5.1',
  'google/gemini-3-pro-preview',
  'anthropic/claude-sonnet-4.5',
  'x-ai/grok-4',
];

const CHAIRMAN_MODEL = 'google/gemini-3-pro-preview';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const DATA_DIR = path.join(__dirname, '..', 'data', 'conversations');

module.exports = {
  OPENROUTER_API_KEY,
  COUNCIL_MODELS,
  CHAIRMAN_MODEL,
  OPENROUTER_API_URL,
  DATA_DIR,
};
