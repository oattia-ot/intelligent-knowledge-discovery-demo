# Clear all — UI wipe + server method log

## What changed

Clicking **Clear all** now:

1. Deletes every Action, Skill, and Template from the overlay lists through `removeObject()`.
2. Writes an empty catalog to `localStorage` and a clear lock (`kd-nifi-ui-cleared=1`) plus per-object tombstones so the MutationObserver / DOM snapshot cannot put the items back.
3. Calls the KD server so the process log shows the calling method.

## Server log to look for

`admin-config-api` (port `4201`, started by `serve.sh`) prints:

```
[KD][NiFi AI] calling method=clearAllObjects action=clear-all kinds=action,skill,template count=N
[KD][NiFi AI] clearAllObjects objects=action:Foo, skill:Bar, ...
[KD][NiFi AI] forwarded clearAllObjects → http://127.0.0.1:27110/api/nifi-ai/clear-all ...
[KD][NiFi AI] forwarded clearAllObjects → http://127.0.0.1:27120/api/nifi-ai/clear-all ...
```

The Vite / ng proxy also prints:

```
[proxy] calling method=clearAllObjects POST /api/admin/nifi-ai/clear-all
```

The forward to `:27110` and `:27120` is what makes the NiFi orchestrator / UI access log show an incoming `POST /api/nifi-ai/clear-all` with header `X-KD-Nifi-Method: clearAllObjects`. A 404 on those ports is still a successful log line; those apps do not have to implement the route for the access log to record the call.

## Endpoint

`POST /api/admin/nifi-ai/clear-all`

```json
{
  "method": "clearAllObjects",
  "action": "clear-all",
  "kinds": ["action", "skill", "template"],
  "count": 3,
  "objects": [{ "kind": "action", "name": "Example" }]
}
```

Header: `X-KD-Nifi-Method: clearAllObjects`

## How to bring lists back

- **Refresh** rescans the embedded NiFi DOM and lifts the clear lock.
- **Import all** or **Add Action / Skill / Template** creates objects again and lifts the lock for those names.

## v1.5r7m20 — wipe this UI catalog (16/28/8)

The Actions / Skills / Templates counts are this embedded UI catalog
(MCP-backed definitions), not Apache NiFi processors. Clear all now:

- Removes every list card under each Actions / Skills / Templates section
- Forces the heading counts to 0
- Adds `html.kd-nifi-ui-cleared` so re-rendered cards stay hidden
- Re-wipes on MutationObserver ticks while the clear lock is on
\n\n## v1.5r7m21 — counters + no import multiply\n- Clear / Import / Export / Add / Delete refresh ACTIONS n, SKILLS n, TEMPLATES n.\n- Import after Clear all wipes the lists first, then inserts the file once.\n- Observer and the 6 delayed ensureAddButtons passes no longer upsert catalog items again.\n