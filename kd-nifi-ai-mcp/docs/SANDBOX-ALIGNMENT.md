# Alignment with kd-sandbox-ai-demo

The two packages share one catalog and one run path.

| Concern | Owner |
|---|---|
| Sidebar Actions / Skills / Templates | Orchestrator `GET /lookup/{actions,skills,templates,objects}` |
| Add / Import an item | `POST /lookup/objects` or MCP `addObject` → `templates/custom/` |
| Click an item | MCP `runObject` → same handler as `POST /chat` |
| Refresh | MCP `refreshObjects` / `listObjects` |
| Clear all | `POST /api/nifi-ai/clear-all` + MCP `clearAllObjects` |

Nothing in `ui/index.html` hardcodes list entries. Seeds live in
`templates/actions.json`, `templates/skills.json`, and `templates/catalog.json`.
User-added items live only under `templates/custom/`.

The sandbox overlay (`nifi-ai-modal.component.ts`) must call the same MCP
methods so an item added in the demo UI is visible and runnable from the
NiFi AI page, and the other way around.


## Clean

Place both packages in the same parent directory and run either:

```
./clean.sh              # this project, then the sibling
./clean.sh --no-peer    # this project only
```

`kd-sandbox-ai-demo/clean.sh` and `kd-nifi-ai-mcp/clean.sh` call each other
with `--no-peer` so the pair cannot recurse.
