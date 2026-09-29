# Official Cloudera NiFi MCP server

This container runs **only** Cloudera’s
[nifi-mcp-server](https://github.com/cloudera/nifi-mcp-server)
(`python -m nifi_mcp_server.server`).

It is **not**:

- Apache Cassandra MCP
- the local FastAPI files `server.py` / `app.py` (deprecated)

```
orchestrator  --SSE-->  cloudera/nifi-mcp-server  --REST-->  /nifi-api
```

`entrypoint.py` is a thin wrapper around the official package:

1. Maps `NIFI_API_BASE` / `NIFI_USERNAME` / `NIFI_PASSWORD` onto the
   official `NIFI_API_BASE` / `KNOX_USER` / `KNOX_PASSWORD` keys.
2. Binds `0.0.0.0:8000` (upstream defaults to `127.0.0.1:3030`).
3. For standalone NiFi (no Knox), obtains a Bearer token from
   `POST /nifi-api/access/token`.
4. Starts FastMCP with `MCP_TRANSPORT=sse`.

## Environment

| Variable | Example | Official key |
|---|---|---|
| `NIFI_API_BASE` or `NIFI_BASE_URL` | `https://nifi-manager:8443/nifi-api` | `NIFI_API_BASE` |
| `NIFI_USERNAME` / `NIFI_PASSWORD` | `admin` / `OpenText2026!` | `KNOX_USER` / `KNOX_PASSWORD` |
| `KNOX_TOKEN` | CDP JWT | used as-is when set |
| `NIFI_READONLY` | `false` | write tools enabled |
| `KNOX_VERIFY_SSL` / `NIFI_VERIFY_SSL` | `false` | lab certs |
| `MCP_TRANSPORT` | `sse` | `sse` / `http` / `stdio` |
| `MCP_HOST` / `MCP_PORT` | `0.0.0.0` / `8000` | bind address |

## Tools

Whatever the current Cloudera package exposes, including
`get_nifi_version`, `get_root_process_group`, `list_processors`,
`create_processor`, `create_process_group`, `start_new_flow`,
`start_processor`, `get_flow_health_status`, and the rest of the
read/write catalog. The orchestrator lists them at runtime via MCP
`list_tools`.

## Local run (no Docker)

```bash
pip install 'nifi-mcp-server @ git+https://github.com/cloudera/nifi-mcp-server.git'
export NIFI_API_BASE=https://127.0.0.1:8443/nifi-api
export NIFI_USERNAME=admin
export NIFI_PASSWORD=OpenText2026!
export NIFI_VERIFY_SSL=false
export NIFI_READONLY=false
export MCP_TRANSPORT=sse
export MCP_HOST=0.0.0.0
export MCP_PORT=8000
python entrypoint.py
```

SSE endpoint: `http://127.0.0.1:8000/sse`

## Knowledge Discovery ACI tools

`python kd_server.py` (or the local FastAPI gateways) register the 26.3
capability catalog documented in `../docs/KNOWLEDGE-DISCOVERY-MCP.md`.
Docker continues to start official Cloudera NiFi MCP via `entrypoint.py`.


## Version-aware IDOL NAR tools

The local FastAPI gateway (`app.py` / `server.py`) also registers:

- `list_idol_nar_versions`
- `resolve_idol_nars`
- `validate_idol_nar_compatibility`
- `get_idol_nar_manifest`
- `generate_idol_nifi_flow`
- `validate_generated_idol_flow`
- `install_idol_nars`
- `diagnose_idol_nifi_environment`

Docker still starts official Cloudera MCP via `entrypoint.py`. The same tools are
exposed by the orchestrator (`kd_mcp_tools.py`) so chat / Ollama can call them
next to Cloudera tools. Registry path: `IDOL_NAR_PATH` (default `/nars`).
