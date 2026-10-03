# Milestone 0 — complete

**Date:** 2026-08-10  
**Input:** Filled `REQUIREMENTS_QUESTIONNAIRE.md` (Vinay Joseph)

## Delivered

| Artifact | Path |
|----------|------|
| Project README | `kd-sandbox-ai-demo/README.md` |
| Vision | `docs/VISION.md` |
| Architecture | `docs/ARCHITECTURE.md` |
| ACI inventory & actions | `docs/ACI.md` |
| Roadmap | `docs/ROADMAP.md` |
| Runbook | `docs/RUNBOOK.md` |
| ADRs | `docs/DECISIONS.md` |
| Databases config | `config/databases.json` |
| Fields config | `config/fields.json` |
| Facets config | `config/parametric-filters.json` |
| Environment template | `config/environment.template.json` |
| Theme tokens | `config/theme-kd-gold.json` |
| Nginx snippets | `nginx/kd-locations.conf.snippet` (legacy filename) |
| Gitignore | `.gitignore` |
| HKEX reference clone | `_reference/HKEX_SENSITIVE_DOCS/` |
| Grok skill | `~/.grok/skills/idol-kd-search-portal/` |

## Key decisions recorded

1. Nginx on `webui.idoldemos.net` is the BFF (proxy).
2. v1 session = SecurityInfo in **sessionStorage** (HKEX); httpOnly needs later BFF.
3. Search primary path = **Content**; QMS later.
4. DBs: **CAD, WRC, xECM** (default all).
5. Theme: **demo gold** only.
6. MUST later: AnswerServer + agentic chatbot (not in M1–3).

## Nginx gaps noted

Demo `default.conf` already has Community, Content, View, Agentstore, api/answerserver.  
**Missing for full KD map:** `/QMS/`, `/Category/`, `/AnswerServer/` (canonical), `/app/` static app — snippets provided.

## Next

**Milestone 1** — Scaffold Angular under `apps/web` with Gold theme login shell.
