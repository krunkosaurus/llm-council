# CLAUDE.md - Technical Notes for LLM Council

## Project Overview

LLM Council is a 3-stage deliberation system:
1. Collect responses from each model.
2. Have models rank anonymized responses.
3. Synthesize a final chairman response.

This codebase is **OAuth-only** for model calls:
- `openai/*` models use ChatGPT OAuth access tokens.
- `anthropic/*` models use Claude OAuth access tokens.
- No OpenRouter path exists.

## Backend Architecture

### `backend/config.js`
- Loads `.env`.
- `OPENAI_DEFAULT_MODEL` defaults to `openai/gpt-5.4`.
- `ANTHROPIC_DEFAULT_MODEL` defaults to `anthropic/claude-sonnet-4-6`.
- OAuth defaults are hardcoded to match opencode-style flows (with optional env overrides).

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
- Only supports `openai/*` and `anthropic/*`.
- Unsupported providers return `null`.
- Missing/disconnected OAuth tokens return `null`.

### `backend/council.js`
- Runs all 3 council stages.
- Title generation uses OAuth models in order:
  - `openai/gpt-5.1`
  - `anthropic/claude-sonnet-4.5`

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
- Sidebar includes provider OAuth connect/disconnect controls.
- Uses popup callback flow for ChatGPT and manual code-paste completion for Claude.

### `frontend/src/api.js`
- Includes OAuth API client functions for provider status/start/complete/disconnect.

## Operational Constraints

- If a provider is not connected, its models cannot respond.
- If all models fail/disconnected, the request returns the all-models-failed error path.
- Node 18+ is required (`fetch`, `AbortSignal.timeout`).

## Data Paths

- Conversations: `data/conversations/*.json`
- OAuth tokens: `data/oauth_tokens.json`
