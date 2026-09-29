# Milestone 2 — complete

**Date:** 2026-08-10  
**Path:** `/home/vinay/projects/ssl_nifi/code/kd-sandbox-ai-demo`

## Delivered

| Item | Detail |
|------|--------|
| Community login | `AuthService.login` → `UserRead` + `SecurityInfo=true` |
| Response parse | XML: `SUCCESS`, `autn:authenticate`, `autn:securityinfo` |
| Session | `sessionStorage` key `kd_auth_user` `{ username, token }` |
| Guard | Unauthenticated → `/login`; real sessions require non-empty token |
| Dev proxy | `/community` → `https://webui.idoldemos.net/Community` |
| Stub auth | Off by default (`useStubAuth: false`); set true only for offline UI |

## How to verify

```bash
cd kd-sandbox-ai-demo/apps/web
./serve.sh
```

1. Open the app, sign in with a **valid Community** username/password.
2. Wrong password → clear error on login form.
3. After success, search page shows **SecurityInfo present**.
4. Sign out → returns to login; `/search` redirects to login.

## Next

**Milestone 3** — Content `Query` for CAD / WRC / xECM with rich snippets.
