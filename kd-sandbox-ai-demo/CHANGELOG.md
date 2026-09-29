## Clean script syncs kd-nifi-ai-mcp

- `./clean.sh` also finds the sibling `kd-nifi-ai-mcp` folder (or
  `KD_NIFI_AI_MCP_HOME`) and runs its cleaner so both packages drop
  generated `.env` / `ports.json` / custom leftovers together.
- `--no-peer` keeps the clean local. `--sync-only` refreshes the contract
  without a full wipe.

## NiFi AI: server-owned list + click runs on orchestrator

- Hard-coded sidebar Actions/Skills were removed from the embedded NiFi AI page.
  Lists load from the orchestrator (`/lookup/actions|skills|templates`).
- Adding or importing an item now POSTs MCP `addObject` so it lives on the server.
- Deleting an item POSTs `deleteObject`. Clicking any item POSTs `runObject`,
  which the orchestrator executes through the same path as `/chat`.
- Refresh pulls `listObjects` from the server so items added in either package appear.
- Test leftovers `aaa` / `aaaa` / `xxx` were removed from `templates/custom/`.

## NiFi AI: empty `needs` handling

- Empty `needs` is derived from the prompt tokens (create, import, edit, export).
- Run resolves the prompt from `data-prompt` or the stored catalog.
- Unresolved `{{tokens}}` open the parameter dialog instead of being sent literally.

## NiFi AI: MCP run/refresh, ghost Add buttons, badge-only counts

- Clicking an Action/Skill/Template now sends an MCP `tools/call` (`runObject`) to `POST /api/admin/nifi-ai/mcp`.
- Refresh now sends `refreshObjects` to the same route, so it is traced in the server log.
- Add Action / Add Skill / Add template all use `<button type="button" class="ghost" id="addAct|addSkill|addTpl">`.
- Section labels no longer show a number; only the round badge shows the total.
- Dev proxy logs no longer label every `/api/nifi-ai` call as `clearAllObjects`.
- See `docs/NIFI_AI_MCP_RUN_REFRESH.md`.


## NiFi AI lifecycle refactor

- Consolidated Action, Skill, and Template creation, import, and reload restore through `upsertObject()`.
- Consolidated deletion through `removeObject()`.
- Replaced the separate created-object click binder with idempotent `bindObjectClick()`.
- Normalized object identity for duplicate detection, persistence, import, export, and restore.
- Moved Add controls into their corresponding Actions, Skills, and Templates sections.
- Added `npm run verify:nifi-ai` for dependency-free structural verification.

# CHANGELOG — Intelligent Knowledge Discovery Demo

Tracing log of all notable changes, UI improvements, and package clean-ups.

Note: some older console prefixes, localStorage keys, and env names still say `KD` because that is what the running scripts and UI emit (`[KD]`, `KD_UPSTREAM_HOST`, `kd_enable_rtl_languages`, `/__kd-probe`). Those are implementation keys, not the product name.

---

## [v5.9.20] — 2026-09-27 — Clear all persists in the UI and logs the method

- Clear all deletes Actions, Skills, and Templates from the overlay lists and keeps them cleared (tombstones + `kd-nifi-ui-cleared` lock).
- Clicking Clear all calls `POST /api/admin/nifi-ai/clear-all` with `method=clearAllObjects`.
- `admin-config-api` logs `[KD][NiFi AI] calling method=clearAllObjects ...` and forwards the call to the NiFi orchestrator and UI ports.
- Refresh explicitly rescans the embedded NiFi lists; Import / Add recreate objects normally.

## [v5.9.19] — 2026-09-27 — Export all includes native list entries

- Export all now harvests every Actions / Skills / Templates list entry
  (native side buttons and created cards), not only the injected empty host.
- ACTIONS, SKILLS, and TEMPLATES nav-toggles stay collapsed until the user
  opens them; collapse is applied per section once it exists in the DOM.

## [v5.9.18] — 2026-09-27 — NiFi AI rail + prompt wait

- Left-rail `nav-toggle` label `ACTION` is renamed to `ACTIONS` (count suffix kept).
- Actions / Skills / Templates sections start collapsed on load.
- Each `kd-nifi-kind-list` is pinned to the bottom of its parent `.nav-section`.
- Bottom rail buttons: Export all (formatted JSON of every action/skill/template),
  Import all (load those objects from a JSON file), Refresh (re-scan the lists).
- Asking a question in `#input` / the inspect-or-build composer shows the same
  processing spinner used elsewhere while the prompt runs.

## [v5.9.17] — 2026-09-26 — Add controls consolidated below the chat box

- Add Action, Add Skill, and Add Template no longer live inside their own
  section's list. All three now sit together in one group directly below
  the panel's main prompt/chat textbox, at the bottom of the left panel.
- Add Template still relocates NiFi's own native control (not a clone), so
  its existing create flow is untouched; Add Action/Add Skill still open
  the same SAP-ingest-style dialog as before.
- Saving a new action/skill/template still appends it to the correct
  section's list (Actions / Skills / Templates), it just no longer has an
  Add row to land next to inside that list.
- Each section's list keeps its Edit/Delete-enhanced items and collapse
  behavior exactly as before — only the Add control moved.

## [v5.9.16] — 2026-09-26 — Add row moves to the bottom of each list

- Add action / Add skill / Add template now appends after the existing
  items in its section instead of before them. Still inside its own list
  (never root-level), still hidden when the section is collapsed, and the
  MutationObserver keeps it pinned to the bottom even after a new item is
  created above it.

## [v5.9.15] — 2026-09-26 — Force param popup on parameterized skills/actions

- Clicking a skill or action with parameters always opens the SAP-ingest
  style window first (no silent run). Params are read from tokens and data-* attrs.

## [v5.9.14] — 2026-09-26 — Add row first in each NiFi list

- Actions / Skills / Templates left lists get Add action|skill|template as
  the first entry. Dialog includes name + prompt with {{parameter}} tokens.

## [v5.9.13] — 2026-09-26 — SAP-ingest style dialogs

- Skills, actions, and templates use the same parameter window pattern as
  Complete SAP ingest (navy header, gold accent, Cancel / Continue / Esc).
- Add skill / Add action buttons added next to Add template.

## [v5.9.12] — 2026-09-25 — Audit + rank compare

- `serve.sh` / `deploy.sh` run `npm audit fix` (non-blocking) after install.
- Match % control compares each hit to the previous result (↑ / ↓ / → pts).
- NiFi param dialog TypeScript compile fix.

## [v5.9.11] — 2026-09-25 — NiFi AI parameter popup

- Skill / action / template clicks in the NiFi AI iframe open a parameter
  dialog (same overlay pattern as template selection).
- Cancel and Escape close only that dialog; Continue applies values and runs.

## [v5.9.10] — 2026-09-25 — PPT preview + match ranking

- Rewrite View HTML asset URLs (`src`/`href`/`url()`) through `/view` so
  PowerPoint slide images load in the blob preview iframe (fixes black screen).
- Force a light preview background on converted Office HTML.
- Show IDOL relevance as a match % on each result; sort hits high → low
  (`Sort=Relevance`).

## [v5.9.9] — 2026-09-24 — Security hardening

- Probe server allow-lists IDOL hosts/ports and GetStatus only (closes SSRF).
- Login no longer posts passwords through `/__kd-probe`.
- CORS no longer reflects arbitrary Origins.
- Preview iframe sandboxed; CSP on index.html.
- Idle session timeout; console logs redact SecurityInfo/Password.
- See `docs/SECURITY.md`.

## [v5.9.8] — 2026-09-24 — Restore preflight-health.service.ts

- Restored `apps/web/src/app/core/services/preflight-health.service.ts`
  (file was empty in the previous package, so `ng serve` failed with
  TS2306 "is not a module" and the login page never compiled).

## [v5.9.7] — 2026-09-24 — Remove FTA naming

- Replaced remaining `FTA` / `fta` identifiers with `KD` / `kd`
  (env vars, proxy paths, CSS tokens, localStorage keys, systemd unit names,
  theme id `kd-gold`, admin role `KDUIAdmin`).
- `KD_LIVE_RELOAD=1` enables Angular hot reload (was `FTA_LIVE_RELOAD`).

## [v5.9.6] — 2026-09-24 — Stable demo UI (no periodic full reload)

- Stopped the live Content catalog from writing `src/assets/config/databases.json`
  on every Settings / search refresh. That write made Vite/`ng serve` full-reload
  the main page every few seconds.
- `generate-config.mjs` now writes JSON only when content actually changed.
- Admin server persists `config/databases.json` only (never runtime assets).
- Demo serve defaults to `--live-reload false --hmr false`. Set `KD_LIVE_RELOAD=1`
  when you want hot reload while developing.

## Tutorials and `.op-btn`

- Operator guides are in the package `docs/tutorials/` folder.
- Home Documents/Experts, Experts Search, AI Chat New conversation / Send,
  and Settings On/Off chips share `.op-btn` with the NiFi AI header pill.
- Header shows Experts when the feature is On.

## [v5.9.5] — 2026-09-12 — Experts search Off by default

- Settings → Experts search now defaults to Off when
  `sessionStorage.kd_experts_search` is unset.
- Clear that key to reset a previous On. Set `expertise.json`
  `"enabled": false` to hide Experts entirely.

## [v5.9.4] — 2026-09-05 — Configurable health check timeout

- Settings → Application → **Health check timeout** sets how long login
  preflight and Settings → Test wait for Community `GetStatus` (1–60s).
- Saved in this browser (`kd-endpoint-health-timeout-ms`); file default
  remains `endpoint-health.json` → `defaults.timeoutMs` (8000).

## [v5.9.3] — 2026-09-01 — Default OpenText logo

- Bundled `assets/branding/logo.png` (OpenText ot mark) as the default header, home, and login logo.
- Favicon updated to the same mark. Uploading a custom logo in Settings still overrides it; Remove restores the default.

---

## [v5.9.2] — 2026-09-01 — Editable home subtitle + one Localization save

- Home hero title/subtitle now use Localization & Themes branding (no hardcoded `environment.appName`).
- Localization & Themes has a single **Save changes** button that writes title, subtitle, footer, and custom theme, then closes Settings.

---

## [v5.9.1] — 2026-09-01 — Search Configuration tab

- Renamed Settings tab **Business Configuration** → **Search Configuration**.
- Moved Search settings (recommendations, experts, profile, expanded query) into that tab.
- Removed the extra header **Search settings** button; use Settings → Search Configuration.

---

## [v5.9] — 2026-09-01 — Missing search features merged

- Added My Recommendations (`/recommendations`, home panel, header star) from Community profile terms.
- Added Experts search (`/experts`, home Documents/Experts toggle) and preview ProfileUser training.
- Added searchable session Settings (`/settings`, `/settings/profiles`).
- Added role-gated Administration (`/admin`, `KDUIAdmin`) and document-viewer JSON writer (`admin-config-api.mjs` on `:4201`, proxied at `/api/admin`).
- Added snippet-redaction / document-viewer config files and redaction preview path.
- Kept sandbox-only capabilities (branding overlay Settings, live Content databases, i18n, probe/admin servers).

---


## [v5.8.12] — 2026-08-30 — AI Chat calls AnswerServer Ask directly

- User questions call `action=Ask` on `/answerserver/` first (proxy → `https://host:12000`), systems `RAG,Grok`.
- Console: `[KD Ask]` (legacy log prefix) `request → AnswerServer` with `proxyEndpoint`, `directEndpoint`, `directUrl`, SystemNames, Text, DatabaseMatch.
- `DatabaseMatch=*` is no longer sent (IDOL would look for a DB named `*`). Empty chat scope means all databases.
- If Ask has no text, chat falls back to KDChat `Converse`.

---

## [v5.8.11] — 2026-08-30 — Chat lists live Content databases

- “what databases” / “list searchable KD databases” uses Content `GetStatus` via `IdolDatabasesService` — same active names and document counts as Settings → Databases.
- Broader local-command match so those phrases are not sent to RAG.

---

## [v5.8.10] — 2026-08-30 — Console logs of endpoint requests

- HTTP interceptor logs method, URL, decoded query/body (`Data` base64 expanded) as `[KD] request → server` and the status/timing as `[KD] response ← server`.
- `ConversationService` also prints `[KDChat] ManageResources|Converse` with endpoint, system, session id, and text.

---

## [v5.8.9] — 2026-08-30 — AI Chat POST + long RAG proxy timeout

- `ConversationService` uses POST (form-urlencoded) for `ManageResources` and `Converse` instead of GET. `Data` remains base64 JSON (AS 26.3 rejects raw JSON with “invalid base64 encoded data”).
- Vite `/answerserver` proxy timeout raised 20s → 180s so RAG Converse is not cut off as Angular `HTTP status 0`.
- Status-0 chat errors now mention same-origin proxy, TLS verify, and the 180s window.
- Nginx sample adds lowercase `/answerserver/` and `proxy_ssl_verify off` for sandbox certificates.

---

## [v5.8.8] — 2026-08-27 — Dev proxy uses TLS sandbox host (no socket hang up)

- Empty `upstreamHost` no longer falls back to `http://127.0.0.1:9100`. Default is `https://172.25.125.123`.
- Settings Apply/Save writes `protocol` next to `upstreamHost` so the Vite proxy matches Settings → Test.
- Proxy errors print the target URL; `socket hang up` adds a HTTP-vs-TLS hint.
- `requestUrl()` keeps `/content`, `/qms`, … instead of collapsing to `/`.

---

## [v5.8.7] — 2026-08-27 — Filter by database uses existing Content DBs

- Search sidebar **Filter by database** lists only databases returned by Content `GetStatus` (labels/title fields still come from `databases.json` when names match).
- Queries, facets, AQG, and AnswerServer use `DatabaseMatch` for the checked boxes only.
- If GetStatus cannot list databases, the configured catalog is kept so search still works.

---

## [v5.8.6] — 2026-08-27 — Login uses the same Community path as Test

- Settings → Test can succeed (`https://host:9030` via `/__kd-probe`) while login pre-flight failed: the browser was calling `https://host/community` (CORS / port 443), not Community ACI.
- Pre-flight and UserRead now use the same-origin `/community` proxy, then fall back to the Test probe when the proxy still points at localhost HTTP.

---

## [v5.8.5] — 2026-08-27 — Create requires live Content ACI

- Creating a database first probes Content ACI `GetStatus` (`:9100`). A lone HTTP 200 from `DRECREATEDBASE` on `:9101` is no longer treated as success.
- Index responses must be a real IDOL ack (`INDEXID=`, queued, or ACI success). Empty bodies and HTML pages fail with an explicit error.

---

## [v5.8.4] — 2026-08-27 — Create database hits Content index port

- `DRECREATEDBASE` is proxied to Content **index** port `:9101` as `/DRECREATEDBASE`, not `/Index/DRECREATEDBASE` on ACI `:9100` (that 404'd).
- Databases Refresh/Create buttons always leave the Loading state when the request finishes.

---

## [v5.8.3] — 2026-08-27 — Probe port reuse on :4300

- Probe server on `:4300` reuses an existing listener instead of crashing with `EADDRINUSE` (same behaviour as the admin server on `:4301`).
- `serve.sh` no longer starts a second probe/admin process when the port is already bound.

---

## [v5.8.2] — 2026-08-27 — Faster DB list, admin port reuse, AnswerServer row

- Databases tab lists Content DBs from XML `GetStatus` first (smaller than simplejson), races query/index ports, 5s timeout, 15s cache. Refresh button still forces a live fetch.
- Admin server on `:4301` reuses an existing listener instead of crashing with `EADDRINUSE`.
- Application Configuration path + suffix (e.g. `/answerserver`) stay on one row; the input shrinks instead of wrapping the suffix.

---

## [v5.8.1] — 2026-08-27 — Login without SecurityInfo token

- UserRead XML parser now finds `securityinfo` in any namespace or case, including a nested `securitystring`.
- Login sends `SecurityInfo=True` (IDOL-style boolean).
- If Community authenticates the user but does not mint a token (no SecurityInfo keys on the sandbox), login still completes with an **unsecured** session instead of blocking on “did not return SecurityInfo”.
- Search/Content calls omit `SecurityInfo` for stub and unsecured sessions.

**Files touched**
- `apps/web/src/app/core/services/auth.service.ts`
- `apps/web/src/app/core/models/auth-user.ts`
- `apps/web/src/app/core/services/search.service.ts`
- `apps/web/src/app/features/search/search.component.ts`

---

## [v5.8] — 2026-08-27 — Pre-flight Community health check

- Login no longer assumes Community is up. On `/login` the app calls `action=GetStatus` against the same Community base URL used by `UserRead`.
- While the check runs, the form is disabled. If Community is down, times out, returns a proxy 502/503/504, or serves the SPA HTML instead of ACI XML, sign-in stays blocked and the reason is shown.
- **Retry check** re-runs the probe. Closing Settings after a Community URL change also re-runs it.
- Settings is available on the login header (Application Configuration tab) so the Community endpoint can be fixed without a session.
- Stub auth (`environment.useStubAuth`) skips the probe so the offline shell still works.

**Files touched**
- `apps/web/src/app/core/services/preflight-health.service.ts`
- `apps/web/src/app/features/login/login.component.{ts,html,scss}`
- `apps/web/src/app/shared/components/header/header.component.{ts,html}`
- `apps/web/src/app/core/i18n/translations.ts`
- `docs/ARCHITECTURE.md`

---

## [v5.7] — 2026-08-26 — New branding defaults + Databases tab

- Default header title is **Intelligent Knowledge Discovery Demo**.
- Default subtitle is **Internal staff · Knowledge Discovery** (replaces stored “… 123”).
- Settings has a **Databases** tab after Application Configuration: lists IDOL databases from Content `GetStatus`, can create a database, and notes that delete is only available in the KD Admin UI.

**Files touched**
- `apps/web/src/app/core/services/branding.service.ts`
- `apps/web/src/app/core/services/settings-ui.service.ts`
- `apps/web/src/app/core/services/idol-databases.service.ts`
- `apps/web/src/app/features/settings/settings-panel.component.{html,ts,scss}`
- `apps/web/src/app/core/i18n/translations.ts`
- `config/environment.template.json`
- `apps/web/src/assets/config/environment.template.json`

---

## [v5.6] — 2026-08-26 — RTL checkbox default off

- **Enable RTL languages** stays unchecked unless the user has explicitly turned it on (`kd_enable_rtl_languages=1`).
- Browser Hebrew/Arabic is no longer auto-selected when that checkbox is off, so the layout does not start in RTL by default.

**Files touched**
- `apps/web/src/app/core/i18n/i18n.service.ts`

---

## [v5.5] — 2026-08-26 — Single Test and Save notes disclosure

- Merged **Backend upstream host** into the **Test and Save notes** collapsed panel. One disclosure now holds both the Test/Save explanation and the upstream-host controls.

**Files touched**
- `apps/web/src/app/features/settings/settings-panel.component.html`
- `apps/web/src/app/features/settings/settings-panel.component.scss`

---

## [v5.4] — 2026-08-26 — Collapse Backend upstream host and Test/Save notes

- Settings → Application Configuration: **Backend upstream host (dev server)** is collapsed by default.
- The Test / Save explanatory notes (`statusPath` + browser-only Save) are collapsed by default under **Test and Save notes**.

**Files touched**
- `apps/web/src/app/features/settings/settings-panel.component.html`
- `apps/web/src/app/features/settings/settings-panel.component.scss`

---

## [v5.3] — 2026-08-26 — Test all endpoints under Components

- Settings → Application Configuration: moved **Test all endpoints** from the bottom footer to the **Components** section header (next to the title).

**Files touched**
- `apps/web/src/app/features/settings/settings-panel.component.html`
- `apps/web/src/app/features/settings/settings-panel.component.scss`

---

## [v5.2] — 2026-08-26 — Apply to all also saves & restarts

- Settings → **Backend upstream host**: removed the separate **Save & Restart** button.
- **Apply to all** now both pushes protocol/host into every component row and runs the previous save + dev-server restart flow.
- **Apply to all** stays enabled (except while a save/restart is already in flight) so pressing it always applies the current textbox value.

**Files touched**
- `apps/web/src/app/features/settings/settings-panel.component.html`
- `apps/web/src/app/features/settings/settings-panel.component.ts`

---

## [v5.1] — 2026-08-26 — Empty upstreamHost allowed + placeholder text

- Settings → **Backend upstream host** textbox may now be left empty and saved.
  Saving an empty value writes `"upstreamHost": ""` into `config/config.json`.
  On the next start the resolution order falls through to `KD_UPSTREAM_HOST`
  (env) or the hardcoded default in `upstream.config.mjs`.
- Placeholder text changed from `e.g. 127.0.0.1 or demo.internal` to
  `e.g. 1.2.3.4 or your.domain.com`.

**Files touched**
- `apps/web/src/app/features/settings/settings-panel.component.html`
- `apps/web/src/app/core/services/upstream-host-admin.service.ts`
- `apps/web/scripts/admin-server.mjs`

---

## [v5-clean] — 2026-08-25 — Clean distribution package

### Package hygiene
- Removed `node_modules/` and `.angular/cache/` from the distribution ZIP (they are restored by `npm install`).
- Removed generated log file `apps/web/proxy-smoke.log`.
- Kept only source, config, docs, scripts, and lockfile required to rebuild and run.
- Updated root `README.md` with complete, path-agnostic installation instructions.
- Consolidated change history into this single tracing log.

### Result
- Distribution size reduced from ~96 MB to a few hundred KB of source.
- Fresh clone / extract → `npm install` → `./serve.sh` is the only required path.

---

## [v21] — 2026-08-25 — Protocol toggle clears log + consistency fixes

- Protocol HTTP/HTTPS toggle on every endpoint row now clears that row’s verification state and its log lines, and hides the Endpoint test log section when the buffer becomes empty.
- Changing the IP/FQDN textbox also hides the log section when it becomes empty (consistent with protocol toggle and Reset).
- Explicit Clear button on the health log now hides the section after clearing (reappears on next Test).
- Bare-host fallback in `EndpointHealthService.statusUrl` now inherits protocol (http/https) from `endpoint-health.json` `testBase` instead of hard-coding `http://`.

**Files touched**
- `apps/web/src/app/features/settings/settings-panel.component.{html,ts,scss}`
- `apps/web/src/app/core/services/endpoint-health.service.ts`
- `apps/web/CHANGELOG.md`

---

## [UI languages + Application Configuration] — 2026-08-24 / 2026-08-25

### Application Configuration
1. Removed the global **Protocol & host** section.
2. Per-row HTTP/HTTPS switch on every component (path and origin rows).
3. Host input is **FQDN / IP** (optional). For path-kind components the fixed component path (e.g. `/community`, `/view`) is shown next to the input and is concatenated when building the URL:
   - `protocol://host/path`
   - Empty host → same-origin path only (e.g. `/community`).
4. Preview and Test/Save use the per-row protocol + host + fixed path.
5. Protocol toggle clears log (see v21 above).
6. Changing the IP/FQDN textbox or pressing Clear on the log also hides the log section when empty.
7. Bare-host probe fallback inherits protocol from `endpoint-health.json` `testBase`.

### Languages
1. Added **Czech** (`cs`) and **Arabic** (`ar`).
2. New switch **“Enable RTL languages”** in Localization.
3. **Hebrew** and **Arabic** appear in the language list **only when** the RTL switch is enabled.
4. Turning the switch off while Hebrew/Arabic is active falls back to English.
5. Preference persisted in `localStorage` (`kd_enable_rtl_languages`).

**Files touched**
- `apps/web/src/app/features/settings/settings-panel.component.{html,ts,scss}`
- `apps/web/src/app/core/services/endpoint-health.service.ts`
- `apps/web/src/app/core/i18n/translations.ts`
- `apps/web/src/app/core/i18n/i18n.service.ts`

---

## [v9 / v8] — Runtime FQDN, probe & startup fixes

- Fixed endpoint Test URL precedence so the current Application Configuration FQDN/IP is used at runtime instead of stale `endpoint-health.json` `testUrl` values.
- The configured endpoint service port is preserved when a new bare IP/FQDN is entered.
- Added per-endpoint health-log clearing when that endpoint changes.
- Reset only the changed endpoint’s verification state, message, and URL.
- Automatically re-test changed endpoints after Save.
- Hardened `serve.sh` against missing or incomplete Angular CLI installations.
- `serve.sh` installs devDependencies explicitly and invokes the local Angular CLI directly, avoiding the `npx ng` “could not determine executable to run” failure.
- Runtime endpoint tests now pass through the Angular dev proxy using a dynamic target.
- `ng serve` logs the actual target and `/action=getstatus` test path for runtime probes.
- UI success, HTTP error, timeout, and network error messages now show `{target,test}` instead of a hard-coded path.
- Endpoint test logs record the runtime target and test path as structured JSON, e.g.  
  `{"target":"http://127.0.0.1:9030","test":"/action=getstatus"}`.
- Auto-repair Angular CLI if missing; prefer local `ng` executable.
- Per-row log reset on protocol / host change.

---

## [Earlier update package] — Theme, proxy test URLs, Test button

### Proxy entries
Every proxy path now carries:

```json
"/community": {
  "target": "http://…:9030",
  "secure": false,
  "changeOrigin": true,
  "pathRewrite": { "^/community": "" },
  "logLevel": "info",
  "test": "/action=getstatus",
  "testUrl": "http://…:9030/action=getstatus"
}
```

| Field     | Meaning |
|-----------|---------|
| `target`  | Upstream ACI host:port (used by the dev proxy) |
| `test`    | Health path appended on Settings → Test |
| `testUrl` | Full URL = `target` + `test` (what the Test button executes) |

### Theme
Inverse / control CSS tokens so text stays readable in both light and dark themes.

### Diagnostics
- `scripts/proxy-smoke.mjs` for offline Community ACI smoke tests.
- `UPDATE_NOTES.md` and `README_UPDATE_PACKAGE.md` document the packaging history.

### systemd
- `deploy/systemd/` unit + `install-service.sh` to run `./serve.sh` as a managed service.

---

## [Core milestones] — M0–M9 (summary)

| Milestone | Summary |
|-----------|---------|
| M0 | Docs, config, Grok skill scaffolding |
| M1 | Angular scaffold + demo gold theme shell |
| M2 | Community login + session (SecurityInfo) |
| M3 | Multi-database Query results |
| M4 | Facets / FieldText filtering |
| M5 | Document preview + download (View) |
| M5b | QMS TypeAhead autosuggest |
| M5c | Automatic Query Guidance (AQG) cluster hierarchy |
| M5d | Multi-concept search (tags + operator) |
| M8 | AnswerServer NLQA → Answer panel |
| M9 | Agentic chatbot (Continue in AI chat) |

Full detail lives in `docs/MILESTONE_*_COMPLETE.md` and `docs/ROADMAP.md`.

---

## How to keep this log up to date

After every meaningful change:

1. Append a new dated section at the top of this file.
2. List behavioural changes and the files touched.
3. Update the Status table in `README.md` if a milestone advances.
4. Keep `UI_IMPROVEMENT_NOTES.md` in sync for the latest UI-focused work.
