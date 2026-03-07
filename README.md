# LLM Council

![llmcouncil](header.jpg)

> **Note:** This is a Node.js conversion of the original [llm-council](https://github.com/karpathy/llm-council) by [Andrej Karpathy](https://github.com/karpathy). The Python/FastAPI backend has been replaced with Node.js/Express while keeping identical API behavior and the same React frontend.

The idea of this repo is that instead of asking a question to your favorite LLM provider (e.g. OpenAI GPT 5.1, Google Gemini 3.0 Pro, Anthropic Claude Sonnet 4.5, xAI Grok 4, etc.), you can group them into your "LLM Council". This repo is a simple, local web app that essentially looks like ChatGPT except it uses OpenRouter to send your query to multiple LLMs, it then asks them to review and rank each other's work, and finally a Chairman LLM produces the final response.

In a bit more detail, here is what happens when you submit a query:

1. **Stage 1: First opinions**. The user query is given to all LLMs individually, and the responses are collected. The individual responses are shown in a "tab view", so that the user can inspect them all one by one.
2. **Stage 2: Review**. Each individual LLM is given the responses of the other LLMs. Under the hood, the LLM identities are anonymized so that the LLM can't play favorites when judging their outputs. The LLM is asked to rank them in accuracy and insight.
3. **Stage 3: Final response**. The designated Chairman of the LLM Council takes all of the model's responses and compiles them into a single final answer that is presented to the user.

## Setup

### 1. Install Dependencies

**Backend:**
```bash
cd backend
npm install
cd ..
```

**Frontend:**
```bash
cd frontend
npm install
cd ..
```

### 2. Configure API Key

Create a `.env` file in the project root:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Get your API key at [openrouter.ai](https://openrouter.ai/). Make sure to purchase the credits you need, or sign up for automatic top up.

### 3. Configure Models (Optional)

Edit `backend/config.js` to customize the council:

```js
const COUNCIL_MODELS = [
  'openai/gpt-5.1',
  'google/gemini-3-pro-preview',
  'anthropic/claude-sonnet-4.5',
  'x-ai/grok-4',
];

const CHAIRMAN_MODEL = 'google/gemini-3-pro-preview';
```

### 4. Configure ChatGPT and Claude OAuth (Optional)

This app now supports provider OAuth for ChatGPT and Claude. If connected, OpenAI/Anthropic-prefixed models are attempted via provider OAuth first and then fall back to OpenRouter if OAuth calls fail.

There is no universal "default endpoint" you can assume here. You must use OAuth authorize/token URLs from OAuth apps you create/configure with each provider.

Add provider credentials and endpoints to `.env`:

```bash
# Server URLs
APP_BASE_URL=http://localhost:8001
FRONTEND_BASE_URL=http://localhost:5173

# OpenAI (ChatGPT) OAuth
OPENAI_OAUTH_CLIENT_ID=
OPENAI_OAUTH_CLIENT_SECRET=
OPENAI_OAUTH_AUTHORIZE_URL=
OPENAI_OAUTH_TOKEN_URL=
OPENAI_OAUTH_SCOPE=openid profile email offline_access

# Anthropic (Claude) OAuth
ANTHROPIC_OAUTH_CLIENT_ID=
ANTHROPIC_OAUTH_CLIENT_SECRET=
ANTHROPIC_OAUTH_AUTHORIZE_URL=
ANTHROPIC_OAUTH_TOKEN_URL=
ANTHROPIC_OAUTH_SCOPE=openid profile email offline_access
```

Set your OAuth app callback URLs to:
- `http://localhost:8001/api/auth/openai/callback`
- `http://localhost:8001/api/auth/anthropic/callback`

After server restart, use the sidebar **Provider OAuth** section to connect or disconnect each provider.

## Running the Application

**Option 1: Use the start script**
```bash
./start.sh
```

**Option 2: Run manually**

Terminal 1 (Backend):
```bash
cd backend
node server.js
```

Terminal 2 (Frontend):
```bash
cd frontend
npm run dev
```

Then open http://localhost:5173 in your browser.

## Tech Stack

- **Backend:** Node.js/Express, native fetch, OpenRouter API, OAuth provider integrations
- **Frontend:** React + Vite, react-markdown for rendering
- **Storage:** JSON files in `data/conversations/` plus `data/oauth_tokens.json`
