# kd-nifi-ai-mcp

Part of the **Intelligent Knowledge Discovery Demo** package. From the parent folder you can start this stack with `./install.sh --nifi local` or `./install.sh --nifi external --nifi-url https://HOST:8443`.

Chat UI + orchestrator on top of the official Cloudera NiFi MCP server
([cloudera/nifi-mcp-server](https://github.com/cloudera/nifi-mcp-server)).
This is **not** Apache Cassandra MCP.

An MCP server for Apache NiFi, paired with an AI chat interface, that
generates and deploys OpenText Knowledge Discovery (IDOL) flows from
natural-language prompts.

```
"Create a flow that monitors a Windows file share, extracts text and
metadata from PDF, Word and Excel files, enriches the documents with
OpenText Knowledge Discovery metadata, sends the documents to the IDOL
Content engine, and indexes them."
```

Current tree version: **0.4.1**.

## Knowledge Discovery 26.3 MCP tools

The local FastMCP catalog also exposes version-aware OpenText Knowledge
Discovery ACI tools (search, retrieve, index, Eduction, Media Server,
security, ingest, discovery). See `docs/KNOWLEDGE-DISCOVERY-MCP.md`.

Standalone: `python mcp-server/kd_server.py`. Docker still starts official
Cloudera NiFi MCP via `entrypoint.py`.

## Version-aware IDOL NiFi NARs

IDOL version, Apache NiFi version, IDOL NiFi NAR version, processor version, and
generated flow version are tracked separately. The MCP server never picks a NAR
because the filename *looks* similar.

Supported profiles (see `docs/NAR-COMPATIBILITY.md`):

| Profile | IDOL | NiFi product | NAR | Apache NiFi |
|---|---|---|---|---|
| `idol-26.2-nifi-26.2` | 26.2 | 26.2 | 26.2.0-nifi2 | 2.0–2.4 |
| `idol-26.3-nifi-26.3` | 26.3 | 26.3 | 26.3.0-nifi2 | 2.9.0 |

How resolution works:

1. Parse the requested version from the prompt, tool args, or `IDOL_VERSION` / `NIFI_VERSION`.
2. Load `nars/compatibility-matrix.json` + `nars/<ver>/manifest.json`.
3. Select that exact profile. No fallback to another minor version.
4. Validate processors and (optionally) on-disk NAR files.
5. Generate the flow only after validation passes.

Add NARs by dropping the matching proprietary `idol-nifi-*-nar-<version>-nifi2.nar`
files into `nars/26.2/` or `nars/26.3/`. Register a new train by adding a folder,
manifest, and matrix row — do not create `latest/`.

Local NiFi (`NIFI_DEPLOYMENT_MODE=local`) may copy NARs into `NIFI_EXTENSIONS_DIR`.
External NiFi is a prerequisite; the server reports the exact artifacts and does
not push files remotely.

Example prompts:

```
Create an IDOL Content ingestion flow using version 26.2.
Create the same flow for 26.3.
Build an IDOL Content ingestion pipeline using NiFi 26.3.
Create a passage extraction flow using IDOL 26.2.
List IDOL NAR versions
```

If 26.3 artifacts are requested but that profile cannot be used:

```
Status: BLOCKED
Reason: No compatible IDOL NiFi NAR package is available for the requested environment.
```

Central env keys: `IDOL_VERSION`, `NIFI_VERSION`, `IDOL_NAR_VERSION`,
`IDOL_NAR_REPOSITORY`, `IDOL_NAR_PATH`, `NAR_VALIDATION_ENABLED`.
Do not hard-code 26.2 / 26.3 in new business logic.


## How it works

```
User Prompt
    │
    ▼
AI understands the request        (ai-orchestrator)
    │
    ▼
Match to a KD flow template        (ai-orchestrator/kd_templates.py)
    │
    ▼
Validate the spec                  (ai-orchestrator/flow_validator.py)
    │
    ▼
Show preview → wait for approval
    │
    ▼
Official Cloudera MCP tools        (mcp-server/entrypoint.py
    or NiFi REST fallback           → nifi_mcp_server.server)
    │
    ▼
Validate against live NiFi
    │
    ▼
Show status → wait for approval
    │
    ▼
start_flow
```

The AI never deploys anything without an explicit approval step.
Version questions call live `GET /nifi-api/flow/about` — they are not
answered from model memory.

```
orchestrator  --SSE-->  cloudera/nifi-mcp-server  --REST-->  /nifi-api
```

`mcp-server/server.py` and `app.py` are deprecated local FastAPI
gateways. Docker runs `entrypoint.py` only.

## Project layout

```
kd-nifi-ai-mcp/
├── start.sh                 Interactive deploy / undeploy
├── scripts/allocate_ports.py
├── scripts/configure_orchestrator_public_url.sh
├── scripts/probe_nifi.py
├── docker-compose.yml
├── mcp-server/              Official Cloudera MCP + token-auth wrapper
├── ai-orchestrator/         FastAPI chat + REST fallback
├── ui/                      Static chat UI
├── nifi-proxy/              HTTP front door → NiFi TLS
├── templates/               generator specs + catalog.json (not NiFi Templates)
│   ├── catalog.json         single index for UI / orchestrator
│   ├── ingest/              file, idol-file, sap, documentum
│   ├── idol-nifi2/          version-specific IDOL processors
│   ├── stages/              reusable mid-pipeline pieces
│   └── custom/              persisted "+ Add template" entries
└── CHANGELOG.md
```

## Credentials (the 400 login error)

`token HTTP 400: The supplied username and password are not valid` means
the stack reached NiFi but sent the wrong login.

OpenText IDOL NiFi (`microfocusidolserver/nifi-ver2-full:26.3`, UI 2.9.0)
is created with:

```
SINGLE_USER_CREDENTIALS_USERNAME=admin
SINGLE_USER_CREDENTIALS_PASSWORD=OpenText2026!
```

This project defaults to those values. `changeme12345` is treated as a
stale placeholder and replaced on the next `./start.sh`.

```bash
./start.sh --nifi-location remote --nifi-deploy linux \
           --nifi-url https://127.0.0.1:8443 \
           --nifi-user admin \
           --nifi-password 'OpenText2026!' \
           up --build
```

Then recreate the orchestrator/MCP containers so they pick up `.env`:

```bash
docker compose --env-file .env up -d --force-recreate ai-orchestrator mcp-server nifi-proxy
```

Confirm with the real API (not the chat model):

```bash
curl -sk \
  -X POST https://127.0.0.1:8443/nifi-api/access/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'username=admin&password=OpenText2026!'

curl -s http://localhost:27110/nifi/about
```

`/nifi/about` should report the live NiFi version. A reply of `1.17.0` /
`pg-1234567890` was the model inventing a result while login was failing.

## Running

```bash
chmod +x start.sh ui/docker-entrypoint.sh
./start.sh
```

Prompts are **yellow**. Other status lines are colored. After a
successful probe, `start.sh` prints a URL card for every service.

### `up` (default)

`./start.sh` and `./start.sh up --build` use the full wizard:

1. **Local or remote NiFi?**
2. If **remote**: **Linux / Windows / Docker?**
3. If **local**: confirm the IDOL image command (see below).
4. Probe `/nifi-api` (Linux/Windows health-check + login; Docker joins
   the container network). Port **5000** and Docker-only names such as
   `nifi-manager` are never probed on the host.
5. Write `.env` + `ports.json` (fixed 27xxx ports).
6. `docker compose --env-file .env up --build`

### `down`

```bash
./start.sh down -v
```

Skips every NiFi question. The only prompt is:

```text
Confirm undeploy and remove volumes? [y/N]:
```

`y` runs `docker compose --env-file .env down -v`.
`./start.sh down` also adds `-v`. Cancel with `n` or Enter.
A non-TTY session refuses undeploy so volumes cannot be wiped by accident.

## Local vs remote NiFi

### Local

Starts a NiFi container in this compose project (`create-nifi` profile),
upstream `nifi:8443`.

You are asked to confirm:

```text
NIFI_IMAGE=microfocusidolserver/nifi-ver2-full:26.3 ./start.sh --nifi-location local up --build
```

| Answer | Image |
|---|---|
| **Y** (default) | `microfocusidolserver/nifi-ver2-full:26.3` — IDOL NARs, same types as a typical remote demo |
| **n** | `apache/nifi:2.0.0` — stock processors only |

`NIFI_IMAGE` is written to `.env`. First start pulls the IDOL image
(large). Login is still `admin` / `OpenText2026!`.

```bash
./start.sh --nifi-location local up --build
./start.sh --nifi-location local \
  --nifi-image microfocusidolserver/nifi-ver2-full:26.3 \
  up --build
```

Stock `apache/nifi` does **not** know `idol.nifi.service.IdolSslConfigServiceImpl`.
A generic “sample flow” on that image is GenerateFlowFile → LogAttribute
only. IDOL samples (AI test with Python, PutIDOL) need the IDOL image
or a remote IDOL instance.

### Remote / external

Then asked how that instance is deployed:

| Platform | Behavior |
|---|---|
| **Linux / Windows** | Health-check `GET /nifi-api/access/config`, then login on `--nifi-url`. Compose does not join a foreign Docker network. |
| **Docker** | Inspect the NiFi container’s networks. Set `NIFI_DOCKER_NETWORK` + `NIFI_DOCKER_NETWORK_EXTERNAL=true` so `nifi-proxy`, `mcp-server`, and `ai-orchestrator` join that network and call `https://<container>:8443/nifi-api`. |

Typical IDOL demo already running on this engine:

- Browser: `https://127.0.0.1:8443/nifi`
- Container: `idol-demo-idol-nifi-1` on `idol-demo-network`
- Image: `microfocusidolserver/nifi-ver2-full:26.3` (NiFi 2.9.0)

```bash
./start.sh --nifi-location remote --nifi-deploy docker \
           --nifi-user admin --nifi-password 'OpenText2026!' \
           up --build

./start.sh --nifi-location remote --nifi-deploy linux \
           --nifi-url https://nifi.example.com:8443 \
           --nifi-user admin --nifi-password 'OpenText2026!' \
           up --build
```

Do not use `https://127.0.0.1:5000/nifi-api` as a NiFi URL (Docker
Registry / AirPlay / unrelated TLS). The probe refuses port 5000.

## Flags

| Flag | Meaning |
|---|---|
| *(no args)* or `up …` | Full wizard, then Compose `up --build` by default |
| `down` / `down -v` | Confirm undeploy only, then `docker compose down -v` |
| `--nifi-location local\|remote` | Local = start this stack’s NiFi. Remote = existing URL |
| `--nifi-deploy linux\|windows\|docker` | How a **remote** NiFi is hosted |
| `--nifi-url https://HOST:PORT` | Remote NiFi UI/API; implies remote |
| `--nifi-image IMAGE` | Local compose image (default after confirm: IDOL 26.3) |
| `--nifi-user` / `--nifi-password` | UI login written into `.env` |
| `--create-nifi` | Same as `--nifi-location local` |
| `--create-ollama` | Ignore a discovered Ollama and start one |
| `--skip-nifi-test` | Skip host probe (Docker-only DNS / no published port) |
| `--project-name NAME` | Compose project name |
| extra args | Passed to Compose (`up --build`, `up -d`, …) |

## Official Cloudera NiFi MCP

The `mcp-server` image installs

```
nifi-mcp-server @ git+https://github.com/cloudera/nifi-mcp-server.git
```

and starts it with `python /app/entrypoint.py`:

- Maps `NIFI_API_BASE` / `NIFI_USERNAME` / `NIFI_PASSWORD` onto the
  official `NIFI_API_BASE` / `KNOX_USER` / `KNOX_PASSWORD` keys.
- Binds `0.0.0.0:8000` (upstream default is `127.0.0.1:3030`).
- For standalone NiFi (no Knox) obtains a Bearer token from
  `POST /nifi-api/access/token`.
- Transport `MCP_TRANSPORT=sse` (`http://localhost:27115/sse`).
- `NIFI_READONLY=false` so write tools are enabled.

Standalone (no Docker):

```bash
cd mcp-server
pip install -r requirements.txt
export NIFI_BASE_URL=https://127.0.0.1:8443/nifi-api
export NIFI_USERNAME=admin
export NIFI_PASSWORD=OpenText2026!
export NIFI_VERIFY_SSL=false
export MCP_TRANSPORT=sse
export MCP_HOST=0.0.0.0
export MCP_PORT=8000
python entrypoint.py
```

## URLs (fixed ports)

Host ports are always the same. `./start.sh` prints this card before
Compose starts.

| What | URL | How to use it |
|---|---|---|
| Chat UI | http://localhost:27120/ | Browser — natural-language assistant |
| Orchestrator API | http://localhost:27110 | `POST /chat`, `GET /nifi/about`, `POST /flows/sample` |
| NiFi HTTP front door | http://localhost:27111/nifi | HTTP nginx → NiFi TLS. Use **http://**, not https:// |
| Local NiFi TLS (when created) | https://127.0.0.1:27113/nifi | Direct HTTPS on the compose NiFi container |
| Remote IDOL NiFi (typical) | https://127.0.0.1:8443/nifi | Existing demo published on 8443 |
| Cloudera NiFi MCP | http://localhost:27115/sse | Official MCP SSE; orchestrator connects here |
| Ollama | http://localhost:27134 | `GET /api/tags`. `ollama pull llama3.2` |
| Live version check | http://localhost:27110/nifi/about | Real `/nifi-api/flow/about`, not the model |

`http://localhost:27111` is **HTTP**. Opening `https://localhost:27111`
or talking HTTP to raw 8443 will look dead. `/` on 27111 redirects to
`/nifi/`.

## Embed the chat UI in another HTML file

The assistant is a standalone page at `http://localhost:27120/`.
Another application should **embed** that page, not paste `ui/index.html`
into its own document.

1. Start / rebuild the UI container so `embed.js` is published:

```bash
docker compose --env-file .env up -d --build --force-recreate ui
```

2. In the other HTML file load the custom element:

```html
<script src="http://localhost:27120/embed.js"></script>
<kd-nifi-chat src="http://localhost:27120/" height="720px"></kd-nifi-chat>
```

3. Or attach it to a node you already have:

```html
<div id="nifi-slot"></div>
<script src="http://localhost:27120/embed.js"></script>
<script>
  KDNifiChat.mount("#nifi-slot", { src: "http://localhost:27120/", height: "720px" });
</script>
```

Working demo of a foreign host page: http://localhost:27120/embed-example.html  
Details: `ui/README.md`.

## Deploy the “AI test with Python” sample

This recreates the 26.3.0-nifi2 group from the registry export:

`IdolSslConfigServiceImpl` + `IdolLicenseServiceImpl`  
`GenerateDocumentFlowFile` → `ExecuteDocumentPython` (`/python/ai/add_two_fields.py`)  
success funnel / failure funnel

NiFi **must** be the IDOL image (local confirmed image, or remote IDOL).
On stock `apache/nifi` this sample is skipped with an explicit error
instead of HTTP 409 + MCP `start_new_flow: 'id'`.

### 1. Point the stack at IDOL NiFi 2.9 / 26.3

Remote:

```bash
chmod +x start.sh ui/docker-entrypoint.sh
./start.sh --nifi-location remote --nifi-deploy docker \
           --nifi-user admin --nifi-password 'OpenText2026!' \
           up --build
```

Or local with the confirmed IDOL image.

### 2. Optional `.env` for this sample

```bash
IDOL_LICENSE_HOST=eecmidollicense.idoldemos.net
IDOL_LICENSE_PORT=20000
IDOL_SSL_AUTHORITY_CERTS=/ssl
IDOL_PYTHON_SCRIPT=/python/ai/add_two_fields.py
```

The script file must exist **inside the NiFi container**. Copy it if needed:

```bash
docker cp add_two_fields.py idol-demo-idol-nifi-1:/python/ai/add_two_fields.py
```

### 3. Rebuild the services that create the flow

```bash
docker compose --env-file .env up -d --build --force-recreate ai-orchestrator ui
```

### 4. Open the chat and send the prompt

- UI: http://localhost:27120/
- Sidebar: **AI test with Python**
- Or type:

```text
Create an AI test with Python sample using ExecuteDocumentPython
```

### 5. Enable the two controller services, then run one shot

1. Open the NiFi UI (remote `https://127.0.0.1:8443/nifi` or local
   `https://127.0.0.1:27113/nifi` / `http://localhost:27111/nifi`)
2. Enter process group **AI test with Python**
3. Operate palette → Controller Services
4. Enable **IdolSslConfigServiceImpl**, then **IdolLicenseServiceImpl**
5. Start **GenerateDocumentFlowFile** once (its period is `999999999 sec`)
6. Confirm **ExecuteDocumentPython** routed to the success funnel

Spec on disk: `templates/idol-nifi2/ai-python.json` (indexed by `templates/catalog.json`).

## Sample flow 403 / MCP `'id'` / local 409

`start_new_flow` on the official Cloudera MCP server can crash with
`Error executing tool start_new_flow: 'id'` when the NiFi JSON does not
put `id` at the top level.

The sample-flow path talks to `/nifi-api` first and sends NiFi CSRF
headers (`Authorization` + `Request-Token`). A **403** after a
successful login means the user can read the canvas but cannot modify it.

A **409** `IdolSslConfigServiceImpl is not known to this NiFi instance`
means you pointed the stack at stock Apache NiFi. Confirm the IDOL image
for local, or use remote IDOL NiFi.

Then:

1. In the NiFi UI confirm you are `admin`.
2. Root process group → Operate / policies → allow modify.
3. Recreate the orchestrator:

```bash
docker compose --env-file .env up -d --build --force-recreate ai-orchestrator
```

If a child process group is not allowed, GenerateFlowFile → LogAttribute
is created on the root canvas instead.

## What was fixed (recent)

- **`./start.sh down -v`** — only asks to confirm undeploy.
- **Local vs remote wizard** — local can confirm
  `microfocusidolserver/nifi-ver2-full:26.3`; remote asks
  Linux / Windows / Docker.
- **Official Cloudera MCP only** — container runs `nifi-mcp-server` via
  `entrypoint.py` (SSE). Not Cassandra MCP. Not `server.py`.
- **Host probe** — never uses `:5000` or Docker DNS names such as
  `nifi-manager` from the host.
- **Docker network join** — remote Docker NiFi: attach this stack to
  that container’s network.
- **Fixed 27xxx ports** — UI 27120, orchestrator 27110, NiFi HTTP 27111,
  NiFi TLS 27113, MCP 27115, Ollama 27134.
- **Colored `start.sh`** — questions yellow; URL card at the end of
  planning.
- **Local sample 409** — generic sample no longer forces IDOL controller
  services onto stock `apache/nifi`.
- **Sample flow MCP `'id'` / REST 403** — REST-first create, CSRF token,
  write-permission error, root-canvas fallback.
- **Wrong NiFi version in chat** — `/nifi-api/flow/about`, not the model.
- **HTTP 400 on `/access/token`** — default password `OpenText2026!`.
- **`localhost:27111` not responding** — HTTP proxy, not NiFi HTTPS.

## Manual start

```bash
cp .env.example .env
# edit NIFI_USERNAME / NIFI_PASSWORD to match the UI
python3 scripts/allocate_ports.py --write-env .env --location remote --deploy linux \
  --nifi-url https://127.0.0.1:8443
docker compose --env-file .env up --build
```

## OpenText KD MCP tools

Official Cloudera `nifi-mcp-server` has no Knowledge Discovery tools.
The orchestrator adds them and intercepts those MCP-style calls:

| Tool | Creates |
|---|---|
| `create_kd_file_connector_flow` | GetFile → KD metadata → IDOL `/action=index` |
| `create_kd_idol_nifi2_flow` | IDOL CS + GetFileSystem → PutIDOL |
| `create_kd_ai_python_flow` | GenerateDocumentFlowFile → ExecuteDocumentPython |
| `create_kd_sap_flow` | SAP HTTP → KD metadata → IDOL |
| `create_kd_documentum_flow` | Documentum REST → KD metadata → IDOL |
| `create_kd_enrichment_flow` | Mid-pipeline KD metadata + index |

`GET /lookup/kd-tools` lists schemas. `POST /kd/tools/{name}` runs one.
Chat / Ollama see these next to official NiFi tools; KD names are handled
locally via NiFi REST instead of being forwarded to Cloudera MCP.

## Adding a new KD flow pattern

Register the pattern once. Do not also edit `BUILTIN_TEMPLATES` or
sidebar HTML — those no longer exist as a second catalog.

1. Add a generator spec under `templates/ingest/`, `templates/idol-nifi2/`,
   or `templates/stages/` (job + NiFi version, not a product nickname).
2. Append one entry to `templates/catalog.json`. `mcp_tool` must be a live
   official Cloudera tool from `official_mcp_tools`, or `null`. Set
   `runtime` to `nifi-rest` / `official-mcp` / `unimplemented`.
3. If the chat should build it, add `NiFiRest.create_*` (and a prompt
   branch). Do not register a `create_kd_*` name — that package is not
   what Docker serves.
4. The orchestrator loads the catalog from `KD_TEMPLATES_DIR` (Compose
   mounts `./templates` at `/app/templates`). `+ Add template` writes
   `templates/custom/`.

These JSON files are generator specs, not NiFi Templates. To version
what is on the canvas, export the process group (`flow.json`) or use
NiFi Registry. Repo JSON is not `conf/templates/` on NiFi 2.

## Roadmap (v1)

- [x] Natural-language flow generation
- [x] NiFi 2.x REST API integration
- [x] OpenText Knowledge Discovery flow templates (file, SAP)
- [x] ai-orchestrator as a real HTTP service
- [x] Minimal working chat UI
- [x] Reuse existing IDOL NiFi / Ollama
- [x] Official Cloudera NiFi MCP (SSE)
- [x] Local vs remote / Linux / Windows / Docker deploy wizard
- [x] Live `/nifi/about` version (not model-generated)
- [x] Embeddable chat (`<kd-nifi-chat>` / `embed.js`)
- [x] IDOL 26.3.0-nifi2 samples (GetFileSystem/PutIDOL and AI test with Python)
- [ ] Documentum / SharePoint / xECM / database / REST templates
- [ ] Optional Angular rewrite (see ui/README.md)
- [ ] Retry / DLQ processor patterns
- [ ] Security/ACL metadata mapping
