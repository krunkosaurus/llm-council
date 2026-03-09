# OpenCouncil — Master Specification v1

## 1. Product Overview

OpenCouncil is a consensus-oriented LLM advisory council app. Users define **personas** (e.g., "Singapore Crypto Lawyer", "Decentralization Advocate", "SEA VC Partner") backed by ChatGPT or Claude models. These advisors debate a user's question in structured rounds, pushing toward majority agreement with no strong objection. A built-in **moderator** synthesizes positions, tracks convergence, and produces the final recommendation.

**Key differentiator from llm-council:** Instead of a fixed 3-stage pipeline (respond → rank → synthesize), OpenCouncil runs a multi-round consensus loop where advisors rebut each other, converge, and collaboratively maintain a living working document.

---

## 2. Architecture

### 2.1 Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite, responsive (mobile-first) |
| Backend | Node.js + Express |
| Database | SQLite (via better-sqlite3) |
| File Storage | Local filesystem (`data/`) |
| Working Docs | Git-versioned markdown in `data/sessions/{id}/docs/` |
| Auth | OAuth (reused from llm-council) for ChatGPT & Claude |

### 2.2 Repository

New sibling repo: `~/repos/OpenCouncil/`

Reuses from llm-council:
- OAuth flow logic (oauth.js, oauthStorage.js)
- Model client adapters for OpenAI and Anthropic (modelClients.js)
- SSE streaming pattern
- Frontend markdown rendering

### 2.3 Directory Structure

```
OpenCouncil/
├── backend/
│   ├── server.js              # Express REST + SSE endpoints
│   ├── config.js              # Env vars, provider definitions (ChatGPT + Claude only)
│   ├── db.js                  # SQLite setup + migrations
│   ├── oauth.js               # OAuth flows (from llm-council)
│   ├── oauthStorage.js        # Token persistence (from llm-council)
│   ├── modelClients.js        # OpenAI + Anthropic adapters (from llm-council)
│   ├── council.js             # Consensus debate engine
│   ├── moderator.js           # Built-in moderator logic
│   ├── fileHandler.js         # Attachment upload + parsing
│   ├── workingDoc.js          # Git-versioned working document management
│   ├── export.js              # Markdown + PDF export
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx            # Root app + routing
│   │   ├── api.js             # Backend API client
│   │   ├── pages/
│   │   │   ├── HomePage.jsx        # Session list + quick-start
│   │   │   ├── PersonaLibrary.jsx  # CRUD personas
│   │   │   ├── SessionSetup.jsx    # Configure council + submit question
│   │   │   ├── SessionView.jsx     # Live debate + results
│   │   │   └── SettingsPage.jsx    # Provider connections
│   │   ├── components/
│   │   │   ├── Layout.jsx          # Responsive shell + nav
│   │   │   ├── PersonaCard.jsx     # Persona display/edit card
│   │   │   ├── AdvisorSeat.jsx     # Advisor config within session
│   │   │   ├── DebateRound.jsx     # Single round display
│   │   │   ├── ConsensusMeter.jsx  # Visual consensus indicator
│   │   │   ├── WorkingDocView.jsx  # Live working document
│   │   │   ├── SummaryPanel.jsx    # Final recommendation display
│   │   │   ├── AttachmentUpload.jsx # File/URL attachment UI
│   │   │   └── ExportMenu.jsx      # Export options
│   │   └── hooks/
│   │       ├── useSession.js       # Session state management
│   │       └── useProviders.js     # Provider auth state
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── data/
│   ├── opencouncil.db         # SQLite database
│   ├── oauth_tokens.json      # Provider tokens
│   ├── uploads/               # Uploaded attachments
│   └── sessions/              # Per-session working docs + exports
│       └── {session_id}/
│           ├── docs/           # Git-versioned working documents
│           └── exports/        # Generated exports
└── .env
```

---

## 3. Data Model (SQLite)

### 3.1 Schema

```sql
-- Reusable persona templates
CREATE TABLE personas (
  id TEXT PRIMARY KEY,           -- uuid
  name TEXT NOT NULL,            -- "Singapore Crypto Lawyer"
  description TEXT NOT NULL,     -- Brief role description
  system_prompt TEXT NOT NULL,   -- Full system prompt
  default_model TEXT NOT NULL,   -- "anthropic/claude-sonnet-4-6"
  created_at TEXT NOT NULL,      -- ISO 8601
  updated_at TEXT NOT NULL
);

-- A deliberation session
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- uuid
  title TEXT,                    -- Truncated from question (first 80 chars) on creation, user can override via PUT
  question TEXT NOT NULL,        -- The user's question/topic
  context TEXT,                  -- Additional background text
  status TEXT NOT NULL DEFAULT 'setup',
    -- setup | deliberating | paused | consensus_reached | hung
  max_rounds INTEGER NOT NULL DEFAULT 5,
  current_round INTEGER NOT NULL DEFAULT 0,
  working_doc_enabled INTEGER NOT NULL DEFAULT 0,  -- boolean: 0=off, 1=on
  moderator_model TEXT,                            -- e.g. 'anthropic/claude-opus-4-6', null=auto
  hung_reason TEXT,                                -- why consensus was not reached (set when status='hung')
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Advisors assigned to a session (snapshot of persona at time of creation)
CREATE TABLE session_advisors (
  id TEXT PRIMARY KEY,           -- uuid
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
  -- Snapshot fields (editable per-session without affecting base persona)
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  -- Why this advisor was added + what to focus on
  role_briefing TEXT,            -- "You are here because of your crypto regulatory expertise"
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Individual advisor turns within a round
CREATE TABLE debate_turns (
  id TEXT PRIMARY KEY,           -- uuid
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  advisor_id TEXT NOT NULL REFERENCES session_advisors(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  -- Content
  position TEXT NOT NULL,          -- The advisor's response/argument
  recommendation TEXT,             -- Their current recommendation
  confidence REAL,                 -- 0.0 to 1.0
  agreement_level TEXT,            -- 'agree' | 'mostly_agree' | 'disagree' | 'strongly_disagree'
  blocking_concerns TEXT,          -- JSON array of concerns
  what_would_change_mind TEXT,     -- What evidence/argument would shift them
  created_at TEXT NOT NULL
);

-- Moderator summaries per round
CREATE TABLE round_summaries (
  id TEXT PRIMARY KEY,           -- uuid
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  summary TEXT NOT NULL,           -- Agreements, disagreements, gaps
  consensus_status TEXT NOT NULL,  -- 'converging' | 'diverging' | 'near_consensus' | 'consensus' | 'hung'
  action_items TEXT,               -- JSON: what needs resolving
  created_at TEXT NOT NULL
);

-- Final session outcome
CREATE TABLE session_outcomes (
  id TEXT PRIMARY KEY,           -- uuid
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  final_recommendation TEXT NOT NULL,
  caveats TEXT,                    -- JSON array
  dissenting_views TEXT,           -- JSON array
  next_questions TEXT,             -- JSON array (if unresolved)
  created_at TEXT NOT NULL
);

-- File attachments
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,           -- uuid
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,         -- Relative path in data/uploads/
  content_text TEXT,               -- Extracted text content for LLM context
  created_at TEXT NOT NULL
);

-- Additional context provided when continuing a hung session
CREATE TABLE session_continuations (
  id TEXT PRIMARY KEY,           -- uuid
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  additional_context TEXT NOT NULL,  -- New info provided by user
  additional_rounds INTEGER NOT NULL DEFAULT 3,  -- Extra rounds granted
  continued_from_round INTEGER NOT NULL,  -- Round at which session was hung
  created_at TEXT NOT NULL
);

-- URL references
CREATE TABLE session_urls (
  id TEXT PRIMARY KEY,           -- uuid
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  fetched_content TEXT,            -- Extracted text for LLM context
  created_at TEXT NOT NULL
);
```

---

## 4. Consensus Debate Engine

### 4.1 Flow

```
User submits question + context + files/URLs + selects advisors
                    ↓
            ┌── ROUND 1 ──┐
            │              │
            │  Each advisor writes initial position     │
            │  (parallel, models browse web natively)   │
            │              │
            │  Moderator summarizes:                    │
            │    - Points of agreement                  │
            │    - Points of disagreement               │
            │    - Missing evidence/perspectives         │
            │    - Updates working document              │
            │              │
            │  Each advisor records:                    │
            │    - recommendation                       │
            │    - confidence (0-1)                     │
            │    - agreement_level                      │
            │    - blocking_concerns                    │
            │    - what_would_change_mind               │
            └──────────────┘
                    ↓
            Check consensus:
              - If majority agrees, no strong_disagree → CONSENSUS
              - If max_rounds reached → HUNG (pausable)
              - Otherwise → NEXT ROUND (advisors see prior round + moderator summary)
                    ↓
            Moderator produces final output:
              - Final recommendation
              - Caveats from each advisor
              - Dissenting views (if any)
              - Next questions (if hung)
              - Final working document update
```

### 4.2 Consensus Rules

**Majority agrees with no strong objection:**
- `consensus_reached`: >50% of advisors have `agreement_level` of `agree` or `mostly_agree`, AND zero advisors have `strongly_disagree`.
- `hung`: Max rounds reached without consensus. Session can be resumed with additional info.
- `strongly_disagree` from any advisor blocks consensus for that round and triggers the moderator to highlight the blocking concern prominently.

### 4.3 Advisor System Prompt Construction

Each advisor's messages are constructed as:

```
System: {persona.system_prompt}

You are participating in an advisory council deliberation.

YOUR ROLE BRIEFING: {session_advisor.role_briefing}

DELIBERATION RULES:
- Argue your position based on your expertise and perspective.
- Search the web for current information relevant to the question.
- Cite sources as [Source Title](URL) — only cite pages you have actually retrieved.
- Engage with other advisors' arguments directly.
- Push toward consensus, but do not agree if you have genuine concerns.
- After your argument, provide a structured assessment.

QUESTION: {session.question}

CONTEXT: {session.context}

ATTACHED MATERIALS: {summarized attachments and URLs}

{if round > 1}
PREVIOUS ROUND SUMMARY (by Moderator):
{round_summary.summary}

OTHER ADVISORS' POSITIONS:
{for each other advisor in previous round: name + position}
{end if}

Respond with:
1. Your detailed position/argument (cite sources if you browsed the web)
2. Then on separate lines:
RECOMMENDATION: [your one-line recommendation]
CONFIDENCE: [0.0-1.0]
AGREEMENT: [agree|mostly_agree|disagree|strongly_disagree]
BLOCKING_CONCERNS: [comma-separated list, or "none"]
WHAT_WOULD_CHANGE_MY_MIND: [what evidence or argument would shift your position]
```

### 4.4 Moderator System Prompt

The moderator model is user-selectable per session. If not set, defaults to the first connected provider's strongest model.

```
System: You are the council moderator. Your job is to:
1. Identify points of agreement across all advisors.
2. Identify points of disagreement and why they exist.
3. Highlight missing evidence or perspectives.
4. Assess whether the council is converging toward consensus.
{if working_doc_enabled}
5. Update the working document to reflect current state of deliberation.
{end if}

You are neutral. You do not advocate for any position.

ADVISOR POSITIONS THIS ROUND:
{for each advisor: name, role, position, recommendation, confidence, agreement_level, blocking_concerns}

{if working_doc_enabled AND working_document exists}
CURRENT WORKING DOCUMENT:
{working_document content}
{end if}

Respond with:
SUMMARY: [your synthesis of this round]

CONSENSUS_STATUS: [converging|diverging|near_consensus|consensus|hung]

ACTION_ITEMS: [what needs to be resolved next round, as JSON array]

{if working_doc_enabled}
WORKING_DOCUMENT_UPDATE:
[full updated markdown content for the working document, or "NO_CHANGE"]
{end if}
```

### 4.5 Final Outcome Moderator Prompt

When consensus is reached OR max rounds are exhausted, the moderator runs a **separate final prompt** to produce the session outcome:

```
System: You are the council moderator. The deliberation has ended.
{if consensus} Consensus was reached. {else} The council did not reach consensus (hung after {N} rounds). {end if}

FULL DELIBERATION HISTORY:
{for each round: moderator summary}

FINAL ADVISOR POSITIONS (last round):
{for each advisor: name, recommendation, confidence, agreement_level, blocking_concerns}

{if working_doc_enabled}
FINAL WORKING DOCUMENT:
{working_document content}
{end if}

Produce the final output:

FINAL_RECOMMENDATION: [comprehensive recommendation synthesizing all perspectives]

CAVEATS: [JSON array of strings — important qualifications, risks, or conditions]

DISSENTING_VIEWS: [JSON array of strings — any unresolved disagreements, with the advisor name and their concern]

{if not consensus}
NEXT_QUESTIONS: [JSON array of strings — what information or analysis would help resolve the remaining disagreements]
{end if}
```

### 4.6 Response Parsing

**Advisor response parsing:**
- Split response text on known labels: `RECOMMENDATION:`, `CONFIDENCE:`, `AGREEMENT:`, `BLOCKING_CONCERNS:`, `WHAT_WOULD_CHANGE_MY_MIND:`
- Everything before the first label is the `position` text
- `confidence`: parse as float, clamp to 0.0-1.0. **Default: 0.5** if unparseable
- `agreement_level`: match against known values. **Default: `mostly_agree`** if unparseable
- `blocking_concerns`: split on commas, trim, filter empty. Store as JSON array. `"none"` → `[]`
- `what_would_change_mind`: raw text after the label

**Moderator per-round response parsing:**
- Split on `SUMMARY:`, `CONSENSUS_STATUS:`, `ACTION_ITEMS:`, `WORKING_DOCUMENT_UPDATE:`
- `consensus_status`: match against known values. **Default: `converging`** if unparseable
- `action_items`: attempt JSON.parse. **Default: `[]`** if unparseable
- `working_document_update`: everything after the label. `"NO_CHANGE"` → skip update

**Moderator final outcome parsing:**
- Split on `FINAL_RECOMMENDATION:`, `CAVEATS:`, `DISSENTING_VIEWS:`, `NEXT_QUESTIONS:`
- Array fields: attempt JSON.parse. **Default: `[]`** if unparseable

### 4.7 Consensus Evaluation (after each round)

After parsing all advisor turns for a round:
1. Count advisors with `agreement_level` in (`agree`, `mostly_agree`) → `agree_count`
2. Check if any advisor has `agreement_level` = `strongly_disagree` → `has_blocker`
3. `total` = number of advisors
4. **Consensus reached** if: `agree_count > total / 2` AND `has_blocker === false`
5. **Hung** if: `current_round >= effective_max_rounds` where `effective_max_rounds = sessions.max_rounds + SUM(session_continuations.additional_rounds)`
6. Otherwise: proceed to next round

---

## 5. Working Document System

### 5.1 Overview

Each session can have a working document (`data/sessions/{id}/docs/working_doc.md`). The moderator is the sole editor; advisors may propose edits in their positions.

### 5.2 Git Versioning

- Each session's `docs/` directory is initialized as a git repo on first document creation.
- After each round, the moderator's document update is committed and tagged:
  ```
  git add working_doc.md
  git commit -m "Round {N}: {one-line summary from moderator}"
  git tag round-{N}
  ```
- Tags enable reliable diff between rounds (`git diff round-1 round-3`).
- The frontend can display the git log and diffs between rounds.

### 5.3 Implementation (workingDoc.js)

```javascript
// workingDoc.js exports
initWorkingDoc(sessionId)                    // git init in docs/
updateWorkingDoc(sessionId, content, roundNumber, commitMessage)  // write + commit + tag round-N
getWorkingDoc(sessionId)                     // read current content
getWorkingDocHistory(sessionId)              // git log with round tags
getWorkingDocDiff(sessionId, fromRound, toRound)  // git diff round-{from} round-{to}
```

---

## 6. Web Browsing

### 6.1 Approach

Both ChatGPT and Claude have **built-in web browsing** capabilities when accessed via their OAuth APIs. Rather than building a custom search/scrape layer, advisors are instructed in their system prompt to browse the web and cite sources. The models handle search natively through their own tool use.

### 6.2 System Prompt Instructions

Each advisor's system prompt includes:
```
- Search the web for current information relevant to the question.
- Cite sources as [Source Title](URL) in your argument.
- Do not fabricate sources — only cite pages you have actually retrieved.
```

### 6.3 Citation Format

Advisors cite sources as `[Source Title](URL)` in their positions. The frontend renders these as clickable links via react-markdown.

### 6.4 No Custom webBrowse.js Needed

Since web browsing is handled natively by the LLM providers, there is no `webBrowse.js` module. If a future provider lacks built-in browsing, one can be added later.

---

## 7. File Handling

### 7.1 Supported Types (v1)

| Type | Extension | Processing |
|------|-----------|-----------|
| PDF | .pdf | Extract text via pdf-parse |
| Markdown | .md | Read as-is |
| Plain text | .txt | Read as-is |
| URL | (pasted) | Fetch + extract text via fileHandler.js |

### 7.2 Implementation (fileHandler.js)

```javascript
// fileHandler.js exports
uploadFile(sessionId, file)                  // Save to data/uploads/, extract text, store in DB
getAttachmentText(attachmentId)              // Return extracted text
processUrl(sessionId, url)                   // Fetch, extract, store in DB
```

### 7.3 Storage

- Files saved to `data/uploads/{session_id}/{uuid}_{original_name}`
- Extracted text stored in `attachments.content_text` for inclusion in LLM context
- Max file size: 10MB per file

---

## 8. Export

### 8.1 Markdown Export

Generates a structured markdown document:

```markdown
# OpenCouncil Session: {title}

**Date:** {created_at}
**Status:** {status}
**Question:** {question}

## Council Members
{for each advisor: name, description, model}

## Deliberation

### Round 1
{for each advisor: position summary}
**Moderator Summary:** {round_summary}

### Round 2
...

## Final Recommendation
{final_recommendation}

### Caveats
{caveats}

### Dissenting Views
{dissenting_views}

## Working Document
{working_doc content}
```

### 8.2 PDF Export

Convert the markdown export to PDF using `md-to-pdf` or `puppeteer`.

### 8.3 Implementation (export.js)

```javascript
// export.js exports
exportMarkdown(sessionId)                    // Returns markdown string
exportPdf(sessionId)                         // Returns PDF buffer
```

---

## 9. API Endpoints

### 9.1 Health

```
GET /api/health
Response: { status: 'ok', service: 'OpenCouncil API' }
```

### 9.2 Auth (reused from llm-council)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/providers` | Provider connection status (includes available_models per provider) |
| GET | `/api/auth/:provider/start` | Start OAuth flow |
| GET | `/api/auth/:provider/callback` | OAuth callback |
| POST | `/api/auth/:provider/complete` | Complete code-paste flow |
| POST | `/api/auth/:provider/disconnect` | Disconnect provider |

`GET /api/auth/providers` response includes `available_models` per provider — this is used by the moderator model picker and per-advisor model override dropdowns. No separate `/api/models` endpoint needed.

### 9.3 Personas

```
GET /api/personas
Response: [{ id, name, description, system_prompt, default_model, created_at, updated_at }]

POST /api/personas
Body: { name, description, system_prompt, default_model }
Response: { id, name, description, system_prompt, default_model, created_at, updated_at }

GET /api/personas/:id
Response: { id, name, description, system_prompt, default_model, created_at, updated_at }

PUT /api/personas/:id
Body: { name?, description?, system_prompt?, default_model? }  (partial update)
Response: { id, name, description, system_prompt, default_model, created_at, updated_at }

DELETE /api/personas/:id
Response: { ok: true }
```

### 9.4 Sessions

**Session creation is a multi-step flow:**
1. `POST /api/sessions` — creates session in `setup` status
2. `POST /api/sessions/:id/advisors` — add advisors (one at a time)
3. `POST /api/sessions/:id/attachments` — upload files (optional)
4. `POST /api/sessions/:id/urls` — add URLs (optional)
5. `POST /api/sessions/:id/start` — begin deliberation (transitions to `deliberating`)

```
GET /api/sessions
Response: [{
  id, title, question, status, current_round, max_rounds,
  advisor_count, created_at, updated_at
}]

POST /api/sessions
Body: {
  question,                    // required
  title?,                      // optional — if omitted, auto-generated from question (first 80 chars)
  context?,                    // optional background text
  max_rounds?,                 // default 5
  working_doc_enabled?,        // default false
  moderator_model?             // default null (auto-select)
}
Response: { id, title, question, context, status, max_rounds, current_round,
            working_doc_enabled, moderator_model, hung_reason, created_at, updated_at }

GET /api/sessions/:id
Response: {
  // Session metadata
  id, title, question, context, status, max_rounds, current_round,
  working_doc_enabled, moderator_model, hung_reason, created_at, updated_at,

  // All advisors (snapshots)
  advisors: [{
    id, persona_id, name, description, system_prompt, model,
    role_briefing, created_at, updated_at
  }],

  // All debate turns grouped by round
  rounds: [{
    round_number,
    turns: [{
      id, advisor_id, advisor_name, position, recommendation,
      confidence, agreement_level, blocking_concerns, what_would_change_mind,
      created_at
    }],
    summary: {
      id, summary, consensus_status, action_items, created_at
    } | null
  }],

  // Final outcome (null if not yet reached)
  outcome: {
    id, final_recommendation, caveats, dissenting_views, next_questions, created_at
  } | null,

  // Attachments
  attachments: [{ id, filename, original_name, mime_type, created_at }],

  // URLs
  urls: [{ id, url, title, created_at }],

  // Continuations (if session was continued after being hung)
  continuations: [{ id, additional_context, additional_rounds, continued_from_round, created_at }]
}

PUT /api/sessions/:id
Allowed only when status='setup'. Can update: title, question, context,
max_rounds, working_doc_enabled, moderator_model.
Body: { title?, question?, context?, max_rounds?, working_doc_enabled?, moderator_model? }
Response: (same as GET /api/sessions/:id)

DELETE /api/sessions/:id
Response: { ok: true }
```

**Deliberation lifecycle:**

```
POST /api/sessions/:id/start
Precondition: status='setup', at least 1 advisor attached.
Transitions status: setup → deliberating.
Initializes working doc git repo if working_doc_enabled=true.
Returns: SSE stream (see Section 9.9).
On completion: status → consensus_reached | hung.

POST /api/sessions/:id/continue
Precondition: status='hung'.
Body: {
  additional_context,          // required: new info for advisors
  additional_rounds?           // default 3: how many more rounds to allow
}
Stores a session_continuations row.
Effective max_rounds = sessions.max_rounds + SUM(continuations.additional_rounds).
sessions.max_rounds is NOT mutated — the original value is preserved.
Transitions status: hung → deliberating.
Returns: SSE stream (see Section 9.9).
On completion: status → consensus_reached | hung.

POST /api/sessions/:id/stop
Precondition: status='deliberating'.
Transitions status: deliberating → paused.
Response: { ok: true }

POST /api/sessions/:id/resume
Precondition: status='paused'.
Transitions status: paused → deliberating.
Returns: SSE stream (continues from current_round).
```

**Status transitions:**
```
setup ──[start]──→ deliberating ──[consensus]──→ consensus_reached
                        │
                        ├──[max_rounds]──→ hung ──[continue]──→ deliberating
                        │
                        └──[stop]──→ paused ──[resume]──→ deliberating
```

### 9.5 Session Advisors

```
POST /api/sessions/:id/advisors
Precondition: status='setup'.
Body (from persona): { persona_id, role_briefing? }
Body (ad-hoc):       { name, description, system_prompt, model, role_briefing? }
Response: { id, persona_id, name, description, system_prompt, model, role_briefing, created_at, updated_at }

PUT /api/sessions/:id/advisors/:advisorId
Precondition: status='setup'.
Body: { name?, description?, system_prompt?, model?, role_briefing?, save_to_base? }
- save_to_base=false (default): updates session_advisors row only.
- save_to_base=true: also updates the linked personas row (name, description, system_prompt → personas; model → personas.default_model).
  Only works if persona_id is not null. Returns 400 if persona_id is null and save_to_base=true.
Response: { id, persona_id, name, description, system_prompt, model, role_briefing, created_at, updated_at, base_persona_updated: bool }

DELETE /api/sessions/:id/advisors/:advisorId
Precondition: status='setup'.
Response: { ok: true }
```

### 9.6 Attachments & URLs

```
POST /api/sessions/:id/attachments
Precondition: status='setup'.
Content-Type: multipart/form-data
Field name: "file" (single file per request)
Max size: 10MB.
Supported types: .pdf, .md, .txt
Response: { id, filename, original_name, mime_type, created_at }

GET /api/sessions/:id/attachments
Response: [{ id, filename, original_name, mime_type, created_at }]

DELETE /api/sessions/:id/attachments/:attachId
Response: { ok: true }

POST /api/sessions/:id/urls
Precondition: status='setup'.
Body: { url }
Backend fetches URL, extracts text, stores in session_urls.
Response: { id, url, title, created_at }

GET /api/sessions/:id/urls
Response: [{ id, url, title, created_at }]

DELETE /api/sessions/:id/urls/:urlId
Response: { ok: true }
```

### 9.7 Working Document

```
GET /api/sessions/:id/working-doc
Response: { content, updated_at } | null (if no working doc or not enabled)

GET /api/sessions/:id/working-doc/history
Response: [{ round_number, commit_hash, message, date }]
Note: Commits are tagged with lightweight git tags "round-N" for reliable lookup.

GET /api/sessions/:id/working-doc/diff?from=1&to=3
Response: { diff }  (unified diff text between two round tags)
```

### 9.8 Export

```
GET /api/sessions/:id/export/markdown
Response: text/markdown file download

GET /api/sessions/:id/export/pdf
Response: application/pdf file download
```

### 9.9 SSE Events (during deliberation)

```
event: round_start
data: { round: 1, max_rounds: 5 }

event: advisor_start
data: { advisor_id, name, model, round: 1 }

event: advisor_chunk
data: { advisor_id, round: 1, delta: "partial text..." }
Note: Streams position text incrementally for live UX.

event: advisor_complete
data: {
  advisor_id, name, model, round: 1,
  position, recommendation, confidence, agreement_level,
  blocking_concerns: ["..."],      // parsed JSON array
  what_would_change_mind
}

event: moderator_start
data: { round: 1 }

event: moderator_chunk
data: { round: 1, delta: "partial text..." }
Note: Streams moderator summary text incrementally for live UX.

event: moderator_complete
data: { round: 1, summary, consensus_status, action_items: ["..."] }

event: working_doc_update
data: { round: 1, content }
Only sent when working_doc_enabled=true.

event: round_complete
data: { round: 1, consensus_status }

event: consensus_reached
data: { round: N }

event: hung
data: { round: N, reason }
The reason is also stored in sessions.hung_reason.

event: outcome
data: {
  final_recommendation,
  caveats: ["..."],                // JSON arrays
  dissenting_views: ["..."],
  next_questions: ["..."]          // only for hung sessions
}

event: error
data: { message }

event: complete
data: {}
```

**Notes:**
- POST endpoints returning SSE streams is intentional — these endpoints have side effects (status transitions), so GET is not appropriate. The frontend opens the stream via `fetch()` POST and reads `response.body` as a ReadableStream, same pattern as llm-council.
- **Chunk buffering:** The frontend assembles `advisor_chunk` deltas into a display buffer per advisor, showing partial text live. On `advisor_complete`, the buffer is replaced with the fully parsed response. Same pattern for `moderator_chunk` / `moderator_complete`.

---

## 10. Frontend Pages

### 10.1 HomePage

- List of sessions with status badges (deliberating, consensus, hung, etc.)
- "New Council Session" button
- Quick access to Persona Library and Settings
- Mobile: single-column card list

### 10.2 PersonaLibrary

- Grid/list of saved personas
- Each card shows: name, description, default model
- Create/Edit/Delete
- Mobile: single-column list with swipe actions

### 10.3 SessionSetup

- Text input: question/topic
- Text area: additional context
- File upload zone (drag & drop on desktop, file picker on mobile)
- URL input with "Add" button
- Advisor selection:
  - "Add Advisor" → pick from persona library or create new
  - For each advisor: show name, model, editable role briefing
  - Can override model per-session
- Config: max rounds (default 5)
- Toggle: "Enable working document" (off by default, for plans/blueprints)
- Moderator model picker (dropdown of all connected models, default: auto)
- "Start Deliberation" button
- Mobile: stacked vertical layout, collapsible advisor cards

### 10.4 SessionView

- **Header:** Session title, status badge, consensus meter
- **Summary tab (default):**
  - Current recommendation (if consensus reached)
  - Caveats and dissenting views
  - Round-by-round moderator summaries (collapsed by default)
- **Debate tab:**
  - Full transcript, round by round
  - Each advisor's position with agreement indicators
  - Color-coded: green (agree), yellow (mostly_agree), orange (disagree), red (strongly_disagree)
- **Working Document tab:**
  - Current document content (rendered markdown)
  - Version history sidebar (git log)
  - Diff view between rounds
- **Actions:**
  - Continue (if hung/paused) — add more info text area
  - Export (markdown/PDF)
  - Stop (if deliberating)
- Mobile: tabs as bottom nav or swipeable panels

### 10.5 SettingsPage

- Provider connection cards (ChatGPT, Claude)
- OAuth connect/disconnect
- Provider status display
- Mobile: full-width cards

---

## 11. Responsive Design

### 11.1 Breakpoints

| Breakpoint | Width | Layout |
|-----------|-------|--------|
| Mobile | < 640px | Single column, bottom nav, stacked cards |
| Tablet | 640-1024px | Two-column where appropriate |
| Desktop | > 1024px | Full sidebar + content layout |

### 11.2 Mobile Considerations

- Touch-friendly tap targets (min 44px)
- Bottom navigation bar (Home, Personas, Settings)
- Swipeable tabs in SessionView
- Collapsible sections for long content
- File upload via native file picker
- No hover-dependent interactions

### 11.3 CSS Framework

Use Tailwind CSS for utility-first responsive styling.

---

## 12. Dependencies

### 12.1 Backend

```json
{
  "dependencies": {
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "uuid": "^11.1.0",
    "better-sqlite3": "^11.0.0",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^1.1.1",
    "cheerio": "^1.0.0",
    "md-to-pdf": "^5.0.0",
    "simple-git": "^3.27.0"
  }
}
```

- `cheerio` — extract text from fetched HTML pages (URL attachment processing in fileHandler.js)
- `md-to-pdf` — pulls in puppeteer/chromium as a transitive dependency for PDF rendering

### 12.2 Frontend

```json
{
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.0.0",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  }
}
```

### 12.3 Dev Dependencies (root)

```json
{
  "devDependencies": {
    "vitest": "^3.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "jsdom": "^25.0.0"
  }
}
```

---

## 13. Environment Variables

```bash
# Server
PORT=8002
HOST=0.0.0.0

# URLs (use Tailscale IP for remote access)
APP_BASE_URL=http://100.117.3.83
FRONTEND_BASE_URL=http://100.117.3.83

# CORS (include Tailscale IP with both default and Vite dev ports)
CORS_ALLOWED_ORIGINS=http://100.117.3.83,http://100.117.3.83:5174

# OpenAI OAuth
OPENAI_OAUTH_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
OPENAI_OAUTH_ISSUER=https://auth.openai.com
OPENAI_OAUTH_LOCAL_CALLBACK_PORT=1456
OPENAI_OAUTH_REDIRECT_URI=http://localhost:1456/auth/callback
OPENAI_OAUTH_USE_LOCAL_CALLBACK=1
OPENAI_OAUTH_MANUAL_CODE_FLOW=1

# Anthropic OAuth
ANTHROPIC_OAUTH_CLIENT_ID=9d1c250a-e61b-44d9-88ed-5944d1962f5e
ANTHROPIC_OAUTH_REDIRECT_URI=https://console.anthropic.com/oauth/code/callback
ANTHROPIC_OAUTH_TOKEN_URL=https://console.anthropic.com/v1/oauth/token

# Anthropic API
ANTHROPIC_MAX_TOKENS=8192

# Default models
OPENAI_DEFAULT_MODEL=openai/gpt-5.4
ANTHROPIC_DEFAULT_MODEL=anthropic/claude-sonnet-4-6
```

---

## 14. OAuth Implementation Guide

This section documents exactly how OAuth works in the llm-council codebase so it can be ported correctly to OpenCouncil. The current working setup uses **Tailscale IP** (`100.117.3.83`) for remote access.

### 14.1 Working .env Configuration (Tailscale)

The current llm-council `.env` that works:

```bash
# Tailscale IP of the machine running the server (Mac Mini)
APP_BASE_URL=http://100.117.3.83
FRONTEND_BASE_URL=http://100.117.3.83

# OpenAI OAuth — uses LOCAL callback server + manual code-paste flow
OPENAI_OAUTH_REDIRECT_URI=http://localhost:1455/auth/callback
OPENAI_OAUTH_USE_LOCAL_CALLBACK=1
OPENAI_OAUTH_MANUAL_CODE_FLOW=1

# Anthropic OAuth — uses Anthropic's hosted callback page
ANTHROPIC_OAUTH_REDIRECT_URI=https://console.anthropic.com/oauth/code/callback

# CORS — must include the Tailscale IP so the browser can call the API
CORS_ALLOWED_ORIGINS=http://100.117.3.83,http://100.117.3.83:5173
```

**Why Tailscale matters:** When accessing the app from another device on the Tailscale network (e.g., phone or laptop), the browser is at `http://100.117.3.83:{vite_port}` (Vite dev) or `http://100.117.3.83` (production). The frontend auto-detects the API base from `window.location.hostname` + backend port, so API calls go to `http://100.117.3.83:{backend_port}`. CORS must allow this origin. (For llm-council: ports 5173/8001. For OpenCouncil: ports 5174/8002.)

### 14.2 OpenAI (ChatGPT) OAuth Flow

OpenAI uses a **PKCE authorization code flow** with two possible callback modes:

#### Mode: Local Callback Server + Manual Code Paste (current working setup)

When `OPENAI_OAUTH_USE_LOCAL_CALLBACK=1` AND `OPENAI_OAUTH_MANUAL_CODE_FLOW=1`:

```
1. User clicks "Connect ChatGPT"
   ↓
2. Frontend: GET /api/auth/openai/start
   ↓
3. Backend generates:
   - state (random 24 bytes, base64url)
   - code_verifier (random 48 bytes, base64url)
   - code_challenge = SHA256(code_verifier), base64url
   - Stores { code_verifier, created_at } keyed by state in pendingOpenAIStates Map
   ↓
4. Backend returns:
   {
     provider: 'openai',
     method: 'code',           ← because MANUAL_CODE_FLOW=1
     auth_url: 'https://auth.openai.com/oauth/authorize?...',
     flow_id: <state>,
     instructions: 'After approval, copy the full callback URL...'
   }
   ↓
5. Frontend opens popup to auth_url
   Frontend shows code-paste modal (same as Claude flow)
   ↓
6. User approves in ChatGPT popup
   Browser redirects to http://localhost:1455/auth/callback?code=X&state=Y
   (This will FAIL if not on the same machine — that's OK in manual mode)
   User copies the full URL from browser address bar
   ↓
7. User pastes URL into modal
   Frontend: POST /api/auth/openai/complete { flow_id: <state>, code: <pasted URL> }
   ↓
8. Backend parseOpenAIAuthorizationCode() extracts code and state from URL
   ↓
9. Backend exchanges code for token:
   POST https://auth.openai.com/oauth/token
   Body: {
     grant_type: 'authorization_code',
     code: <code>,
     redirect_uri: 'http://localhost:1455/auth/callback',
     client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
     code_verifier: <stored verifier>
   }
   ↓
10. Backend extracts account_id from JWT claims (id_token or access_token)
    Stores token in data/oauth_tokens.json
    ↓
11. Frontend refreshes provider status → shows "Connected"
```

**Key details:**
- `OPENAI_OAUTH_CLIENT_ID` = `app_EMoamEEZ73f0CkXaXp7hrann` (hardcoded default)
- `OPENAI_OAUTH_SCOPE` = `openid profile email offline_access`
- The authorize URL includes `codex_cli_simplified_flow=true` and `originator=opencode`
- The redirect_uri sent to OpenAI's token endpoint MUST match what was in the authorize URL
- `account_id` is extracted from JWT claims: `chatgpt_account_id` or `https://api.openai.com/auth.chatgpt_account_id` or `organizations[0].id`

#### Mode: Auto Local Callback (alternative, for same-machine use)

When `OPENAI_OAUTH_USE_LOCAL_CALLBACK=1` but `OPENAI_OAUTH_MANUAL_CODE_FLOW` is NOT set:

- Backend spins up a one-off HTTP server on port 1455 (`ensureOpenAICallbackServer()`)
- The popup redirects to `http://localhost:1455/auth/callback`
- The local server handles the callback directly, exchanges the code, stores the token
- Returns an HTML page saying "ChatGPT connected successfully"
- Frontend polls `GET /api/auth/providers` every 1.2s until `connected=true`, then closes popup

**This only works when the browser is on the same machine as the server** (localhost must resolve to the server). Does NOT work from a phone over Tailscale.

#### Mode: Backend Callback (not currently used)

When `OPENAI_OAUTH_USE_LOCAL_CALLBACK` is NOT set:
- `OPENAI_OAUTH_REDIRECT_URI` defaults to `{APP_BASE_URL}/api/auth/openai/callback`
- The main Express server handles `GET /api/auth/:provider/callback`
- This would work over Tailscale IF OpenAI accepted the Tailscale IP as a redirect_uri (it likely doesn't, since OAuth providers require pre-registered redirect URIs)

### 14.3 Anthropic (Claude) OAuth Flow

Anthropic uses a **code-paste flow** — the user manually copies the authorization code from Anthropic's callback page.

```
1. User clicks "Connect Claude"
   ↓
2. Frontend: GET /api/auth/anthropic/start
   ↓
3. Backend generates:
   - code_verifier (random 48 bytes, base64url)
   - code_challenge = SHA256(code_verifier), base64url
   - state = code_verifier (reused as state — this is intentional)
   - flow_id (separate random 24 bytes, base64url)
   - Stores { code_verifier, state, created_at } in pendingAnthropicFlows keyed by flow_id
   - Also stores { code_verifier, created_at } in pendingAnthropicStates keyed by state
   ↓
4. Backend returns:
   {
     provider: 'anthropic',
     method: 'code',
     auth_url: 'https://claude.ai/oauth/authorize?...',
     flow_id: <flow_id>,
     instructions: 'After approval, copy the authorization code...'
   }

   Authorize URL params:
   - code=true
   - client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e
   - response_type=code
   - redirect_uri=https://console.anthropic.com/oauth/code/callback
   - scope=org:create_api_key user:profile user:inference
   - code_challenge=<challenge>
   - code_challenge_method=S256
   - state=<code_verifier>
   ↓
5. Frontend opens popup to auth_url
   Frontend shows code-paste modal with instructions
   ↓
6. User approves in Claude popup
   Claude redirects to https://console.anthropic.com/oauth/code/callback?code=X&state=Y
   Anthropic's callback page shows the code (or URL contains it)
   User copies the code (or full URL) and pastes into modal
   ↓
7. Frontend: POST /api/auth/anthropic/complete { flow_id: <flow_id>, code: <pasted text> }
   ↓
8. Backend parseAnthropicAuthorizationCode() extracts code from:
   - Full URL (parses query params)
   - URL with hash fragment
   - Raw code string
   - code#state format
   ↓
9. Backend exchanges code for token:
   POST https://console.anthropic.com/v1/oauth/token
   Body (JSON): {
     code: <code>,
     state: <state>,
     grant_type: 'authorization_code',
     client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
     redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
     code_verifier: <stored verifier>
   }
   ↓
10. Backend stores token in data/oauth_tokens.json
    ↓
11. Frontend refreshes provider status → shows "Connected"
```

**Key details:**
- `ANTHROPIC_OAUTH_CLIENT_ID` = `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (hardcoded default)
- `ANTHROPIC_OAUTH_REDIRECT_URI` = `https://console.anthropic.com/oauth/code/callback` — this is Anthropic's own hosted page, NOT your server
- `ANTHROPIC_OAUTH_AUTHORIZE_URL_MAX` = `https://claude.ai/oauth/authorize`
- `ANTHROPIC_OAUTH_TOKEN_URL` = `https://console.anthropic.com/v1/oauth/token`
- The `state` parameter IS the `code_verifier` itself (intentional design in this codebase)
- This flow works identically whether accessed locally or via Tailscale, since the redirect goes to Anthropic's domain

### 14.4 Token Storage & Refresh

**Storage:** Tokens are saved in `data/oauth_tokens.json`:
```json
{
  "openai": {
    "access_token": "...",
    "refresh_token": "...",
    "token_type": "Bearer",
    "scope": "openid profile email offline_access",
    "expires_at": "2026-03-10T12:00:00.000Z",
    "obtained_at": "2026-03-09T12:00:00.000Z",
    "account_id": "..."
  },
  "anthropic": {
    "access_token": "...",
    "refresh_token": "...",
    "token_type": "Bearer",
    "scope": "org:create_api_key user:profile user:inference",
    "expires_at": "2026-03-10T12:00:00.000Z",
    "obtained_at": "2026-03-09T12:00:00.000Z"
  }
}
```

**Refresh logic (`getProviderAuthorization`):**
1. Check if token exists and has `access_token` → if not, return null
2. Check if token is expiring (within 60s of `expires_at`) or `forceRefresh` requested
3. If not expiring and not forced → return current token
4. If expiring but no `refresh_token` → return current token (will fail on use)
5. If refresh already in-flight for this provider → await it (dedup)
6. Otherwise, start refresh:
   - **OpenAI:** POST to `https://auth.openai.com/oauth/token` with `grant_type=refresh_token`
   - **Anthropic:** POST to `https://console.anthropic.com/v1/oauth/token` with `grant_type=refresh_token`
7. Save refreshed token, return it
8. On refresh failure → log error, return old token (will likely fail on use)

**Retry on 401/403 (OpenAI only):**
The `queryViaOpenAIOAuth` function has a multi-step retry:
1. Try with `ChatGPT-Account-Id` header
2. If 401/403 → try without the account ID header
3. If still 401/403 → force-refresh the token
4. Try again with refreshed token + account ID header
5. If still 401/403 → try refreshed token without account ID header

### 14.5 How API Calls Use Tokens

**OpenAI (ChatGPT):**
- Endpoint: `https://chatgpt.com/backend-api/codex/responses`
- Uses the Codex Responses API format (NOT standard Chat Completions)
- Headers: `Authorization: Bearer <access_token>`, `ChatGPT-Account-Id: <account_id>`, `originator: llm-council`
- Payload: `{ model, instructions, input: [{role, content: [{type: 'input_text', text}]}], stream: true, store: false }`
- Response is SSE streamed, parsed for `response.output_text.delta` events
- Model names strip `openai/` prefix (e.g., `openai/gpt-5.4` → `gpt-5.4`)
- Fetches model-specific instructions from OpenAI's GitHub repo and caches them

**Anthropic (Claude):**
- Endpoint: `https://api.anthropic.com/v1/messages?beta=true`
- Standard Messages API format
- Headers: `Authorization: Bearer <access_token>`, `anthropic-version: 2023-06-01`, `anthropic-beta: oauth-2025-04-20,interleaved-thinking-2025-05-14`, `user-agent: claude-cli/2.1.2 (external, cli)`
- Payload: `{ model, max_tokens: 8192, messages: [{role, content}], system?: string }`
- Model names strip `anthropic/` prefix and replace dots with dashes (e.g., `anthropic/claude-sonnet-4-6` → `claude-sonnet-4-6`)

### 14.6 Frontend API Base URL Detection

The frontend (`api.js`) auto-detects the API URL. **OpenCouncil uses port 8002:**
```javascript
const devApiBase = `${window.location.protocol}//${window.location.hostname}:8002`;
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? devApiBase : '');
```

This means:
- **Local dev:** Browser at `http://localhost:5174` → API at `http://localhost:8002`
- **Tailscale dev:** Browser at `http://100.117.3.83:5174` → API at `http://100.117.3.83:8002`
- **Production:** Same origin (API and frontend served from same host)

The backend must listen on `0.0.0.0` (not `127.0.0.1`) so it's reachable via Tailscale. The Vite dev server also needs `--host 0.0.0.0`.

### 14.7 CORS Configuration

```javascript
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5174', 'http://localhost:3000'];
const allowedOrigins = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  FRONTEND_BASE_URL,                    // from .env
  ...(process.env.CORS_ALLOWED_ORIGINS) // comma-separated from .env
]);
```

For Tailscale, you need both:
- `FRONTEND_BASE_URL=http://100.117.3.83` (or whatever your Tailscale IP is)
- `CORS_ALLOWED_ORIGINS=http://100.117.3.83,http://100.117.3.83:5174`

The port matters — `http://100.117.3.83` and `http://100.117.3.83:5174` are different origins.

### 14.8 OpenCouncil OAuth Setup Checklist

For the new OpenCouncil repo:

1. **Copy files from llm-council:** `oauth.js`, `oauthStorage.js`, and the OpenAI + Anthropic sections of `modelClients.js` and `config.js`
2. **Strip providers** you don't need: Remove Manus, OpenRouter, and third-party provider code
3. **Change port** to avoid conflicts: Backend on 8002, Vite on 5174
4. **Update .env:**
   ```bash
   APP_BASE_URL=http://100.117.3.83
   FRONTEND_BASE_URL=http://100.117.3.83
   PORT=8002
   OPENAI_OAUTH_LOCAL_CALLBACK_PORT=1456
   OPENAI_OAUTH_REDIRECT_URI=http://localhost:1456/auth/callback
   OPENAI_OAUTH_USE_LOCAL_CALLBACK=1
   OPENAI_OAUTH_MANUAL_CODE_FLOW=1
   ANTHROPIC_OAUTH_REDIRECT_URI=https://console.anthropic.com/oauth/code/callback
   ANTHROPIC_MAX_TOKENS=8192
   CORS_ALLOWED_ORIGINS=http://100.117.3.83,http://100.117.3.83:5174
   ```
5. **Update frontend API detection** to use port 8002 instead of 8001
6. **Update originator headers** from `llm-council` to `opencouncil`
7. **Separate OAuth tokens:** OpenCouncil maintains its own `data/oauth_tokens.json`. User must re-authenticate ChatGPT and Claude separately for this app. This avoids token refresh race conditions when both apps run simultaneously.
8. **Vite dev server:** Add `--host 0.0.0.0` to the dev script so it's reachable via Tailscale
9. **Backend Express:** Keep `HOST=0.0.0.0` so it binds to all interfaces

### 14.9 Available Models

**ChatGPT (OpenAI) models:**
| Model ID | Label |
|----------|-------|
| `openai/gpt-5.4` | GPT-5.4 |
| `openai/gpt-5.3-codex` | GPT-5.3 Codex |
| `openai/gpt-5.2` | GPT-5.2 |
| `openai/gpt-5.2-codex` | GPT-5.2 Codex |
| `openai/gpt-5.1-codex-max` | GPT-5.1 Codex Max |
| `openai/gpt-5.1-codex` | GPT-5.1 Codex |
| `openai/gpt-5.1-codex-mini` | GPT-5.1 Codex Mini |
| `openai/gpt-5-codex` | GPT-5 Codex |
| `openai/gpt-5-codex-mini` | GPT-5 Codex Mini |

**Claude (Anthropic) models:**
| Model ID | Label |
|----------|-------|
| `anthropic/claude-sonnet-4-6` | Claude Sonnet 4.6 |
| `anthropic/claude-opus-4-6` | Claude Opus 4.6 |
| `anthropic/claude-haiku-4-5` | Claude Haiku 4.5 |
| `anthropic/claude-sonnet-4-5` | Claude Sonnet 4.5 |
| `anthropic/claude-opus-4-5` | Claude Opus 4.5 |
| `anthropic/claude-sonnet-4-0` | Claude Sonnet 4 |
| `anthropic/claude-opus-4-1` | Claude Opus 4.1 |
| `anthropic/claude-3-7-sonnet-latest` | Claude Sonnet 3.7 |
| `anthropic/claude-3-5-haiku-latest` | Claude Haiku 3.5 |

---

## 15. Unit Tests

### 15.1 Test Framework

Use **Vitest** for both backend and frontend tests. It integrates natively with Vite and supports ESM.

### 15.2 Backend Tests

#### `tests/backend/db.test.js`
```
- creates all tables on initialization
- inserts and retrieves a persona
- updates a persona (partial update)
- deletes a persona
- inserts a session with all fields (question, context, max_rounds, working_doc_enabled, moderator_model)
- inserts a session with defaults (only question required)
- inserts session_advisors from persona (snapshot fields copied)
- inserts session_advisors ad-hoc (no persona_id)
- session_advisors.updated_at is set on insert
- cascading delete removes advisors, turns, summaries, outcome, attachments, urls, continuations
- inserts debate turns for a round with all fields
- inserts round summaries with JSON action_items
- inserts session outcome with JSON arrays (caveats, dissenting_views, next_questions)
- inserts and retrieves attachments
- inserts and retrieves session_urls
- deletes a session_url
- inserts session_continuations row
- retrieves continuations for a session
- persona_id set to NULL when linked persona is deleted (ON DELETE SET NULL)
```

#### `tests/backend/council.test.js`
```
# Prompt construction
- constructs advisor system prompt with persona system_prompt + role briefing
- constructs advisor system prompt with web browsing instructions
- constructs advisor system prompt with attachment and URL content
- constructs advisor system prompt for round > 1 with moderator summary + other positions
- constructs advisor system prompt for continued session with additional context
- constructs moderator per-round prompt with all advisor positions
- constructs moderator per-round prompt with working doc content (when enabled)
- omits working doc section from moderator prompt when working_doc_enabled=false
- constructs moderator final outcome prompt for consensus session
- constructs moderator final outcome prompt for hung session (includes NEXT_QUESTIONS instruction)

# Response parsing (Section 4.6)
- parses well-formed advisor response: extracts position, recommendation, confidence, agreement, concerns, what_would_change_mind
- parses advisor response with missing RECOMMENDATION → default null
- parses advisor response with missing CONFIDENCE → default 0.5
- parses advisor response with missing AGREEMENT → default "mostly_agree"
- parses advisor response with BLOCKING_CONCERNS: "none" → empty array []
- parses advisor response with comma-separated blocking concerns → JSON array
- parses advisor response with no structured section at all → position=full text, defaults for all
- parses moderator per-round response: summary, consensus_status, action_items
- parses moderator per-round response with invalid consensus_status → default "converging"
- parses moderator per-round response with unparseable action_items → default []
- parses moderator working doc update
- parses moderator "NO_CHANGE" → skips working doc update
- parses moderator final outcome: final_recommendation, caveats, dissenting_views, next_questions
- parses moderator final outcome with unparseable JSON arrays → default []

# Consensus evaluation (Section 4.7)
- all agree → consensus_reached
- majority agree, no strong disagree → consensus_reached
- exactly 50% agree → NOT consensus (must be >50%)
- one strongly_disagree blocks consensus even if majority agree
- all disagree (not strongly) → not consensus
- mixed with no majority → not consensus

# Engine flow
- stops at max_rounds → hung status, stores hung_reason
- runs single round: queries all advisors in parallel, then moderator
- runs multi-round deliberation until consensus, produces final outcome
- runs multi-round deliberation until max_rounds → hung, produces final outcome with next_questions
- continues hung session: adds continuation row, extends max_rounds, resumes from current_round
- handles single advisor model failure gracefully (skips, continues with remaining)
- handles all advisors failing → errors out
- skips working doc update when working_doc_enabled=false
- uses user-selected moderator_model when set
- uses first connected provider model when moderator_model is null
```

#### `tests/backend/moderator.test.js`
```
- constructs per-round moderator system prompt correctly
- constructs final outcome moderator system prompt for consensus
- constructs final outcome moderator system prompt for hung (includes NEXT_QUESTIONS)
- includes working doc in prompt when enabled and exists
- omits working doc from prompt when not enabled
- parses per-round response: summary, consensus_status, action_items
- parses working document update from moderator response
- handles "NO_CHANGE" working document response
- handles malformed per-round response with defaults
- parses final outcome: final_recommendation, caveats, dissenting_views, next_questions
- handles malformed final outcome with defaults
```

#### `tests/backend/workingDoc.test.js`
```
- initializes git repo for session
- creates working document with initial content and tags round-1
- commits working document update with round number and tags round-N
- retrieves current working document content
- retrieves git history with round tags
- returns diff between two round tags
- returns empty history for new session
- handles missing session directory gracefully
- handles diff request for non-existent rounds gracefully
```

#### `tests/backend/fileHandler.test.js`
```
- saves uploaded file to data/uploads/{session_id}/{uuid}_{original_name}
- extracts text from PDF
- reads markdown file as-is
- reads txt file as-is
- rejects unsupported file types (returns error)
- enforces max file size 10MB (returns error)
- processes URL: fetches page and extracts text content
- stores fetched URL title and content in session_urls
- handles URL fetch failure gracefully (stores with null fetched_content)
```

#### `tests/backend/export.test.js`
```
- exports markdown with all sections (council members, rounds, outcome, working doc)
- exports markdown with no working document (working_doc_enabled=false)
- exports markdown for hung session (includes next_questions section)
- exports markdown for session with continuations
- exports PDF (returns buffer)
- handles session with no outcome yet (in-progress or paused)
```

#### `tests/backend/server.test.js` (integration)
```
# Health
- GET /api/health returns 200

# Personas
- POST /api/personas creates persona, returns all fields
- GET /api/personas lists all personas
- GET /api/personas/:id returns single persona
- PUT /api/personas/:id partial update (e.g., just name)
- DELETE /api/personas/:id returns { ok: true }
- GET /api/personas/:id after delete returns 404

# Sessions
- POST /api/sessions creates session in 'setup' status
- POST /api/sessions with working_doc_enabled and moderator_model
- GET /api/sessions lists sessions with advisor_count
- GET /api/sessions/:id returns full state (advisors, rounds, outcome, attachments, urls, continuations)
- PUT /api/sessions/:id updates metadata (only when status='setup')
- PUT /api/sessions/:id when status!='setup' returns 400
- DELETE /api/sessions/:id returns { ok: true }

# Session advisors
- POST /api/sessions/:id/advisors with persona_id snapshots persona fields
- POST /api/sessions/:id/advisors ad-hoc (no persona_id)
- POST /api/sessions/:id/advisors with role_briefing
- PUT /api/sessions/:id/advisors/:id updates locally (save_to_base=false)
- PUT /api/sessions/:id/advisors/:id with save_to_base=true updates linked persona
- PUT /api/sessions/:id/advisors/:id with save_to_base=true and no persona_id → error
- DELETE /api/sessions/:id/advisors/:id returns { ok: true }
- advisor endpoints return 400 when session status != 'setup'

# Attachments
- POST /api/sessions/:id/attachments uploads file (multipart, field="file")
- POST /api/sessions/:id/attachments rejects file over 10MB
- POST /api/sessions/:id/attachments rejects unsupported type
- GET /api/sessions/:id/attachments lists attachments
- DELETE /api/sessions/:id/attachments/:id removes attachment row and file from disk

# URLs
- POST /api/sessions/:id/urls adds URL reference
- GET /api/sessions/:id/urls lists URLs
- DELETE /api/sessions/:id/urls/:id removes URL

# Deliberation lifecycle
- POST /api/sessions/:id/start with no advisors → 400
- POST /api/sessions/:id/start with status!='setup' → 400
- POST /api/sessions/:id/start returns SSE stream with correct event sequence (mock model clients)
- POST /api/sessions/:id/start sets title from question (first 80 chars)
- POST /api/sessions/:id/stop transitions to 'paused'
- POST /api/sessions/:id/resume transitions paused → deliberating
- POST /api/sessions/:id/resume returns SSE stream continuing from current_round
- POST /api/sessions/:id/resume with status!='paused' → 400
- POST /api/sessions/:id/continue with status!='hung' → 400
- POST /api/sessions/:id/continue stores continuation row
- POST /api/sessions/:id/continue effective max_rounds = original + SUM(additional_rounds)

# Working document
- GET /api/sessions/:id/working-doc returns null when not enabled
- GET /api/sessions/:id/working-doc returns content when enabled and has data
- GET /api/sessions/:id/working-doc/history returns round-tagged commits
- GET /api/sessions/:id/working-doc/diff returns unified diff

# Export
- GET /api/sessions/:id/export/markdown returns text/markdown
- GET /api/sessions/:id/export/pdf returns application/pdf

# Auth
- GET /api/auth/providers returns provider status with available_models
```

### 15.3 Frontend Tests

#### `tests/frontend/api.test.js`
```
# Personas
- listPersonas calls GET /api/personas
- createPersona calls POST /api/personas with body
- updatePersona calls PUT /api/personas/:id with partial body
- deletePersona calls DELETE /api/personas/:id

# Sessions
- listSessions calls GET /api/sessions
- createSession calls POST /api/sessions with question, context, max_rounds, working_doc_enabled, moderator_model
- getSession calls GET /api/sessions/:id and returns full state
- updateSession calls PUT /api/sessions/:id
- deleteSession calls DELETE /api/sessions/:id

# Advisors
- addAdvisor calls POST /api/sessions/:id/advisors with persona_id
- addAdvisorAdHoc calls POST /api/sessions/:id/advisors with inline fields
- updateAdvisor calls PUT /api/sessions/:id/advisors/:id
- updateAdvisorSaveToBase sends save_to_base=true in body
- removeAdvisor calls DELETE /api/sessions/:id/advisors/:id

# Attachments & URLs
- uploadAttachment sends multipart form data with field name "file"
- listAttachments calls GET /api/sessions/:id/attachments
- removeAttachment calls DELETE /api/sessions/:id/attachments/:id
- addUrl calls POST /api/sessions/:id/urls
- listUrls calls GET /api/sessions/:id/urls
- removeUrl calls DELETE /api/sessions/:id/urls/:id

# Deliberation
- startDeliberation calls POST /api/sessions/:id/start and returns SSE reader
- parseSSEEvent correctly parses all event types (round_start, advisor_start, advisor_chunk, advisor_complete, moderator_start, moderator_chunk, moderator_complete, working_doc_update, round_complete, consensus_reached, hung, outcome, error, complete)
- continueSession calls POST /api/sessions/:id/continue with additional_context and additional_rounds
- stopSession calls POST /api/sessions/:id/stop
- resumeSession calls POST /api/sessions/:id/resume

# Export
- exportMarkdown fetches text/markdown content
- exportPdf fetches PDF blob

# Auth
- getAuthProviders calls GET /api/auth/providers
```

#### `tests/frontend/components/PersonaCard.test.jsx`
```
- renders persona name, description, default model label
- calls onEdit when edit button clicked
- calls onDelete when delete button clicked
- shows model label not raw ID (e.g., "Claude Sonnet 4.6" not "anthropic/claude-sonnet-4-6")
```

#### `tests/frontend/components/ConsensusMeter.test.jsx`
```
- shows 0% when no turns
- shows correct percentage for mixed agreement levels
- shows "Consensus Reached" when status is consensus_reached
- shows "Hung" when status is hung
- shows "Deliberating" when in progress
- color segments: green (agree), yellow (mostly_agree), orange (disagree), red (strongly_disagree)
```

#### `tests/frontend/components/AdvisorSeat.test.jsx`
```
- renders advisor name, model label, and description
- shows role briefing text
- allows editing role briefing inline
- allows model override via dropdown (populated from provider available_models)
- shows "Save Local" and "Save to Base" buttons on edit
- "Save to Base" disabled when persona_id is null
```

#### `tests/frontend/components/DebateRound.test.jsx`
```
- renders all advisor positions for the round
- shows moderator summary
- color-codes agreement levels (green/yellow/orange/red)
- collapses full position text by default, expands on click
- shows confidence as percentage (e.g., 0.85 → "85%")
- shows blocking concerns as bullet list
- shows what_would_change_mind text
```

#### `tests/frontend/pages/SessionSetup.test.jsx`
```
- renders question input, context textarea, advisor list
- adds advisor from persona library (opens picker)
- adds ad-hoc advisor (inline creation form)
- removes advisor
- edits advisor role briefing
- allows file upload (shows uploaded file name)
- allows URL addition (shows added URLs)
- removes uploaded file
- removes added URL
- toggles working document on/off
- selects moderator model from dropdown
- multi-step submission: creates session, adds advisors, uploads files, adds URLs, then starts
- validates at least one advisor required before start
- validates question is required
- all controls disabled when session status != 'setup'
```

#### `tests/frontend/pages/SessionView.test.jsx`
```
- shows summary tab by default with final recommendation
- shows debate tab with round-by-round transcript
- shows working document tab (only when working_doc_enabled)
- hides working document tab when not enabled
- updates advisor positions in real-time via SSE advisor_chunk events
- updates moderator summary in real-time via SSE moderator_chunk events
- shows advisor_start indicator (loading state per advisor)
- shows moderator summary after moderator_complete event
- shows "Continue" button when session status is 'hung'
- "Continue" button opens additional context textarea with additional_rounds input
- shows "Stop" button when session status is 'deliberating'
- shows "Resume" button when session status is 'paused'
- resume reconnects SSE stream and continues showing live updates
- shows export menu (markdown, PDF)
- consensus meter updates each round based on agreement levels
- displays hung_reason when session is hung
- displays hung_reason from both GET response and live SSE hung event
```

#### `tests/frontend/pages/HomePage.test.jsx`
```
- renders "New Council Session" button
- renders list of sessions with title, status badge, advisor count
- clicking session navigates to SessionView
- clicking "New Council Session" navigates to SessionSetup
- shows Persona Library and Settings nav links
- sessions sorted by updated_at descending
```

#### `tests/frontend/pages/SettingsPage.test.jsx`
```
- renders provider cards for ChatGPT and Claude
- shows "Connected" / "Not connected" status per provider
- shows "Connect" button for disconnected providers
- shows "Disconnect" button for connected providers
- calls startOAuth on connect click
- shows code-paste modal for code-flow providers
```

#### `tests/frontend/components/WorkingDocView.test.jsx`
```
- renders current working document as markdown
- shows "No working document" when content is null
- renders version history sidebar with round entries
- clicking a round in history shows diff view
- diff view highlights additions and removals
```

#### `tests/frontend/components/ExportMenu.test.jsx`
```
- renders markdown and PDF export buttons
- clicking markdown triggers file download
- clicking PDF triggers file download
- buttons disabled when session has no outcome
```

#### `tests/frontend/components/AttachmentUpload.test.jsx`
```
- renders file upload zone
- shows file picker on click
- displays uploaded file names with remove button
- shows URL input with "Add" button
- displays added URLs with remove button
- calls onRemoveFile when remove clicked
- calls onRemoveUrl when remove clicked
```

### 15.4 Test Configuration

```javascript
// vitest.config.js (root)
export default {
  projects: [
    {
      test: {
        name: 'backend',
        root: './backend',
        environment: 'node',
        include: ['../tests/backend/**/*.test.js'],
        setupFiles: ['../tests/backend/setup.js'],
      },
    },
    {
      test: {
        name: 'frontend',
        root: './frontend',
        environment: 'jsdom',
        include: ['../tests/frontend/**/*.test.{js,jsx}'],
        setupFiles: ['../tests/frontend/setup.js'],
      },
    },
  ],
};
```

#### `tests/backend/setup.js`
```
- Creates temp directory for test data
- Initializes in-memory SQLite database
- Sets env vars for test mode
- Cleanup after all tests
```

#### `tests/frontend/setup.js`
```
- Sets up jsdom environment
- Mocks fetch for API calls
- Provides test utilities for rendering components
```

---

## 16. Implementation Order

### Phase 1: Foundation
1. Initialize repo with package.json, vite.config, tailwind
2. Set up SQLite database and migrations (db.js)
3. Port OAuth + model clients from llm-council
4. Implement persona CRUD (backend + frontend)
5. Write foundation tests (db, persona CRUD)

### Phase 2: Core Deliberation
6. Implement council.js consensus engine
7. Implement moderator.js
8. Implement SSE streaming for deliberation
9. Build SessionSetup page
10. Build SessionView page (summary + debate tabs)
11. Write council + moderator tests

### Phase 3: Working Documents & Attachments
12. Implement workingDoc.js with git versioning
13. Implement fileHandler.js (upload + text extraction)
14. Build WorkingDocView component
15. Build AttachmentUpload component
16. Write working doc + file handler tests

### Phase 4: Polish & Export
17. Implement export.js (markdown + PDF)
18. Build responsive Layout + navigation
19. Mobile optimization pass
20. Build ConsensusMeter, ExportMenu
21. Write export + integration tests

### Phase 5: Final
22. End-to-end testing
23. Error handling audit
24. Performance testing (concurrent advisors)
25. README + setup docs

---

## 17. Key Design Decisions

1. **SQLite over JSON files** — Structured queries for sessions/turns, better for the relational data model. Simpler than Postgres for single-user.

2. **Snapshot personas into sessions** — Changing a saved persona doesn't retroactively alter past deliberations. Session advisors are independent copies.

3. **Moderator-only document editing** — Prevents conflicting edits. Advisors propose changes in their positions; moderator merges.

4. **Native web browsing** — ChatGPT and Claude both have built-in web search. No custom search/scrape infrastructure needed — just instruct advisors to browse and cite in their system prompts.

5. **Git for working documents** — Natural fit for round-by-round versioning. Familiar diff/history model. Uses simple-git library.

6. **Consensus = majority + no strong objection** — Matches real advisory board dynamics. Strong objections are visible and must be addressed.

7. **SSE for live updates** — Same pattern as llm-council. Works well for progressive round-by-round updates. No WebSocket complexity.

8. **Tailwind CSS** — Fast responsive development. Works well for mobile-first. No component library lock-in.
