# LLM Council

![llmcouncil](header.jpg)

> **Note:** This is a Node.js conversion of the original [llm-council](https://github.com/karpathy/llm-council) by [Andrej Karpathy](https://github.com/karpathy).

This repo runs an "LLM Council" flow with two providers only:
- ChatGPT (`openai/*`) via OAuth
- Claude (`anthropic/*`) via OAuth

There is no OpenRouter fallback in this codebase.

When you submit a query:
1. **Stage 1**: each model gives an independent answer.
2. **Stage 2**: each model reviews/ranks anonymized answers.
3. **Stage 3**: the chairman model synthesizes a final answer.

## Setup

### 1. Install dependencies

Backend:
```bash
cd backend
npm install
cd ..
```

Frontend:
```bash
cd frontend
npm install
cd ..
```

### 2. Configure OAuth

Create `.env` in the project root:

```bash
# Server URLs
APP_BASE_URL=http://localhost:8001
FRONTEND_BASE_URL=http://localhost:5173

# Optional: override model list/chairman
COUNCIL_MODELS=openai/gpt-5.1,anthropic/claude-sonnet-4.5
CHAIRMAN_MODEL=openai/gpt-5.1

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

Set OAuth app callbacks to:
- `http://localhost:8001/api/auth/openai/callback`
- `http://localhost:8001/api/auth/anthropic/callback`

After starting the app, use sidebar **Provider OAuth** to connect providers.

## Run

Option 1:
```bash
./start.sh
```

Option 2:

Terminal 1 (backend):
```bash
cd backend
node server.js
```

Terminal 2 (frontend):
```bash
cd frontend
npm run dev
```

Open http://localhost:5173.

## Behavior Rules

- Only `openai/*` and `anthropic/*` models are supported.
- If a provider is not connected, its models return no response.
- If both providers fail or are disconnected, the request returns an all-models-failed error.

## Storage

- Conversations: `data/conversations/*.json`
- OAuth tokens: `data/oauth_tokens.json`
