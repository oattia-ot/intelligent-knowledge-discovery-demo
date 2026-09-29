# Milestone 16 — Admin section + document-viewer JSON

Intelligent Knowledge Discovery Demo has a **role-gated Administration** area. Only Community members of the admin role (`KDUIAdmin` in `config/admin.json`) can open it. **Document viewer** settings moved here and **Save to server** writes `config/document-viewer.json` so every user picks up the values after reload.

## What shipped

### Community roles

Login now sends UserRead `RoleList=true`. If the XML has no roles, the app follows up with `RoleUserGetRoleList` for the signed-in user (SecurityInfo in the query string). Role names are stored on the session. Comparison is case-insensitive.

`/admin` is behind `authGuard` + `adminGuard`. Users without `KDUIAdmin` are sent to `/home`. The header shield icon is hidden unless the session has that role. JSON writes are checked **again** on the admin-config API (not only in the browser).

Stub login (offline shell) is given `KDUIAdmin` so the page can be demonstrated without Community.

### Admin UI

| Item | Behaviour |
|------|-----------|
| Route | `/admin` (KDUIAdmin) |
| Header | Shield icon (tooltip **Administration**) |
| Find | **Find an admin setting…** (`?q=`) |
| Document viewer | Mode, snippet redaction, endpoint URLs, Test endpoint |
| Persist | **Save to server** → `config/document-viewer.json` (+ assets / live nginx copy) |
| Reload | **Reload from server** reads the file through the API |

Personal Settings (`/settings`) no longer contains Document viewer. Session/localStorage overlays for those values are gone; the JSON file is the source of truth.

### Why a small Node writer

Pure Nginx cannot write JSON files. Search still goes **browser → Nginx → ACI**. The sidecar `apps/web/admin-config-api.mjs` only:

1. Checks Community `RoleUserGetRoleList` for `KDUIAdmin`
2. Validates the payload
3. Writes the whitelist file (`document-viewer.json` today)

`./serve.sh` starts it on `127.0.0.1:4201`. Angular proxies `/api/admin`. Production Nginx needs the same process and `location /api/admin/`.

## Files

| Area | Path |
|------|------|
| Role parse | `core/utils/community-roles.ts` |
| Guard | `core/guards/admin.guard.ts` |
| Admin page | `features/admin/admin.component.*` |
| JSON writer | `apps/web/admin-config-api.mjs` |
| Role name | `config/admin.json` (`adminRole`: `KDUIAdmin`) |

## Ops: create the Community role

In Community (IDOL Admin → Roles, or ACI):

1. Add role **`KDUIAdmin`**
2. Add the operators who should see Administration
3. Sign out and in again so UserRead / RoleUserGetRoleList pick it up

## Verify

1. User **without** `KDUIAdmin`: no shield; `/admin` redirects to `/home`.
2. User **with** `KDUIAdmin`: shield → Administration; change viewer; Test endpoint; **Save to server**.
3. `config/document-viewer.json` (and `apps/web/src/assets/config/document-viewer.json`) match the UI.
4. Another browser session sees the saved mode after reload.

## Follow-on (M11 remainder)

Databases and parametric filters are still JSON-on-disk. The same `/admin` page and writer can grow whitelist entries for those files.
