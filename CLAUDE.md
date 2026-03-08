# CLAUDE.md - Technical Notes for LLM Council

## Project Overview

LLM Council is a 3-stage deliberation system:
1. Collect responses from each model.
2. Have models rank anonymized responses.
3. Synthesize a final chairman response.

This codebase supports mixed provider transports:
- `openai/*` models use ChatGPT OAuth access tokens.
- `anthropic/*` models use Claude OAuth access tokens.
- `manus/*` models use `MANUS_API_KEY`.
- Extra provider ids can be loaded from `providers.json` when they are OpenAI-compatible.

## Backend Architecture

### `backend/config.js`
- Loads `.env`.
- `OPENAI_DEFAULT_MODEL` defaults to `openai/gpt-5.4`.
- `ANTHROPIC_DEFAULT_MODEL` defaults to `anthropic/claude-sonnet-4-6`.
- `MANUS_DEFAULT_MODEL` defaults to `manus/manus-1.6`.
- `MANUS_TASK_TIMEOUT_MS` defaults to `300000`, so Manus can finish longer agent-style tasks before the council skips it.
- Merges built-in providers with optional OpenAI-compatible entries from `providers.json`.

### `backend/oauth.js`
- Implements OAuth state/PKCE flow.
- Provides:
  - provider status
  - auth URL generation
  - callback token exchange
  - code-completion exchange (Claude flow)
  - refresh-token handling
  - disconnect

### `backend/oauthStorage.js`
- Persists provider token payloads in `data/oauth_tokens.json`.

### `backend/modelClients.js`
- Provider-based model routing.
- Supports built-in OpenAI, Claude, Manus, and configured OpenAI-compatible providers.
- Unsupported providers return `null`.
- Missing credentials return `null`.

### `backend/council.js`
- Runs all 3 council stages.
- Chairman selection follows configured provider order and only uses connected providers.

### `backend/server.js`
- REST + SSE conversation APIs.
- OAuth endpoints:
  - `GET /api/auth/providers`
  - `GET /api/auth/:provider/start`
  - `GET /api/auth/:provider/callback`
  - `POST /api/auth/:provider/complete`
  - `POST /api/auth/:provider/disconnect`

## Frontend Notes

### `frontend/src/App.jsx` + `components/Sidebar.jsx`
- Sidebar includes provider connect controls plus env/config-backed providers.
- Uses popup callback flow for ChatGPT and manual code-paste completion for Claude.

### `frontend/src/api.js`
- Includes provider status/start/complete/disconnect/model-selection API client functions.

## Operational Constraints

- If a provider is not connected, its models cannot respond.
- If all models fail/disconnected, the request returns the all-models-failed error path.
- Node 18+ is required (`fetch`, `AbortSignal.timeout`).

## Data Paths

- Conversations: `data/conversations/*.json`
- OAuth tokens: `data/oauth_tokens.json`
- Provider model selections: `data/provider_settings.json`
