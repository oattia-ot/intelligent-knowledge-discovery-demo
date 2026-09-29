# NiFi AI: run/refresh as MCP requests, ghost Add buttons, badge-only counts

## Why clicking an item "did nothing" and Refresh left no trace

The server (`admin-config-api.mjs`) only had one NiFi AI route, `clear-all`.
Nothing on the client ever called the server for a **Run** click or for
**Refresh**:

- Run only filled the embedded page's prompt box and pressed its Send button
  (DOM-only). If the composer/Send could not be found, nothing at all happened,
  and in every case the KD server saw nothing.
- Refresh (`refreshAllLists()`) only re-scanned the embedded DOM. It never made
  a network call, so there was nothing to appear in the server log.

## What changed

**Server** — new route `POST /api/admin/nifi-ai/mcp` (alias `/api/nifi-ai/mcp`).
Body: `{ "method": "runObject" | "refreshObjects", ...args }`. It wraps the call
as a JSON-RPC 2.0 `tools/call` and POSTs it to `NIFI_AI_MCP_URL`
(default `<NIFI_AI_ORCHESTRATOR_URL>/mcp`, i.e. `http://127.0.0.1:27110/mcp`).
Log lines:

```
[KD][NiFi AI] mcp request id=3 tools/call name=runObject action:SAP Ingest
[KD][NiFi AI] mcp response id=3 name=runObject -> http://127.0.0.1:27110/mcp status=200
[KD][NiFi AI] mcp request id=4 tools/call name=refreshObjects kinds=action,skill,template count=52
```

**Client** — `notifyServerMcp()` is the single reporter.
- `fillComposerAndSend()` calls it first (before any DOM work) for every run:
  card click, parameter dialog Continue, and native no-parameter items.
- The Refresh button now calls `runRefresh()` = rescan + `refreshObjects`.
- One request per action. Only if the fetch itself fails does it fall back to the
  parent Angular app (`NifiAiService.reportMcp`).

**Add buttons** — Action, Skill and Template all render as
`<button type="button" class="ghost" id="addAct|addSkill|addTpl">`. They are
recognised by `data-kd-add` (`isAddBtn()`), replacing the old `.kd-nifi-add-btn`
class checks. Older buttons are upgraded in place.

**Counts** — section labels are plain `ACTIONS` / `SKILLS` / `TEMPLATES`. The
only total is the round badge, kept in sync by `updateHeadingBadge()`.

## Verify

```bash
cd apps/web
npm run verify:nifi-ai
npx tsc -p tsconfig.app.json --noEmit
# restart the admin API so the new route exists (serve.sh / restart.sh)
curl -X POST localhost:4201/api/admin/nifi-ai/mcp -H 'Content-Type: application/json' \
  -d '{"method":"refreshObjects","kinds":["action","skill","template"],"count":1}'
```

Then click Refresh and an item in the UI and watch the admin API log for
`mcp request` lines. A `status=404` / `ECONNREFUSED` on the forward line still
proves the click reached the server; it means the orchestrator does not serve
`/mcp` at that URL (set `NIFI_AI_MCP_URL`).

## Objects with `"needs": ""`

`needs` is only a convenience list; the prompt's own tokens (`{{name}}`,
`${name}`, `<<name>>`) are what the run dialog asks for. Hardening:

- `derivedNeeds()`: an empty `needs` is filled from the prompt tokens on
  create, import, edit and export, so `"needs": ""` behaves like
  `"needs": "sourcePath, language"`.
- `sourcePromptFor()`: the run path reads the prompt from `data-prompt`, else
  the stored catalog prompt (previously only `data-prompt`).
- `runCreatedCard()` never sends literal `{{tokens}}` to the composer; if any
  remain it opens the parameter dialog first.

A run with tokens opens the parameter dialog first; the MCP `runObject` request
is sent when you press **Continue**, not on the first click. Every parameter
field is required.

Limitation: a built-in entry whose prompt is held only in the NiFi page's own
JavaScript (no `data-prompt` in the DOM) is run with a generic
"Execute the NiFi skill ..." prompt, because the real text is not reachable.
