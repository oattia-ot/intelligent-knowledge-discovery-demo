# Knowledge Discovery MCP layer

Additive capability layer for OpenText Knowledge Discovery 26.3.

Existing NiFi MCP behaviour is unchanged:

- Docker / `./start.sh` still start official Cloudera `nifi-mcp-server` via `mcp-server/entrypoint.py`.
- NAR resolution (`nars/26.2`, `nars/26.3`) is unchanged and remains version-strict.
- Local FastAPI gateways `app.py` / `server.py` now also register the KD tool catalog.
- Standalone process: `python kd_server.py` (stdio / SSE / HTTP).

## Architecture

```
LLM / orchestrator
        |
        v
 FastMCP tools  (tools/knowledge_discovery.py + existing NAR/NiFi tools)
        |
        v
 kd.service.KnowledgeDiscoveryService
        |
        +-- kd.registry  (capabilities.json)
        +-- kd.versions  (26.1 / 26.2 / 26.3 resolver)
        +-- kd.safety    (READ_ONLY / SAFE_WRITE / DESTRUCTIVE)
        +-- kd.client.AciClient
                |
                v
     ACI HTTP  http://host:port/?action=Query&...
```

ACI requests use only documented `action=` names. Hosts are limited to endpoints in `KdConfig`. Destructive index/admin actions require `confirm=true`.

## Installation

From `mcp-server/`:

```bash
pip install -r requirements.txt
export IDOL_VERSION=26.3
export KD_HOST=idol-content
export IDOL_PORT=9100
python kd_server.py
```

## Configuration

| Variable | Purpose |
|---|---|
| `KD_VERSION` / `IDOL_VERSION` | Default product train (`26.3`) |
| `KD_HOST` / `IDOL_HOST` | Default ACI host |
| `KD_PROTOCOL` | `http` or `https` |
| `KD_VERIFY_TLS` | Certificate validation (default true) |
| `KD_TIMEOUT_SECONDS` | HTTP timeout |
| `KD_USERNAME` / `KD_PASSWORD` | Optional basic auth |
| `KD_SECURITY_INFO` | Default query-time SecurityInfo |
| `KD_<COMPONENT>_HOST` | Override host |
| `KD_<COMPONENT>_PORT` | ACI port |
| `KD_<COMPONENT>_INDEX_PORT` | Index port |
| `KD_<COMPONENT>_SERVICE_PORT` | Service port |
| `KD_<COMPONENT>_ENABLED` | `true`/`false` |

Component prefixes: `KD_CONTENT`, `KD_COMMUNITY`, `KD_CATEGORY`, `KD_AGENTSTORE`, `KD_VIEW`, `KD_QMS`, `KD_DAH`, `KD_DIH`, `KD_MEDIA`, `KD_EDUCTION`, `KD_CFS`, `KD_LICENSE`, `KD_PROXY`, `KD_ANSWER`, `KD_KG`, `KD_OGS`.

Existing `.env.example` keys `IDOL_HOST` / `IDOL_PORT` continue to configure Content.

## Authentication and TLS

- Optional HTTP basic auth per component.
- Optional `SecurityInfo` appended to Content/DAH/QMS queries.
- TLS verification defaults to on. Lab deployments may set `KD_VERIFY_TLS=false`.
- Community 26.3 OTDS can accept username/password (`OTDSUserField`); this MCP does not weaken that server-side setting.

## Supported versions

| Train | MCP status | Notes |
|---|---|---|
| 26.3 | target | Combined speech Medium/Large; Suggest/TermGetBest UseVectors; OTDSUserField; new OCR languages; Eduction PII/ITAR updates |
| 26.2 | supported | ImageDescription present; Legacy STT removed |
| 26.1 | supported | Inherited ACI actions; no ImageDescription, no UseVectors |

The resolver never silently substitutes a 26.2 NAR or API behaviour when 26.3 is requested.

## Running the tools

Discovery:

- `kd_list_skills` — What Knowledge Discovery skills are available?
- `kd_list_capabilities` — What Knowledge Discovery APIs are available in version 26.3?
- `kd_find_api` — Find the correct Knowledge Discovery API for this task.
- `kd_resolve_version`
- `kd_discover_components` / `kd_component_health`

Content: `kd_content_query`, `kd_content_get`, `kd_content_suggest`, `kd_content_parametric`, index/delete/sync tools.

Media: `kd_media_ocr`, `kd_media_speech_to_text`, `kd_media_process`, face/object/ANPR/image-description.

NiFi: existing `resolve_idol_nars` / `generate_idol_nifi_flow` plus `kd_workflow_nifi_ingest`.

Escape hatch: `kd_aci_action` only against configured hosts and registry actions; destructive calls need `confirm=true`.

## Official documentation

- Product: https://www.opentext.com/products/knowledge-discovery
- 26.3 portal: https://www.microfocus.com/documentation/idol/knowledge-discovery-26.3
- IDOL doc index (lists 26.3, updated 07/2026): https://www.microfocus.com/documentation/idol/
- File Content Extraction 26.3: https://www.microfocus.com/documentation/idol/file-content-extraction-26.3
- 26.3 feature summary: https://blogs.opentext.com/whats-new-in-opentext-knowledge-discovery-idol/

Every registry row stores its documentation URL in `knowledge-discovery/capabilities/capabilities.json`.

## Security and destructive operations

- `READ_ONLY` — Query, GetContent, GetStatus, EduceFromText
- `SAFE_WRITE` — DREADDDATA, DRESYNC, Synchronize, Process, CategoryCreate
- `DESTRUCTIVE` — DREINITIAL, DREDELETEDOC, DREDELDBASE, DRECOMPACT, CategoryDelete

Destructive tools refuse to run unless `confirm=true`.

## Testing

```bash
cd mcp-server
python3 -m unittest tests.test_kd_layer tests.test_nar_resolution
```

Tests are mocked. They do not contact a live Knowledge Discovery server.
