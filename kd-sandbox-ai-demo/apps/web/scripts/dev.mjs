#!/usr/bin/env node
/**
 * Dev launcher: starts the '/__kd-probe' probe server (see
 * scripts/probe-server.mjs), the '/__kd-admin' config-admin server (see
 * scripts/admin-server.mjs — this is what powers the Settings ->
 * "Backend upstream host" Apply to all button — save + restart), and then
 * `ng serve` with the same args this script was called with. All three
 * processes' output goes to this terminal. Ctrl-C (or `ng serve` exiting
 * on its own) stops everything.
 *
 * Wired up via package.json:
 *   "start": "node scripts/dev.mjs --host 0.0.0.0 --port 4200"
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProbeServer, PROBE_PORT } from './probe-server.mjs';
import { startAdminServer, ADMIN_PORT } from './admin-server.mjs';
import { ensurePortAvailable, isPortFree } from './port-guard.mjs';
import { red, gray } from './log-colors.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ -> apps/web (project root, where node_modules lives)
const ROOT = path.resolve(__dirname, '..');

const cliArgs = process.argv.slice(2);
const liveReloadEnabled = process.env.KD_LIVE_RELOAD === '1';
const stableArgs = liveReloadEnabled ? [] : ['--live-reload', 'false', '--hmr', 'false'];
const ngArgs = ['serve', '--proxy-config', 'proxy.conf.mjs', ...stableArgs, ...cliArgs];

function argValue(flag) {
  const i = cliArgs.indexOf(flag);
  return i !== -1 && cliArgs[i + 1] ? cliArgs[i + 1] : undefined;
}

const port = Number(argValue('--port') || 4200);
const host = argValue('--host') || '0.0.0.0';

/**
 * Resolve the Angular CLI to run. Angular CLI is a devDependency, not a
 * global install, so a bare `spawn('ng', ...)` only works if `ng` happens
 * to be on PATH (e.g. globally installed or npm-linked) — otherwise it
 * fails with `spawn ng ENOENT`. `npm start` runs this script directly
 * with `node`, bypassing the npm-added node_modules/.bin PATH shimming
 * that `ng` would get from an npm script, so we have to resolve it
 * ourselves, the same way serve.sh already does.
 */
function resolveNgCommand() {
  const ngBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'ng.cmd' : 'ng');
  if (existsSync(ngBin)) {
    return { command: ngBin, args: ngArgs };
  }
  const ngJs = path.join(ROOT, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  if (existsSync(ngJs)) {
    return { command: process.execPath, args: [ngJs, ...ngArgs] };
  }
  return null;
}

// Holds the current `ng serve` child. Mutable so the admin server's
// restart callback (see below) can kill and replace it. `restarting`
// distinguishes "we killed it on purpose, a new one is coming" from a
// real exit (crash, Ctrl-C) that should shut the whole launcher down.
let ngChild = null;
let restarting = false;
let shuttingDown = false;

function launchNg() {
  const resolved = resolveNgCommand();
  if (!resolved) {
    console.error(red('[dev] Angular CLI not found in node_modules.'));
    console.error(gray(`[dev] Expected: ${path.join(ROOT, 'node_modules', '.bin', 'ng')}`));
    console.error(gray('[dev] Run `npm install --include=dev` first.'));
    process.exit(1);
  }

  const child = spawn(resolved.command, resolved.args, { stdio: 'inherit' });

  child.on('error', (err) => {
    console.error(red(`[dev] failed to launch Angular CLI: ${err.message || err}`));
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (restarting) {
      // This exit was caused by restartNg() below; it already spawns the
      // replacement, so there's nothing to do here.
      return;
    }
    shutdown(code);
  });

  ngChild = child;
}

/** Kill the current `ng serve` and start a fresh one — same proxy.conf.mjs
 *  module, but Node re-imports it (and upstream.config.mjs) fresh on
 *  every `ng serve` startup, which is how the new upstream host actually
 *  takes effect. Passed to admin-server.mjs as `onRestart`. */
async function restartNg() {
  if (!ngChild || ngChild.killed) {
    launchNg();
    return;
  }
  restarting = true;
  const oldChild = ngChild;
  await new Promise((resolve) => {
    oldChild.once('exit', resolve);
    oldChild.kill('SIGTERM');
    // Don't wait forever for a stuck process.
    setTimeout(resolve, 5000);
  });
  restarting = false;
  launchNg();
}

const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (ngChild && !ngChild.killed) ngChild.kill('SIGTERM');
  process.exit(code ?? 0);
};

async function main() {
  // Check the port ourselves first: `ng serve`'s own "port already in use"
  // prompt throws an unhandled exception in non-interactive terminals
  // instead of asking cleanly. See scripts/port-guard.mjs for details.
  const portOk = await ensurePortAvailable(port, { host });
  if (!portOk) {
    process.exit(1);
  }

  // Guard the probe port and the admin port too. If a previous run was
  // killed/crashed without cleanly shutting down, either can still be
  // bound from an orphaned process. Ask the same way we did for 4200
  // instead of crashing with EADDRINUSE.
  for (const [label, guardPort] of [['Probe', PROBE_PORT], ['Admin', ADMIN_PORT]]) {
    const free = await isPortFree(guardPort, '127.0.0.1');
    if (!free) {
      console.error(gray(`[dev] ${label} port ${guardPort} is also in use — likely a leftover from a previous run.`));
      const freed = await ensurePortAvailable(guardPort, { host: '127.0.0.1' });
      if (!freed) {
        process.exit(1);
      }
    }
  }

  try {
    const probe = await startProbeServer();
    if (!probe) {
      console.error(gray(`[dev] reusing existing probe server on 127.0.0.1:${PROBE_PORT}`));
    }
  } catch (err) {
    console.error(red(`[dev] failed to start probe server on 127.0.0.1:${PROBE_PORT}: ${err.message || err}`));
    process.exit(1);
  }

  try {
    await startAdminServer({ onRestart: () => void restartNg() });
  } catch (err) {
    console.error(red(`[dev] failed to start admin server on 127.0.0.1:${ADMIN_PORT}: ${err.message || err}`));
    process.exit(1);
  }

  const adminConfigPort = Number(process.env.ADMIN_CONFIG_PORT || 4201);
  const adminConfigScript = path.join(ROOT, 'admin-config-api.mjs');
  if (existsSync(adminConfigScript)) {
    const adminConfig = spawn(process.execPath, [adminConfigScript], {
      stdio: 'inherit',
      env: { ...process.env, ADMIN_CONFIG_PORT: String(adminConfigPort) }
    });
    adminConfig.on('error', (err) => {
      console.error(red(`[dev] failed to start admin-config API: ${err.message || err}`));
    });
    // Keep a local reference so Ctrl-C also stops the JSON writer
    const stopAdminConfig = () => {
      if (!adminConfig.killed) adminConfig.kill('SIGTERM');
    };
    process.on('exit', stopAdminConfig);
    console.log(`[dev] admin-config API on 127.0.0.1:${adminConfigPort} (/api/admin)`);
  }

  launchNg();

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

main().catch((err) => {
  console.error(red(`[dev] failed to start: ${err.message || err}`));
  process.exit(1);
});
