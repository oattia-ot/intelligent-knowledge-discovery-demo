# Intelligent Knowledge Discovery Demo changelog

## [1.2.10] - No duplicate NiFi questions, Test icons, :27111 → :8443

- `install.sh` passes `--no-wizard --nifi-location …` so `start.sh` does not
  ask local/remote/URL again.
- Connection **Test** shows a green ✓ or red ✕.
- Browser hits to `http://HOST:27111/nifi` redirect to the working
  `https://HOST:8443/nifi`. `/nifi-api` stays on the proxy for the assistant.

## [1.2.9] - Stop NiFi redirect to :8080

- nifi-proxy sent `X-ProxyPort: 8080` (`$server_port` inside the container).
  NiFi then redirected `http://20.86.52.130:27111` → `:8080/nifi/`.
- Now `X-ProxyPort` / `X-Forwarded-Port` are the published host port
  (`NIFI_PROXY_HOST_PORT`, default 27111) and `Location` headers to
  `:8080` / `:8443` are rewritten back onto the incoming URL.

## [1.2.8] - NiFi proxy context path / Unauthorized

- nifi-proxy no longer sends `X-ProxyContextPath: /nifi` by default
  (IDOL only allows `/idol-nifi` → token HTTP 400).
- API calls from `nifi-proxy` hostname are rewritten to Host `localhost`.
- `scripts/patch_idol_nifi_proxy.sh` adds `/nifi` and `20.86.52.130:27111`
  to the persisted IDOL `nifi.properties`.

## [1.2.7] - SSL cert folder prompt + left-aligned dialog actions

- `install.sh` asks for the SSL certificate folder. Default:
  `$HOME/idol-docker-setup/utilities/generate-ssl-certs/ssl`
  (flag `--ssl-cert-dir`). Path is written to `.env` as `SSL_CERT_DIR`
  and mounted at `/ssl` on `nifi` / `nifi-proxy`.
- NiFi AI Connection / template popups: Close and Test sit on the **left**.

## [1.2.6] - Invalid SNI on IDOL NiFi

- nifi-proxy now forces TLS SNI/Host to `localhost` (IDOL cert name).
- Orchestrator/MCP try `http://nifi-proxy:8080/nifi-api` before
  `https://<container>:8443/nifi-api`.

## [1.2.5] - Ship missing kd-nifi-ai-mcp start.sh

- `install.sh` line 223 failed with `./start.sh: No such file or directory`
  because `kd-nifi-ai-mcp/start.sh` and `docker-compose.yml` were documented
  but omitted from the zip.
- Added `start.sh`, `docker-compose.yml`, and `nifi-proxy/` (HTTP :27111 → NiFi TLS).

## [1.2.4] - Tutorials + shared operational pills

- Added `docs/tutorials/` (index + NiFi AI, AI Chat, Documents/Experts/profile guides).
- Root `README.md` lists the same Tutorials section.
- Page actions use `.op-btn` (Documents/Experts, Experts Search, AI Chat
  New conversation / Send, Settings On/Off chips) matching the NiFi AI pill.
- Header **Experts** pill appears when Experts is On.

## [1.2.3] - Header Home + Connection button style + NiFi session fix

- Search UI header has a **Home** pill button on the left of the brand group.
- NiFi AI chat header has **Home** on the left; Connection / Close / Test /
  Cancel / Save / Activity buttons share the same pill style as the app.
- Home inside the NiFi AI iframe posts `kd-nifi-ai` / `home` so the overlay closes.
- IDOL `docker-compose.yml` publishes `27111:8443`, allows `/nifi` and
  `/idol-nifi` proxy context paths, and lists `20.86.52.130:27111` in
  `NIFI_WEB_PROXY_HOST` so `/nifi/#/error` Unauthorized no longer fires.

## [1.2.2] - Manageable NiFi templates + Experts default off

- `kd-nifi-ai-mcp/templates/` is no longer a flat dump. Specs live under
  `ingest/`, `idol-nifi2/`, and `stages/`, indexed by `catalog.json`.
- The orchestrator loads that catalog from disk (`KD_TEMPLATES_DIR`) and
  writes "+ Add template" into `templates/custom/`.
- Experts search defaults to Off (`loadExpertsSearch()`). Clear
  `sessionStorage.fta_experts_search` to drop a previous On. Hide the
  feature entirely with `"enabled": false` in `expertise.json`.

## [1.2.1] - Configurable Community health-check timeout

- Settings → Application exposes **Health check timeout** (1–60 seconds).
- Login preflight and Settings → Test use that value instead of only the
  8s default in `endpoint-health.json`.

## [1.2.0] - Orchestrator public URL + activity log

- Startup scripts detect a public/external host IP and persist
  `ORCHESTRATOR_PUBLIC_URL` in `kd-nifi-ai-mcp/.env` (private addresses skipped).
- UI is rebuilt so the browser talks to `http://<external-ip>:27110`.
- NiFi AI chat window has a collapsible bottom Activity log panel.

## [1.1.0] - NiFi settings from field issues

- Probe NiFi (token + `/nifi-api/flow/about`) before deploying the AI app.
- Ignore stale example host `172.25.125.123`; prefer `idol-demo-idol-nifi-1`
  on `idol-demo-network`.
- Drop `host.docker.internal` from primary `NIFI_API_BASES` (Invalid SNI).
- Remove hardcoded `container_name` so local/external compose projects
  do not reuse each other's containers and env.
- Document the user questions that caused the misconfig in `USER_QUESTIONS.md`.
- Offline checker: `kd-nifi-ai-mcp/scripts/test_nifi_settings.py`.

## [1.0.0] - Unified package

- Merged `kd-sandbox-ai-demo` and `kd-nifi-ai-mcp` into one Intelligent
  Knowledge Discovery Demo package, with original trees preserved.
- `install.sh` always deploys the search UI and prompts for optional NiFi AI
  (local / external URL / skip). Colored output.
- `nifi-ai.json` drives the header **NiFi AI** button. When enabled, the
  button opens an in-page demo-themed overlay on `http://localhost:4200`
  (no route change, no new tab). `/nifi-ai` is proxied to the chat UI.
- External NiFi uses Compose project `kd-nifi-ai-mcp-ext`; local uses
  `kd-nifi-ai-mcp`.
- `undeploy.sh` stops services and keeps caches; `cleanup.sh` wipes
  artifacts and optional Docker volumes.
