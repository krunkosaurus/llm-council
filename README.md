# LLM Council

![llmcouncil](header.jpg)

> **Note:** This is a Node.js conversion of the original [llm-council](https://github.com/karpathy/llm-council) by [Andrej Karpathy](https://github.com/karpathy).

This repo runs an "LLM Council" flow with provider-backed model selection:
- ChatGPT (`openai/*`) via OAuth
- Claude (`anthropic/*`) via OAuth
- Manus (`manus/*`) via API key
- Optional third-party OpenAI-compatible endpoints from `providers.json`

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

# Optional: override provider defaults shown in the dropdowns
OPENAI_DEFAULT_MODEL=openai/gpt-5.4
ANTHROPIC_DEFAULT_MODEL=anthropic/claude-sonnet-4-6
MANUS_DEFAULT_MODEL=manus/manus-1.6

# Manus API
MANUS_API_KEY=
# Optional: defaults to https://api.manus.ai
# MANUS_API_URL=https://api.manus.ai

# Optional advanced overrides (defaults already match opencode behavior)
# OPENAI_OAUTH_ISSUER=https://auth.openai.com
# OPENAI_OAUTH_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
# OPENAI_CODEX_API_URL=https://chatgpt.com/backend-api/codex/responses
# ANTHROPIC_OAUTH_CLIENT_ID=9d1c250a-e61b-44d9-88ed-5944d1962f5e
# ANTHROPIC_OAUTH_AUTHORIZE_URL_MAX=https://claude.ai/oauth/authorize
# ANTHROPIC_OAUTH_TOKEN_URL=https://console.anthropic.com/v1/oauth/token
# ANTHROPIC_OAUTH_REDIRECT_URI=https://console.anthropic.com/oauth/code/callback

# Optional: override where third-party compatible provider definitions are loaded from
# THIRD_PARTY_PROVIDER_CONFIG_PATH=./providers.json
```

Optional `providers.json` in the project root can add third-party OpenAI-compatible endpoints. The format intentionally matches the subset of opencode config you posted:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (Tailscale)",
      "options": {
        "baseURL": "http://100.72.239.3:1234/v1"
      },
      "models": {
        "qwen3.5-35b-a3b-mlx-lm": {
          "name": "qwen3.5-35b-a3b-mlx-lm",
          "requestBody": {
            "enable_thinking": false
          }
        }
      }
    }
  },
  "model": "lmstudio/qwen3.5-35b-a3b-mlx-lm"
}
```

For third-party OpenAI-compatible providers, optional request overrides can be set at either level:
- `provider.<id>.options.requestBody`: applied to every request for that provider
- `provider.<id>.models.<model>.requestBody`: applied only for that model

Model-level keys override provider-level keys. These fields are merged into the JSON body sent to `/chat/completions`.

After starting the app, use sidebar **Providers**:
- ChatGPT: browser callback flow (automatic)
- Claude: code-paste flow (same style opencode uses)
- Manus: enabled automatically when `MANUS_API_KEY` is set
- Third-party OpenAI-compatible endpoints: enabled automatically from `providers.json`
- Each connected provider exposes a model dropdown in the sidebar.
- The selected model is persisted per provider and reused on restart.

Notes:
- ChatGPT OAuth uses a local callback listener on `http://localhost:1455/auth/callback`.
- If connect fails immediately, make sure port `1455` is free.
- If no saved selection exists, the app falls back to each provider's configured default model env var, then the first model in that provider's catalog.
- Manus tasks use the official REST API at `MANUS_API_URL` and poll until completion.

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

- Supported model prefixes are `openai/*`, `anthropic/*`, `manus/*`, and any provider ids loaded from `providers.json`.
- Stage 1 and Stage 2 run against the currently selected model for each connected provider.
- The chairman model is the first connected provider in the built-in order: OpenAI, Anthropic, Manus, then any third-party providers.
- If a provider is not connected, its models return no response.
- If both providers fail or are disconnected, the request returns an all-models-failed error.
- OAuth tokens are refreshed automatically when providers return refresh tokens.

## Storage

- Conversations: `data/conversations/*.json`
- OAuth tokens: `data/oauth_tokens.json`
- Provider model selections: `data/provider_settings.json`
- Optional third-party provider config: `providers.json`
