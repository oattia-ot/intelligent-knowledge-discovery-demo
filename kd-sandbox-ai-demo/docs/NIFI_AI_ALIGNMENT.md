# Alignment with kd-nifi-ai-mcp

NiFi AI list items are owned by the orchestrator in `kd-nifi-ai-mcp`, not by
hardcoded arrays in the sandbox overlay.

## Contract

The overlay talks to `POST /api/admin/nifi-ai/mcp`, which forwards a JSON-RPC
`tools/call` to `NIFI_AI_MCP_URL` (default `http://127.0.0.1:27110/mcp`).

| User action | MCP tool | Server effect |
|---|---|---|
| Click Action / Skill / Template | `runObject` | Orchestrator runs the object's prompt (`POST /chat`) |
| Add / Edit / Import | `addObject` | Written to `templates/custom/` |
| Delete | `deleteObject` | Custom file removed |
| Refresh | `refreshObjects` + `listObjects` | Re-reads the server catalog |
| Clear all | `clearAllObjects` | Custom files removed |

## Clean

```
./clean.sh              # this project, then kd-nifi-ai-mcp
./clean.sh --no-peer    # this project only
```

Set `KD_NIFI_AI_MCP_HOME` if the NiFi AI package is not a sibling folder.

## What was removed

- Hardcoded Actions / Skills arrays in the embedded NiFi AI page.
- Leftover test templates `aaa`, `aaaa`, `xxx`.
- The click path that only filled the iframe composer and never reached the
  server. Composer send still happens so the chat thread updates; the run
  itself is executed on the orchestrator.
