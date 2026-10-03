# Chat UI

Self-contained `index.html` served at **http://localhost:27120/**.

The page is a single file (no build). The browser calls the orchestrator
at `http://localhost:27110` (`ORCHESTRATOR_PUBLIC_URL` is injected when
the container starts; `start.sh` / `install.sh` rewrite that value to
`http://<public-ip>:27110` when the host has an external IPv4). You can
open `index.html` from disk if you set `window.ORCHESTRATOR_URL` first.

A bottom **Activity log** tab is collapsed by default. Click it to expand
a session trace of requests and replies; click again or **Close** to hide it.

## Embed in another HTML file

Do **not** copy-paste `index.html` into the host page. That file owns
`body` layout and will break the other app. Load it as an element.

### 1. Rebuild the UI container (serves embed.js)

```bash
docker compose --env-file .env up -d --build --force-recreate ui
```

Confirm:

- http://localhost:27120/
- http://localhost:27120/embed.js
- http://localhost:27120/embed-example.html

### 2. In the *other* HTML file

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Host application</title>
</head>
<body>
  <h1>My app</h1>

  <script src="http://localhost:27120/embed.js"></script>
  <kd-nifi-chat src="http://localhost:27120/" height="720px"></kd-nifi-chat>
</body>
</html>
```

### 3. Or mount into an existing node

```html
<div id="nifi-slot"></div>
<script src="http://localhost:27120/embed.js"></script>
<script>
  KDNifiChat.mount("#nifi-slot", {
    src: "http://localhost:27120/",
    height: "720px"
  });
</script>
```

### 4. Plain iframe (no helper script)

```html
<iframe
  src="http://localhost:27120/"
  title="KD NiFi assistant"
  style="width:100%;height:720px;border:1px solid #e5e7eb;border-radius:12px">
</iframe>
```

The embedded page still talks to the orchestrator at
`http://localhost:27110`. Keep that origin reachable from the browser.

## API contract

- `POST /chat` `{ message }` → `{ reply, plan?, data? }`
- `GET /health`
- `GET /settings/nifi`
- `POST /settings/nifi/test`
- `GET /nifi/about`
- `GET /lookup/templates` | `/lookup/actions` | `/lookup/skills` | `/lookup/objects`
- `POST /lookup/templates` `{ title, description, prompt }`
- `POST /lookup/actions` | `/lookup/skills` | `/lookup/objects` persist a list item
- `POST /mcp` JSON-RPC `tools/call` (`runObject`, `refreshObjects`, `addObject`, `deleteObject`, `clearAllObjects`)

## Sidebar actions

Actions, skills, and templates are loaded from the orchestrator
(`templates/actions.json`, `templates/skills.json`, `templates/catalog.json`
plus anything saved under `templates/custom/`). Nothing is hardcoded in
`index.html`. Clicking an item POSTs `runObject` to `/mcp` and then
`POST /chat` so the work runs on the server.

- Add template (persisted to `templates/custom/` on the orchestrator)

## Tutorials

- [Create a sample NiFi flow](../../docs/tutorials/nifi-ai-sample-flow.md)
- [IDOL 26.3 GetFileSystem → PutIDOL](../../docs/tutorials/nifi-ai-idol-26.3-getfilesystem-putidol.md)
- [AI test with Python](../../docs/tutorials/nifi-ai-python.md)
