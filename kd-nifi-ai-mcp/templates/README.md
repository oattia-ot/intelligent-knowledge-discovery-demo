# KD flow templates

These JSON files are **generator specs**, not Apache NiFi Templates.
They describe a pattern the orchestrator / MCP tools can turn into a
process group. To version what is actually on the canvas, export the
process group (`flow.json`) or use NiFi Registry. Do not treat
`conf/templates/` on NiFi 2 as the source of these patterns.

## Layout

```
templates/
  README.md
  catalog.json                 # template index the UI / orchestrator reads
  actions.json                 # sidebar Actions (empty by default; no HTML hardcodes)
  skills.json                  # sidebar Skills (empty by default; no HTML hardcodes)
  ingest/                      # source systems → IDOL
    file.json
    idol-file.json
    sap.json
    documentum.json
  idol-nifi2/                  # version-specific IDOL processors
    26.3-getfilesystem-putidol.json
    ai-python.json
  stages/                      # reusable mid-pipeline pieces
    indexing-enrichment.json
  custom/                      # persisted "+ Add template" entries
    .gitkeep
```

`catalog.json` is the only index. Do not duplicate titles/prompts in
`BUILTIN_TEMPLATES` or in hardcoded sidebar HTML.

## Align with live tools

Docker runs official Cloudera `nifi-mcp-server`. `mcp_tool` may only be a
name from `catalog.json` → `official_mcp_tools` (the FastMCP catalog).
Do **not** put `create_kd_*` there; those functions live in the deprecated
local gateway and are not listed by `list_tools`.

| Field | Meaning |
|---|---|
| `runtime` | `nifi-rest` (chat already builds it), `official-mcp` (single live tool), or `unimplemented` |
| `nifi_rest` | `NiFiRest` method name when `runtime` is `nifi-rest` |
| `mcp_tool` | One live official tool, or `null` |
| `mcp_args` | Official FastMCP args (`flow_name`, `parent_pg_id`, …) |
| `official_recipe` | Ordered official primitives if the generator expands the spec |

What actually runs today:

- `sample` → REST `create_sample_flow` (MCP fallback: `start_new_flow`)
- `idol-file` → REST `create_idol_sample_flow`
- `idol-nifi2-26.3` → REST `create_idol_nifi2_sample_flow`
- `idol-ai-python` → REST `create_ai_python_sample_flow`
- `file` / `sap` / `documentum` / `enrichment` → spec only (`unimplemented`)

Official primitives use Cloudera schemas: `start_new_flow(flow_name, parent_pg_id?)`,
`create_processor(process_group_id, processor_type, name, position_x?, position_y?)`,
`update_processor_config(processor_id, version, config)`,
`create_connection(..., relationships)` as a comma-separated string,
`create_controller_service(process_group_id, service_type, name)`.
There is no `start_flow` / `validate_flow`; use
`start_all_processors_in_group` and `get_flow_health_status`.

## Register a new pattern

1. Add a spec under the matching folder (`ingest/`, `idol-nifi2/`, or `stages/`).
2. Append one `catalog.json` entry. Set `runtime` / `nifi_rest` / `mcp_tool`
   to what actually executes. `mcp_tool` must be in `official_mcp_tools`.
3. If the chat should build it now, add a `NiFiRest.create_*` method and
   a prompt branch in `main.py`. Do not invent a `create_kd_*` MCP name.

## Runtime

The orchestrator reads `KD_TEMPLATES_DIR` (default `/app/templates` in
Docker, `../templates` next to `ai-orchestrator` on the host). Compose
bind-mounts this directory so lookup is from disk.

`POST /lookup/templates` writes a small JSON file into `custom/`.
Those files are runtime data; they are gitignored.
