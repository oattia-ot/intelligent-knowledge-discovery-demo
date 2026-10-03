#!/usr/bin/env node
/**
 * Standalone launcher for admin-server.mjs in "save only" mode — no
 * `onRestart` callback, because this is invoked from serve.sh, which
 * runs `ng serve` as its own foreground process and holds no handle on
 * it to kill/respawn (unlike scripts/dev.mjs's `npm start` flow).
 *
 * With this running, the Settings -> "Backend upstream host" Save
 * button can still write config/config.json and regenerate the
 * derived config files (generate-config.mjs) — it just reports
 * `restarting: false`, so the UI correctly tells the user to restart
 * the dev server manually (./restart.sh) to apply it, instead of the
 * request failing outright with ECONNREFUSED.
 */
import { startAdminServer } from './admin-server.mjs';
import { red } from './log-colors.mjs';

startAdminServer({})
  .then((server) => {
    if (!server) {
      // Existing listener on 4301 — stay alive so serve.sh still has a child,
      // but do not treat EADDRINUSE as a hard failure.
      console.log('[admin] save-only mode: reused existing listener');
    }
  })
  .catch((err) => {
    console.error(red(`[admin] failed to start (save-only mode): ${err.message || err}`));
    process.exit(1);
  });
