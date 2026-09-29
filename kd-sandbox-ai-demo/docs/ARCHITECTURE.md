# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  Angular SPA (Intelligent Knowledge Discovery Demo)                         │
│  - Login, Search, Preview, Answers, Chat                     │
│  - sessionStorage: { username, securityInfo }                │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS (same origin)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Nginx  webui.idoldemos.net                                  │
│  - Static: /kd/ → Angular dist                              │
│  - ACI reverse proxy locations (see nginx/)                  │
└───┬──────┬──────┬──────┬──────┬──────┬──────────────────────┘
    │      │      │      │      │      │
    ▼      ▼      ▼      ▼      ▼      ▼
 Community Content  QMS   View Agentstore Category AnswerServer
 :9030     :9200  :16000 :9080  :9150     :9020    :12000
```

This is the **Nginx-as-BFF** model: no application server required for v1. The browser never needs Community/Content private hostnames if it only uses the proxy paths.

## Why Nginx is the BFF here

From the questionnaire: prefer **Nginx only** (proxy ACI, no app server logic) and reuse `/home/vinay/projects/ssl_nifi/nginx`.

HKEX already proves this pattern:

| Concern | Approach |
|---------|----------|
| TLS to clients | Nginx terminates HTTPS (`certificate.crt` / CA under `nginx/ssl`) |
| TLS to ACI | Nginx → `https://*.idoldemos.net:port` (trust CA) |
| CORS | Same origin — SPA + API paths on `webui.idoldemos.net` |
| Secrets | No long-lived ACI passwords in Angular beyond user login; SecurityInfo is short-lived user token |
| Session | **Client sessionStorage** (HKEX). True httpOnly cookie needs a thin Node/Python BFF (optional later) |

### Session model decision (Milestone 0)

| Option | Pros | Cons | Choice |
|--------|------|------|--------|
| A. sessionStorage SecurityInfo (HKEX) | Works with pure Nginx | Token visible to JS (XSS risk) | **v1** |
| B. httpOnly cookie via app BFF | Stronger XSS resistance | Needs Node/Python session service | Later hardening |
| C. No token (impersonation) | — | Not acceptable | No |

Document A clearly; do not pretend pure Nginx implements B.

## Request flow

### Login

0. **Pre-flight:** `GET {communityApiUrl}/?action=GetStatus` on the login screen. If Community is unreachable, returns HTML (SPA fallback), or the proxy errors (502/504), the form stays disabled. Retry and Settings remain available without a session. Stub auth (`useStubAuth`) skips this check.
1. `GET /Community/?action=UserRead&UserName=…&Password=…&SecurityInfo=true`
2. Parse XML (Community often returns XML even when JSON is preferred elsewhere).
3. Require `response=SUCCESS` and `autn:authenticate=true`.
4. Store `autn:securityinfo` + username in sessionStorage.
5. Route guard allows `/search` (and later routes). The guard still only checks the session — Community liveness is the login pre-flight, not the guard.

### Search (primary path)

**v1 primary:** Content Query (direct). **QMS TypeAhead** for autosuggest (M5b). Optional QMS query manipulation later (M7).

```
GET /Content/?action=Query
  &Text=…
  &DatabaseMatch=CAD,WRC,xECM
  &Print=Fields
  &PrintFields=…
  &MaxResults=…
  &Start=…
  &Summary=Context
  &Highlight=…
  &SecurityInfo=…          # encodeURIComponent once
  &ResponseFormat=simplejson
```

**QMS** is used for search **TypeAhead** (autosuggest). Query manipulation / rules remain optional later:

```
GET /QMS/?action=TypeAhead&Mode=Index&MaxResults=5&Text=…&SecurityInfo=…
GET /QMS/?action=…   # future: query expansion / rules
```

### Preview / download

- **View:** `GET /View/?action=…` (HTML conversion; rewrite relative assets as HKEX does).
- **GetContent / original:** Content reference + View or connector-specific download URL.

### Answers & chat

- **AnswerServer:** detect question-like queries or dedicated Q&A UI → `/AnswerServer/`.
- **Chatbot:** `/chat` uses AnswerServer **KDChat** (`ManageResources` + `Converse`) via `/AnswerServer/`. Continue-from-answer seeds the M8 Grok reply so follow-ups do not re-Ask.

## Angular app structure (target)

```
apps/web/
  src/
    app/
      core/
        guards/auth.guard.ts
        services/auth.service.ts
        services/search.service.ts
        services/view.service.ts
        services/answer.service.ts
        services/config.service.ts
      features/
        login/
        search/
        preview/
        answers/
        chat/
      shared/
        theme/          # demo gold tokens
    assets/config/      # databases.json, filters.json, fields.json
    environments/
```

Load config JSON from `assets/config` so databases/facets change without full rebuild when possible.

## ACI URL format (critical)

**Always use query-string form:**

```text
https://webui.idoldemos.net/Content/?action=Query&Text=…&SecurityInfo=…
```

**Never** put `action=…&SecurityInfo=…` only in the path when SecurityInfo contains `+`/`/` — Nginx rewrite can corrupt `%2B` → `+` → space and break decryption (`AXEQUERY520`).

See HKEX `instructions/idol-api-guidelines.md` and [ACI.md](./ACI.md).

## Config vs code

| Concern | Location |
|---------|----------|
| ACI base paths | `environment.ts` + Nginx |
| Database list | `config/databases.json` → copied to Angular assets |
| Result fields / PrintFields | `config/fields.json` |
| Facet fields | `config/parametric-filters.json` |
| Theme tokens | SCSS variables / CSS custom properties |
| Secrets / passwords | **Never** commit; user types at login |

## Existing Nginx (reference)

Live demo proxy: `/home/vinay/projects/ssl_nifi/nginx/default.conf`

Already defines (among others):

| Location | Upstream |
|----------|----------|
| `/Community/` | community:9030 |
| `/Content/` | content1:9200 |
| `/View/` | view:9080 |
| `/Agentstore/` | agentstore:9150 |
| `/api/community/` | community:9030 |
| `/api/content/` | content1:9200 |
| `/api/answerserver/` | answerserver:12000 |
| `/BVC/` | existing Angular app |

**Gaps for KD app:** add `/QMS/`, `/Category/`, static `/app/` (or similar), and optionally unify AnswerServer as `/AnswerServer/` for consistency with HKEX-style paths.

Sample additions: [`nginx/kd-locations.conf.snippet` (legacy filename)](../nginx/kd-locations.conf.snippet).

## Deployment

| Piece | Approach |
|-------|----------|
| Front end | `ng build` → static files mounted in Nginx (Docker Compose) |
| Proxy | Existing Nginx container; SSL may need renewal on `webui.idoldemos.net` |
| Config | JSON in image or volume; no passwords in image |

## Security notes

- Prefer CSP and careful handling of View HTML (XSS from converted docs).
- `encodeURIComponent` SecurityInfo **once**.
- Logout clears sessionStorage.
- Idle timeout: not specified yet — implement with configurable default (e.g. 30 min) in Milestone 2.
- Prod must verify TLS with CA (`nginx/ssl/ca.crt`); never default `secure: false` outside local dev proxy.
