# Architecture Decision Records (lightweight)

## ADR-001 — Nginx as BFF (no app server in v1)

- **Status:** Accepted (questionnaire §7.2)
- **Context:** Need browser isolation from ACI hosts, TLS, and path routing without a large backend.
- **Decision:** Use existing Nginx on `webui.idoldemos.net` as reverse proxy; Angular calls same-origin paths.
- **Consequence:** Session is client-side SecurityInfo (ADR-002). JSON parsing happens in Angular.

## ADR-002 — SecurityInfo in sessionStorage (v1)

- **Status:** Accepted for v1
- **Context:** Questionnaire preferred httpOnly cookie, but also Nginx-only BFF. Pure Nginx cannot hold encrypted app sessions.
- **Decision:** Follow HKEX: store `{ username, token }` in sessionStorage after Community UserRead.
- **Consequence:** XSS can steal token — mitigate with careful HTML (View), CSP later. Optional future Node BFF for httpOnly (roadmap M13).

## ADR-003 — ACI query-string URLs only

- **Status:** Accepted (HKEX hard lesson)
- **Decision:** Always `/?action=…&SecurityInfo=…` so Nginx does not normalise `%2B` inside path rewrites.
- **Consequence:** Slightly different from some legacy IDOL path-style examples.

## ADR-004 — Prefer simplejson for Content; XML for Community login

- **Status:** Accepted
- **Decision:** `ResponseFormat=simplejson` on Query/GetContent when available; parse Community UserRead as XML.
- **Consequence:** Two parsers in auth vs search services.

## ADR-005 — Primary search path is Content; QMS is additive

- **Status:** Accepted (questionnaire multi-select interpreted)
- **Decision:** Milestone 3 uses Content Query; QMS gets its own milestone for expansion/rules.
- **Consequence:** Clearer first demo; QMS not on critical path for first hits.

## ADR-006 — Single Gold theme (no switcher in v1)

- **Status:** Accepted (only Gold checked)
- **Decision:** demo gold tokens only; no multi-theme switcher until requested.

## ADR-007 — HKEX as implementation reference, not a fork

- **Status:** Accepted
- **Decision:** Clone under `_reference/`; reimplement under `apps/web` with KD branding and multi-DB/AnswerServer/chat scope.
- **Consequence:** Cleaner product identity; copy patterns (auth, proxy, highlight) deliberately.

## ADR-008 — Databases CAD, WRC, xECM; default all

- **Status:** Accepted
- **Decision:** Config-driven list; default DatabaseMatch = all three.
- **Consequence:** xECM field mapping special-cases (NAME, node ID).

## ADR-009 — Empty search box = match-all (`Text=*`)

- **Status:** Accepted (product UX, post M3)
- **Context:** Users clear keywords and expect full results again under current filters.
- **Decision:** Empty box maps to Content `Text=*`. Display stays empty (placeholder). Clearing the box re-runs match-all; filter changes with empty box use `*`, not the previous keyword.
- **Consequence:** First load after login also runs default match-all.

## ADR-010 — QMS TypeAhead for search autosuggest (M5b)

- **Status:** Accepted
- **Context:** Not in original questionnaire order; added after M5. QMS `TypeAhead` Mode=Index returns ALL CAPS expansions.
- **Decision:** Debounced TypeAhead under the search box; MaxResults=5; Title Case display; no suggestion scrollbar; attach SecurityInfo when present; failures silent.
- **Consequence:** QMS is required for autosuggest (search itself remains Content). Dev `/qms`, prod `/QMS/`.

## ADR-011 — Stable filter/results chrome (no layout jump)

- **Status:** Accepted
- **Decision:** No “Updating facets…” (or similar) text that inserts rows in the filter column. Facet refresh may dim the panel only. Pagination Previous/Next only at **bottom** of results; top shows count only.
- **Consequence:** Calmer UI when toggling facets or paging.

## ADR-012 — Private GitHub repo for kd-sandbox-ai-demo

- **Status:** Accepted
- **Decision:** Source of truth on GitHub private `kd-sandbox-ai-demo` (`main`); canonical local path remains `/home/vinay/projects/ssl_nifi/code/kd-sandbox-ai-demo`.
- **Consequence:** Agents push only when asked; no secrets in git.

## ADR-013 — AQG as cluster hierarchy (QuerySummary)

- **Status:** Accepted
- **Context:** QMS `QuerySummary` returns flat `autn:element` rows with `cluster`, `docs`, `pdocs`, `poccs` (not nested XML).
- **Decision:** Build a tree by `cluster`. Non-negative clusters: strongest term is parent (heading + Title Case); others are children. Negative clusters are standalone roots (IDOL: weak/noisy).
- **Consequence:** Right-hand Query guidance is hierarchical; selecting topics feeds multi-concept tags.

## ADR-014 — Multi-concept search + header operator gear

- **Status:** Accepted
- **Context:** Users need to stack topics and choose how they combine (boolean / proximity).
- **Decision:** Concepts are additive **tags** under the search box. Join operator is **AND | OR | YNEAR | WNEAR | DNEAR | NEAR**, chosen from a **header ⚙** next to Sign out (under username). Shared `ConceptSearchSettingsService` + sessionStorage. Gear shows icon only (no label, no operator badge on the trigger). Add/remove tags or change operator (when ≥2 tags) re-runs Content Query immediately.
- **Consequence:** Empty tags still match-all `*`; clearing the search input alone does not drop tags.

## ADR-015 — Chat continues from the Answer panel (KDChat)

- **Status:** Accepted
- **Context:** M8 Ask (Grok RAG) is one-shot. Users need follow-ups without losing the answer they just read, and without a second Ask that may differ.
- **Decision:** Dedicated `/chat` route. **Continue in AI chat** seeds the visible question + answer + sources into the thread and creates a KDChat session (`ManageResources` + `Converse`) with `KEEP_CONTEXT`, `SELECTED_DATABASE` (same left-panel DBs), `SECURITY_INFO`, and `LAST_ANSWER`. **New conversation** / header **AI chat** start or resume without re-running Ask. Conversation systems are never called with `action=Ask`.
- **Consequence:** Find-style Conversation (`longmemory`) stays unchanged; KD chat uses the `KDChat` system name from `config/answer.json`.

## ADR-016 — Continue-in-chat locks RAG to Answer sources

- **Status:** Accepted
- **Context:** Follow-ups after **Continue in AI chat** were retrieving from the left-panel `DatabaseMatch` and answering from other KD pages than the cited sources.
- **Decision:** Seed `LOCKED_REFERENCES` from the Answer panel source `ref` values. KDChat Ask then sends `MatchReference` (and does **not** send `DatabaseMatch`, which can drop the DB that holds the ref). `search all` / change-database / new conversation clear the lock.
- **Consequence:** Continued chats stay inside the documents already cited. Users who want a wider search start a new conversation or say “search all”.
