# Knowledge Discovery (IDOL) ACI reference — kd-sandbox-ai-demo

## Components in scope

| Component | In scope | Protocol | FQDN | Port | Nginx path (target) |
|-----------|----------|----------|------|------|---------------------|
| Community | Y | https | community.idoldemos.net | 9030 | `/Community/` |
| Content | Y | https | content1.idoldemos.net | 9200 | `/Content/` |
| QMS | Y | https | qms.idoldemos.net | 16000 | `/QMS/` *(add if missing)* |
| View | Y | https | view.idoldemos.net | 9080 | `/View/` |
| Agentstore | Y | https | agentstore.idoldemos.net | 9150 | `/Agentstore/` |
| Category | Y | https | category.idoldemos.net | 9020 | `/Category/` *(add if missing)* |
| AnswerServer | Y | https | answerserver.idoldemos.net | 12000 | `/AnswerServer/` or `/api/answerserver/` |
| DAH | N | — | — | — | — |
| Extra Content engines | N | — | — | — | — |

**TLS trust:** CA at `/home/vinay/projects/ssl_nifi/nginx/ssl/ca.crt` (also mirrored concepts under that nginx `ssl/` dir).

**Public gateway:** `https://webui.idoldemos.net` (SSL may need renewal).

## Base URL construction

```text
{proxyOrigin}{aciPath}/?action={ActionName}&Param=Value&…
```

Examples:

```text
https://webui.idoldemos.net/Community/?action=UserRead&UserName=…&Password=…&SecurityInfo=true
https://webui.idoldemos.net/Content/?action=Query&Text=vat&DatabaseMatch=CAD,WRC,xECM&ResponseFormat=simplejson&SecurityInfo=…
```

Dev Angular proxy may map `/community` → `https://webui.idoldemos.net/Community` (see HKEX `proxy.conf.json`).

## Authentication

### UserRead

| Param | Value |
|-------|--------|
| action | `UserRead` |
| UserName | username |
| Password | password |
| SecurityInfo | `true` |

**Success checks (XML):**

- `<response>SUCCESS</response>`
- `<autn:authenticate>true</autn:authenticate>` (namespace `http://schemas.autonomy.com/aci/`)
- `<autn:securityinfo>…</autn:securityinfo>` → store as token

**Response format:** treat Community login as **XML** (HKEX experience). Prefer `ResponseFormat=simplejson` for Content/QMS when supported.

## Query (Content)

| Param | Notes |
|-------|--------|
| action | `Query` |
| Text | User query (`*` or empty policy TBD) |
| DatabaseMatch | `CAD`, `WRC`, `xECM` or comma-list |
| MaxResults | page size (TBD default, e.g. 20) |
| Start | pagination offset |
| Print | `Fields` (or as needed) |
| PrintFields | from `config/fields.json` |
| Summary | `Context` for rich snippets |
| Characters | context length (HKEX used 200) |
| Highlight | e.g. `SummaryTerms` |
| StartTag / EndTag | highlight markup |
| FieldText | facet constraints |
| Sort | relevance default; date field TBD |
| SecurityInfo | required when security enabled |
| ResponseFormat | `simplejson` preferred |

### Databases

| DatabaseMatch | Label | Default selected |
|---------------|-------|------------------|
| CAD | CAD | Y (and “all” is default scope) |
| WRC | WRC | with all |
| xECM | xECM | with all |

**xECM field quirks:**

- Title may come from **NAME** rather than `DRETITLE`.
- Reference may need construction using **node ID**.

## Facets (parametric)

Configured field paths (labels TBD in UI):

| Field path | v1 |
|------------|-----|
| DOCUMENT/TITLE | Y |
| DOCUMENT/DRETITLE | Y |
| DOCUMENT/CONNECTOR_GROUP | Y |
| DOCUMENT/DETECTEDLANGUAGE | Y |
| DOCUMENT/FOLDER | Y |

Use Content parametric actions as in HKEX (`GetQueryTagValues` / project equivalent — implement against live engine in Milestone 4).

## View

Document HTML conversion for preview. Key lessons from HKEX:

- Prefer `OutputType=HTML` where applicable.
- Rewrite relative asset URLs to go through `/View/` proxy.
- Long timeouts on Nginx (300s already used on demo proxy).

## AnswerServer (NLQA)

Demo: `answerserver.idoldemos.net:12000` · systems include **Grok** (rag), Conversation, **KDChat**, AnswerBank.

```text
GET {answerserver}/?action=Ask&SystemNames=Grok&Text=What%20is%20…
  &DatabaseMatch=CAD,xECM
  &CustomizationData=[{"system_name":"Grok","security_info":"…"}]
  &ResponseFormat=simplejson
```

| Param | Value |
|-------|--------|
| action | `Ask` |
| SystemNames | `Grok` (RAG over content; AnswerBank may be offline on demo) |
| Text | Natural-language question |
| DatabaseMatch | Same selected DBs as the search filter (e.g. `CAD,xECM`) |
| CustomizationData | **JSON array** of objects with `system_name` + `security_info` (Passage Extractor / Fact Bank document security). Root must be an array. **Do not** send top-level `SecurityInfo` on Ask. |

**Response:** `answers/answer` with `text`, `score`, `interpretation`, `source`, `metadata/sources/source` (ref, title, database, snippet).  
UI: detect questions → Answer panel above results; Content Query still runs.  
**Continue in AI chat** opens `/chat` and talks to **KDChat** (not Grok Ask):

```text
GET {answerserver}/?action=ManageResources&SystemName=KDChat&Data=<base64 JSON>&ResponseFormat=simplejson
GET {answerserver}/?action=Converse&SystemName=KDChat&SessionID=…&Text=…&ResponseFormat=simplejson
```

Conversation systems do **not** support `action=Ask`. Seed `SECURITY_INFO`, `SELECTED_DATABASE`, `LAST_ANSWER`, `LOCKED_REFERENCES` (source `ref` values), `KEEP_CONTEXT=1` on session create so the Grok answer is not re-asked. Follow-up Ask from KDChat sends `MatchReference` (and omits `DatabaseMatch`) so retrieval stays inside those documents.

Dev proxy: `/answerserver` · prod: `/AnswerServer/` or `/api/answerserver/`.

## Agentstore / Category

- Agentstore: agents / profiles for chatbot and agentic flows.
- Category: taxonomy / classification features as needed.

## SecurityInfo rules

1. Request with `SecurityInfo=true` on UserRead.
2. Store full token string.
3. Append with **one** `encodeURIComponent(token)`.
4. Keep token in **query string**, not path, when proxying through Nginx rewrites.
5. Community and Content must share agent encryption keys (ops concern if `AXEQUERY520`).

## ACI action cheat sheet (starter)

| Action | Server | Use |
|--------|--------|-----|
| UserRead | Community | Login + SecurityInfo |
| Query | Content / QMS | Search |
| TypeAhead | QMS | Search-box autosuggest (`Mode=Index`, MaxResults=5, Title Case UI) |
| GetContent | Content | Full fields / body |
| GetQueryTagValues (or equiv.) | Content | Facets |
| View / Convert | View | Preview |
| Ask | AnswerServer | NLQA (`SystemNames=Grok` RAG) |
| ManageResources | AnswerServer | Create `conversation_session` (KDChat) |
| Converse | AnswerServer | Multi-turn chat (`SystemName=KDChat`) |

### TypeAhead (QMS)

Search autosuggest — index expansions for the typed prefix:

```text
GET {qms}/?action=TypeAhead&Mode=Index&MaxResults=5&Text=Waikato&SecurityInfo=…
```

| Param | Value |
|-------|--------|
| action | `TypeAhead` |
| Mode | `Index` |
| MaxResults | `5` (UI cap; no suggestion scrollbar) |
| Text | typed prefix (min ~2 chars in UI) |
| SecurityInfo | session token when available |

**Response (XML):** `<autn:expansion score="…">TERM</autn:expansion>` under `responsedata`.  
Dev proxy: `/qms` → `qms.idoldemos.net:16000`. Prod: `/QMS/`.

### Automatic Query Guidance / AQG (QMS QuerySummary)

Right-hand taxonomy of related concepts for the current search:

```text
GET {qms}/?action=Query&Text=…&DatabaseMatch=CAD,WRC,xECM
  &Combine=Simple&MinScore=0&AnyLanguage=true
  &MaxResults=300&Print=NoResults
  &QuerySummary=true&QuerySummaryLength=50
  &FieldText=…&SecurityInfo=…
```

| Param | Value |
|-------|--------|
| action | `Query` (on **QMS**, not Content) |
| Print | `NoResults` (guidance only; no hit bodies) |
| QuerySummary | `true` |
| QuerySummaryLength | e.g. `50` |
| DatabaseMatch | same DBs as the main search |
| Text / FieldText | same scope as main search |

**Response (XML):**

- `<autn:querysummary>…</autn:querysummary>` — short free-text summary  
- `<autn:qs><autn:element docs="…" pdocs="…" poccs="…" cluster="N">phrase</autn:element></autn:qs>`  

| Attribute | Meaning (IDOL Query Summary) |
|-----------|------------------------------|
| `docs` | Documents where all terms of the element appear |
| `pdocs` | Documents where the element appears as a phrase |
| `poccs` | Phrase occurrences in the result set |
| `cluster` | Cluster grouping; **same id = related concepts** |

**Hierarchy (UI):** group by `cluster`. For **cluster ≥ 0**, strongest term (`docs` / `pdocs` / `poccs`) is the parent; others are children. **Negative** cluster ids are weak/noisy (per IDOL) → each shown as a standalone root.  

UI: expandable tree; multi-select → **multi-concept tags** (join with header ⚙ operator); click term name to add that concept; **All** selects a whole cluster. Parent labels use Title Case.

### Multi-concept operators (client-built Content Text)

Tags under the search box are joined with the operator from the **header ⚙** (next to Sign out):

| Operator | Role |
|----------|------|
| `AND` | Default boolean conjunction |
| `OR` | Disjunction |
| `YNEAR` / `WNEAR` / `DNEAR` / `NEAR` | IDOL proximity family |

Example: `"Flood Protection" AND "Resource Consent"`.  
Service: `ConceptSearchSettingsService` (`sessionStorage` key `kd_concept_operator`).

## Smoke tests (ops)

```bash
# Replace USER/PASS; use -k only if CA not installed in curl trust store
CA=/home/vinay/projects/ssl_nifi/nginx/ssl/ca.crt

curl -sS --cacert "$CA" \
  "https://community.idoldemos.net:9030/?action=GetStatus"

curl -sS --cacert "$CA" \
  "https://webui.idoldemos.net/Community/?action=GetStatus"

# Login (do not log passwords in shared transcripts)
curl -sS --cacert "$CA" \
  "https://webui.idoldemos.net/Community/?action=UserRead&UserName=USER&Password=PASS&SecurityInfo=true"
```
