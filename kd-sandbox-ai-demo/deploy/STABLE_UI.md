# Stable hosted UI

The Angular dev server watches `src/`. Any write to `src/assets/config/*.json`
used to trigger a full `window.location.reload()`. The live Content catalog
refresh wrote `databases.json` after GetStatus, so the home/search page
reloaded every few seconds.

## What changed

1. Runtime catalog refresh stays in memory.
2. Creating a database still persists `config/databases.json` at the package
   root, but not `src/assets/config`.
3. `serve.sh` and `npm start` default to:

   ```bash
   ng serve --live-reload false --hmr false
   ```

4. `generate-config.mjs` skips writes when the file content is unchanged.

## How to run

Stable demo (default):

```bash
cd apps/web
./serve.sh
```

Developer hot reload:

```bash
KD_LIVE_RELOAD=1 ./serve.sh
# or
KD_LIVE_RELOAD=1 npm start
```

Production-like (preferred over long-running `ng serve`):

```bash
cd apps/web
npm run build
# serve dist/web behind Nginx; use nginx/kd-locations.conf.snippet
```

systemd units should keep `KD_LIVE_RELOAD=0` in
`/etc/default/kd-enterprise-search`.

## Automatic hard refresh

`serve.sh`, `restart.sh`, and `deploy.sh` stamp `assets/build-id.json` with a
new id on every start or publish. `index.html` polls that file every 15s
(`Cache-Control: no-store`). When the id changes, the browser does a
one-shot `location.replace` with a cache-busting query string so clients
pick up the new bundle without a manual hard refresh.
