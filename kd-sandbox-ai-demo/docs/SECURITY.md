# Security notes (sandbox)

This package is an **internal demo**. It is hardened against the issues
that made the previous build unsafe to put on a shared host. It is not a
substitute for Nginx TLS + a server session BFF in production.

## Fixes in this build

| Risk | Mitigation |
|---|---|
| `/__kd-probe` open SSRF proxy | Allow-list host (`config.json` `upstreamHost` + loopback) and IDOL ports only. Path must be `GetStatus`. Credentials / `UserRead` / `Ask` blocked. |
| Password sent through the probe | Login no longer falls back to `/__kd-probe` with `UserName`/`Password`. |
| Reflected CORS | Origins are not echoed. Same-origin SPA traffic does not need CORS. |
| Document preview XSS | Preview iframe uses `sandbox` (no scripts) and `referrerpolicy=no-referrer`. |
| Token in console logs | `SecurityInfo` / `Password` redacted. Request tracing disabled when `environment.production` is true. |
| Abandoned sessions | Idle timeout (default 30 minutes) clears `sessionStorage` and returns to login. |
| Clickjacking / default CSP | CSP on `index.html`: `frame-ancestors 'none'`, `object-src 'none'`, `script-src 'self'`. |

## Residual risks (do not ignore)

- Community `SecurityInfo` still lives in **sessionStorage** (ADR-002). XSS in the SPA can steal it. A future httpOnly BFF is required for production.
- `ng serve` on `0.0.0.0:4200` is a **dev server**. Prefer `ng build` + Nginx.
- Settings can still retarget the configured upstream host on this demo host. Do not expose Settings on the public internet.
- IDOL TLS is often self-signed here (`rejectUnauthorized` defaults to false unless `KD_TLS_INSECURE=0`).

## Operator checklist

- Bind the UI behind a firewall; allow only trusted clients to :4200.
- Use Community users with least privilege; keep `KDUIAdmin` scarce.
- Set `KD_TLS_INSECURE=0` when the IDOL CA is installed on the host.
- Sign out when finished; idle timeout is a backup, not a control.
