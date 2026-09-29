# Changelog — NiFi AI (Intelligent Knowledge Discovery Demo)

## [0.4.3] - Paired clean.sh with sandbox

- New `./clean.sh` strips generated `.env`, `ports.json`, `__pycache__`,
  logs, and leftover `templates/custom/*.json`.
- When `kd-sandbox-ai-demo` sits next to this folder (or
  `KD_SANDBOX_AI_DEMO_HOME` is set), clean also syncs and runs the
  sibling `clean.sh`. Use `--no-peer` to stay local.

## [0.4.2] - Server-owned sidebar + runObject MCP

### Changed
- Actions and skills are no longer hardcoded in `ui/index.html`. The sidebar
  loads `GET /lookup/actions`, `/lookup/skills`, and `/lookup/templates`.
- Removed leftover test templates `custom/aaa.json`, `aaaa.json`, `xxx.json`.
- Clicking a list item calls orchestrator `POST /mcp` `tools/call runObject`,
  which executes the same path as `POST /chat`.

### Added
- `templates/actions.json` and `templates/skills.json` as the catalog source.
- MCP tools: `runObject`, `refreshObjects`, `listObjects`, `addObject`,
  `deleteObject`, `clearAllObjects`.
- `POST /lookup/actions`, `/lookup/skills`, `/lookup/objects`.
- `POST /api/nifi-ai/clear-all` and `POST /api/nifi-ai/run` for the sandbox.

## [0.4.1] - Answer Server, Knowledge Graph, face training, connector catalog

### Added
- Answer Server: Ask, GetResources, Converse, GetJobStatus.
- Knowledge Graph neighbor/path/subgraph/summary actions.
- Media face training and ListSpeakers.
- Community decrypt/delete; OmniGroupServer GetAllUsers.
- `kd_list_connectors` official 26.3 connector catalog.
- Content TermExpand and additional expert workflows.

## [0.4.0] - Knowledge Discovery 26.3 MCP capability layer

### Added
- `mcp-server/kd/` ACI client, version resolver, safety classifier, and capability registry targeting Knowledge Discovery 26.3.
- Machine-readable inventory at `knowledge-discovery/capabilities/capabilities.json`.
- FastMCP tools in `tools/knowledge_discovery.py` for Content, DAH, DIH, QMS, View, Agentstore, Category, Community, Eduction, Media Server, CFS, FCE, discovery, and workflows.
- Standalone server `mcp-server/kd_server.py`.
- Docs: `docs/KNOWLEDGE-DISCOVERY-MCP.md`, `docs/CAPABILITY-MATRIX.md`, `docs/GAP-ANALYSIS.md`.
- Unit tests `tests/test_kd_layer.py` (mocked ACI).

### Changed
- `app.py` / `server.py` register the KD catalog next to existing NAR/NiFi tools.
- Docker image copies the `kd` package.

### Compatibility
- Official Cloudera `entrypoint.py` path is unchanged.
- NAR 26.2 vs 26.3 isolation is unchanged.

## [0.3.25] - Version-aware IDOL NiFi NAR management

### Added
- Data-driven NAR registry under `nars/26.2` and `nars/26.3` with per-profile manifests.
- Compatibility resolver that distinguishes IDOL, NiFi product, Apache NiFi, NAR, and flow-definition versions.
- MCP / orchestrator tools: `list_idol_nar_versions`, `resolve_idol_nars`, `validate_idol_nar_compatibility`, `get_idol_nar_manifest`, `generate_idol_nifi_flow`, `validate_generated_idol_flow`, `install_idol_nars`, `diagnose_idol_nifi_environment`.
- Ten IDOL+NiFi reference flows, each stamped for 26.2 and 26.3 independently.
- Unit tests that forbid cross-version NAR selection and silent fallback.
- Docs: `docs/NAR-COMPATIBILITY.md`, `docs/MIGRATION.md`.

### Changed
- Compose mounts `./nars` and reads `IDOL_VERSION` / `NIFI_VERSION` / `IDOL_NAR_PATH`.
- Flow generation asks the resolver for a profile before emitting processors.
- Local NAR install may copy files; external NiFi is treated as a prerequisite.

## [0.3.24] - New flows via official NiFi MCP

### Changed
- Chat "sample / hello flow" calls Cloudera MCP `get_root_process_group`
  + `start_new_flow` first. Direct `/nifi-api` is only a fallback.
- Reply text states the flow was created through the official NiFi MCP server.
- IDOL-specific builders (GetFileSystem/PutIDOL, ExecuteDocumentPython) still
  use REST because those processor types are not in the official MCP catalog.


## [0.3.23] - Drop SSL folder prompt

### Fixed
- `install.sh` no longer asks for an IDOL generate-ssl-certs folder.
- Compose no longer bind-mounts `${SSL_CERT_DIR}` (a missing relative path
  became `service "nifi" refers to undefined volume .../ssl`).
- `nifi-proxy` self-signs. Leftover `SSL_CERT_DIR` is stripped from `.env`.


## [0.3.22] - Public canvas is https://HOST:27111/nifi

### Changed
- Host port **27111** now publishes `nifi-proxy` **TLS :8443**, not HTTP :8080.
- Open `https://20.86.52.130:27111/nifi` (accept the cert if self-signed).
- Internal orchestrator/MCP traffic stays on `http://nifi-proxy:8080/nifi-api`.


## [0.3.21] - http://HOST:27111/nifi serves the canvas

### Fixed
- `nifi-proxy` no longer 302s `/nifi` to `https://HOST:27111` (that port is
  HTTP-only, so the browser TLS handshake fails).
- `/nifi`, `/nifi-api`, and `/nifi-docs` are reverse-proxied to IDOL NiFi
  (`idol-nifi:8443`) with SNI=`localhost`.
- Stale upstream `nifi-manager:8443` is rewritten to `idol-nifi:8443`.
- IDOL compose must allow `/nifi` on `NIFI_WEB_PROXY_CONTEXT_PATH` and
  `HOST:27111` on `NIFI_WEB_PROXY_HOST`.


## [0.3.20] - NiFi connection green / red status

### Added
- Connection dialog **NiFi connection** turns green when `/settings/nifi` or
  **Test** succeeds, amber while the probe runs, and red when it fails.
- Failure banner:
  `NiFi is not reachable through this proxy` plus
  `http://localhost:27111 (nifi-proxy)` / upstream (`nifi-manager:8443` or
  `nifi:8443`) and the `--nifi-url` / boot-wait hint.
- `nifi-proxy` serves a red HTML page on HTTP 502/503/504 from `/nifi-api`
  while the upstream container is still booting.

## [0.3.19] - Live version + connection test icons + proxy SNI/context-path

### Fixed
- Chat **NiFi version** (`GET /nifi-api/flow/about`) no longer dies on:
  - `HTTP 400 Request Header Context Path not allowed` from nifi-proxy
    (`X-ProxyContextPath` / `X-Forwarded-Prefix` stripped on `/nifi-api`).
  - `HTTP 400 Invalid SNI` when calling `https://idol-demo-idol-nifi-1:8443`
    (TLS SNI forced to `localhost`, matching the IDOL self-signed cert).
- Browser URL `http://20.86.52.130:27111/nifi/#/error` **Unauthorized** was
  caused by a bad HTTPS redirect on the HTTP proxy port. 0.3.21 proxies
  `/nifi` instead. Direct TLS remains `https://20.86.52.130:8443/nifi`.
- Connection **Test** is `type="button"` (no longer closes the dialog) and
  shows a green check or red X icon from the `/settings/nifi/test` result.

# Changelog — NiFi AI (Intelligent Knowledge Discovery Demo)

## [0.3.18] - Shared button style + Home

- Header **Home** control on the left; Connection stays on the right.
- Connection dialog Close/Test, template Cancel/Save, and Activity Clear/Close
  use the same pill `.app-btn` style as the rest of the FTA-themed chrome.
- Home notifies the parent frame (`postMessage` action `home`) when embedded.

## [0.3.17] - Template catalog on disk

### Changed
- `templates/` is grouped by job: `ingest/`, `idol-nifi2/`, `stages/`, `custom/`.
- `templates/catalog.json` is the only index. Orchestrator `GET /lookup/templates`
  reads it from `KD_TEMPLATES_DIR`; `POST` persists to `templates/custom/`.
- Compose bind-mounts `./templates` into `ai-orchestrator`.
- Sidebar no longer hardcodes IDOL / file / SAP prompts separately.

## [0.3.16] - Auto public URL + activity log

### Added
- `scripts/configure_orchestrator_public_url.sh` detects a host public IPv4
  (skips RFC1918 / loopback / link-local), upserts
  `ORCHESTRATOR_PUBLIC_URL=http://<ip>:27110` in `.env`, recreates the `ui`
  service, and verifies the injected URL with curl.
- `start.sh` and root `install.sh` run that helper on every startup.
- Chat UI has a bottom-anchored, collapsed-by-default Activity log panel
  that records session fetches and chat events.

## [0.3.15] - README matches current start.sh

### Changed
- README documents local/remote wizard, IDOL image confirm, official
  Cloudera MCP, fixed ports, colored prompts, and `./start.sh down -v`.

## [0.3.12] - Local vs remote NiFi URL

### Changed
- `./start.sh` first asks **local or remote** NiFi.
- Local starts this project’s `nifi` container (`apache/nifi`, profile `create-nifi`).
- Remote then asks Linux / Windows / Docker and uses the existing
  health-check / Docker-network join logic.

## [0.3.11] - MCP is official Cloudera nifi-mcp-server only

### Changed
- `mcp-server` Docker image runs only
  [cloudera/nifi-mcp-server](https://github.com/cloudera/nifi-mcp-server)
  via `entrypoint.py` (`python -m nifi_mcp_server.server`, SSE on :8000).
- Local FastAPI `server.py` / `app.py` are deprecated and are not the
  container entrypoint.
- Healthcheck probes the FastMCP bind port instead of `GET /`.

## [0.3.10] - Deploy target + drop port 5000

### Changed
- `./start.sh` asks whether NiFi is on Linux, Windows, or Docker
  (`--nifi-deploy`). Linux/Windows health-check the nifi-api URL.
  Docker inspects the container network and joins it via
  `NIFI_DOCKER_NETWORK` / `NIFI_DOCKER_NETWORK_EXTERNAL`.
- Host probe never uses `https://127.0.0.1:5000/nifi-api` or Docker-only
  names such as `nifi-manager`.

### Notes
- MCP remains the official Cloudera `nifi-mcp-server`, not Cassandra MCP.

## [0.3.9] - Embeddable UI + AI test with Python

### Added
- `ui/embed.js` custom element `<kd-nifi-chat>` and
  `ui/embed-example.html` so another HTML file can host the assistant.
- Sample **AI test with Python** (`templates/idol-ai-python.json`):
  IdolSslConfigServiceImpl + IdolLicenseServiceImpl,
  GenerateDocumentFlowFile → ExecuteDocumentPython
  (`/python/ai/add_two_fields.py`) → success/failure funnels.
- Prompt: `Create an AI test with Python sample using ExecuteDocumentPython`.

## [0.3.8] - Sidebar UI + IDOL sample template

### Added
- Single-file chat UI at `http://localhost:27120/` with sidebar actions
  (sample flow, version, inspect root, IDOL ingest) and custom templates.
- `create_idol_sample_flow`: GetFile → KD metadata → IDOL `/action=index`.

## [0.3.7] - Sample flow on IDOL NiFi 2.9

### Fixed
- Sample flow uses `/nifi-api` first (official `start_new_flow` KeyError `'id'`
  on IDOL responses).
- Mutating REST calls send NiFi CSRF `Request-Token` plus Bearer.
- `403 Forbidden` on create process-group is explained; processors can be
  placed on the root canvas when a child group is not allowed.

## [0.3.6] - IDOL NiFi login + live version

### Fixed
- `/access/token` HTTP 400: default password is now `OpenText2026!`
  (OpenText IDOL demo). `changeme12345` in an old `.env` is replaced.
- Chat “NiFi version” calls `GET /nifi-api/flow/about` instead of letting
  the model invent `1.17.0` / `pg-1234567890`.
- Docker discovery prefers `idol-nifi` on `idol-demo-network`.

## [0.3.5] - Off-band ports + NiFi boot wait

### Changed
- Host ports moved off common local ports: UI `27120` (was 4200),
  orchestrator `27110` (was 8080), MCP `27115`, NiFi `27111`,
  proxy `27112`, Ollama `27134`. Internal container ports are unchanged.
- Chat UI injects `ORCHESTRATOR_PUBLIC_URL` at container start.

### Fixed
- `nifi-kd-mcp` crash loop on `ReadTimeout` to `nifi-proxy:8080/access/token`
  while NiFi 2.x is still booting. Entrypoint now waits (default 300s)
  and retries token auth with a short connect timeout.
- `nifi-proxy` uses Docker DNS + `proxy_connect_timeout 5s` so it does
  not hang on a NiFi that is not listening yet.

## [0.3.4] - Reuse existing NiFi / Ollama

### Added
- Startup probes Docker and the host for a live NiFi (`/nifi-api`) and
  Ollama (`/api/tags`). If found, that instance is reused and the matching
  compose service is not created.
- If none is found, a new container is created on the first free host port.
- `nifi-proxy` takes `NIFI_UPSTREAM` so it can front either `nifi:8443` or
  `host.docker.internal:<existing-port>`.
- `./start.sh --create-nifi` / `--create-ollama` force a fresh instance.

## [0.3.3] - Dynamic host ports

### Added
- `scripts/allocate_ports.py` and `./start.sh` pick the first free host ports
  for NiFi (`NIFI_HOST_PORT`, default 8555) and Ollama (`OLLAMA_HOST_PORT`,
  default 11434), plus the proxy/MCP/orchestrator/UI mappings if those are
  taken too. Chosen values are written to `.env` and `ports.json`.
- `docker-compose.yml` publishes ports from those env vars and rebuilds
  `NIFI_WEB_PROXY_HOST` so the NiFi UI accepts the selected host port.
- Orchestrator Ollama fallbacks honor `OLLAMA_HOST_PORT` when probing the
  Docker host gateway.

## [0.1.0] - Initial scaffold

### Added
- `mcp-server`: FastMCP-based server exposing NiFi REST API operations as
  MCP tools (`nifi_client.py`, `tools/processors.py`, `tools/flows.py`,
  `tools/validation.py`).
- `mcp-server/tools/opentext_kd.py`: higher-level composite tools
  (`create_kd_file_connector_flow`, `create_kd_sap_flow`,
  `create_kd_enrichment_flow`) so common Knowledge Discovery ingestion
  patterns can be created in one call instead of wiring every processor
  by hand.
- `ai-orchestrator`: prompt parsing contract, KD template registry,
  spec + NiFi-level validation, and the end-to-end
  `generate_and_deploy` pipeline with explicit approval gates before
  creation and before starting a flow.
- `templates/`: reusable JSON flow specifications for file, SAP,
  Documentum, and standalone IDOL indexing patterns.
- `docker-compose.yml`: local dev stack (NiFi + mcp-server +
  ai-orchestrator + ui placeholder).
- `ui/README.md`: scaffold instructions and API contract for the
  Angular AI chat application.

### Not yet implemented
- Database, REST, SharePoint, and xECM ingestion tools (same pattern as
  `create_kd_file_connector_flow`, not yet written).
- Real Angular UI (a minimal static HTML/JS chat page is provided instead
  so the stack builds without Node; ui/README.md has the Angular contract).
- Security/ACL metadata mapping, language detection, OCR stages.
- Retry/dead-letter-queue processor patterns.

## [0.3.2]

### Fixed
- `nifi-kd-mcp` ExitCode 0 after ~2s: the running image was still the
  FastMCP stdio `python server.py` entrypoint (stdin EOF). Replaced with
  a self-contained FastAPI `server:app` started by `uvicorn` so the
  process cannot exit when Docker closes stdin.

## [0.3.1]

### Fixed
- `nifi-kd-mcp` container exiting on startup: pin `mcp>=1.9.4` (streamable-http),
  install uvicorn/starlette, bind `0.0.0.0` at FastMCP construction time, and
  stop using stdio inside Docker (stdio exits when stdin is closed).

## [0.3.0]

### Added
- Chat UI rebuilt as an LLM-style assistant: sidebar, message bubbles,
  typing indicator, starter prompts, structured flow-plan cards, and
  deploy/start actions in-thread.
- Command-palette lookup (`⌘K`, `/lookup`) over KD templates, live NiFi
  processor types, and existing process groups.
- Runtime NiFi targeting: configure host/port/protocol/credentials of an
  already-running NiFi from the UI (`PUT /settings/nifi`,
  `POST /settings/nifi/test`) via new MCP tools `configure_nifi`,
  `get_nifi_connection`, and `ping_nifi`.
- Orchestrator lookup endpoints: `GET /lookup/templates`,
  `/lookup/processors`, `/lookup/process-groups`.
- `mcp-server` honors `MCP_TRANSPORT=streamable-http` and
  `MCP_HTTP_PORT` on startup. Compose adds `host.docker.internal` so the
  MCP container can reach a NiFi listening on the host.

## [0.2.0]

### Added
- `mcp-server/Dockerfile` and streamable-http transport support in
  `server.py` (`MCP_TRANSPORT=streamable-http`), so the MCP server can
  run as a network service instead of only stdio.
- `ai-orchestrator/main.py`: FastAPI service wrapping `flow_generator.py`
  with `/chat`, `/flows/{id}/approve-creation`, `/flows/{id}/approve-start`,
  `/flows/{id}/status` endpoints, plus `mcp_client.py` (streamable-http
  MCP client) and a `Dockerfile`.
- `ui/index.html` + `ui/Dockerfile`: minimal static chat UI served by
  nginx, talking to the orchestrator over the same endpoints the Angular
  app contract describes.
- `docker-compose.yml` now brings up all four services.

### Fixed
- Pinned `mcp<2.0.0` in both `mcp-server/requirements.txt` and
  `ai-orchestrator/requirements.txt` — mcp 2.x renamed `FastMCP` to
  `MCPServer` and would otherwise break `from mcp.server.fastmcp import
  FastMCP` on a fresh `pip install`.
