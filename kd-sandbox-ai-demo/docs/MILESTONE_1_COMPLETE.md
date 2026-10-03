# Milestone 1 — complete

**Date:** 2026-08-10  
**App:** `apps/web` (Angular 21, npm package `kd-enterprise-search` (legacy package name in package.json))

## Delivered

| Item | Detail |
|------|--------|
| Scaffold | Angular 21 standalone + SCSS + routing |
| Theme | demo gold tokens (`src/styles/_tokens.scss`) |
| Shell | Sticky navy header, gold accent bar, footer |
| Login | Branded form; stub auth in development |
| Search | Empty state; DB chips from config JSON |
| Guard | `authGuard` → `/login` when no session |
| Config assets | databases, fields, parametric-filters, theme JSON |
| Proxy | `proxy.conf.json` → `webui.idoldemos.net` (for M2+) |
| Build | `npm run build` succeeds |

## How to run

```bash
nvm use 22   # or Node ≥20.19 / ≥22.12
cd kd-sandbox-ai-demo/apps/web
npm start
# open http://localhost:4200
# sign in with any user/pass (stub mode)
```

## Out of scope (by design)

- Community `UserRead` / real SecurityInfo → **Milestone 2**
- Content Query / results → **Milestone 3**
- Facets, View, AnswerServer, chat → later milestones

## Next

**Milestone 2** — Wire `AuthService.login` to Community via proxy; disable stub in dev once verified; parse XML + store SecurityInfo.
