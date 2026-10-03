#!/usr/bin/env node
/**
 * Port-conflict guard used by scripts/dev.mjs.
 *
 * Why this exists: `ng serve` has its own interactive "Port 4200 is
 * already in use. Would you like to use a different port?" prompt, but in
 * a lot of terminals (non-TTY shells, some IDE run panels, CI-like
 * environments) that prompt can't actually read a keystroke. Angular then
 * throws an unhandled exception instead of failing gracefully:
 *
 *   An unhandled exception occurred: Port 4200 is already in use.
 *   Use '--port' to specify a different port.
 *
 * This module checks the port *before* `ng serve` ever starts, and if
 * it's busy, asks the user directly whether to kill whatever process is
 * holding it (with the PID and command shown), instead of leaving it to
 * Angular's flaky prompt.
 */
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { red, yellow, gray } from './log-colors.mjs';

/** Resolve once a TCP port is free to bind, or false if something is listening on it. */
export function isPortFree(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (err) => {
      tester.close(() => resolve(err.code !== 'EADDRINUSE'));
    });
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

/** Find PIDs (and a short description) currently listening on `port`. POSIX only. */
function findListeners(port) {
  // Prefer lsof: gives us PID + command name in one shot.
  const lsof = spawnSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (!lsof.error && lsof.stdout) {
    const lines = lsof.stdout.trim().split('\n').slice(1); // drop header
    const seen = new Map();
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      const [command, pid] = cols;
      if (pid && !seen.has(pid)) seen.set(pid, command || 'unknown');
    }
    if (seen.size) return [...seen.entries()].map(([pid, command]) => ({ pid, command }));
  }

  // Fallback: fuser tells us PIDs only, no command name.
  const fuser = spawnSync('fuser', [`${port}/tcp`], { encoding: 'utf8' });
  if (!fuser.error) {
    const pids = (fuser.stdout || fuser.stderr || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (pids.length) return pids.map((pid) => ({ pid, command: 'unknown' }));
  }

  return [];
}

function killPids(pids) {
  for (const pid of pids) {
    spawnSync('kill', [pid]);
  }
}

function forceKillPids(pids) {
  for (const pid of pids) {
    spawnSync('kill', ['-9', pid]);
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

/**
 * Make sure `port` is free before returning. If it's busy, tell the user
 * what's holding it and ask whether to kill it. Returns true once the
 * port is free (or the user chose to proceed anyway with a different
 * port), false if the user declined and there's nothing else to do.
 *
 * When stdin isn't interactive (no TTY — e.g. piped input, some CI
 * runners), we can't prompt, so we just report the conflict and bail
 * instead of hanging or letting `ng serve` crash with an unhandled
 * exception.
 */
export async function ensurePortAvailable(port, { host = '0.0.0.0' } = {}) {
  if (await isPortFree(port, host)) return true;

  console.error(yellow(`[dev] Port ${port} is already in use.`));

  const listeners = findListeners(port);
  if (listeners.length) {
    for (const { pid, command } of listeners) {
      console.error(gray(`[dev]   PID ${pid}  (${command})`));
    }
  } else {
    console.error(gray('[dev]   Could not identify the process (lsof/fuser unavailable).'));
  }

  if (!process.stdin.isTTY) {
    console.error(
      red(
        `[dev] Not an interactive terminal, so I can't ask. Free port ${port} yourself ` +
          `(e.g. \`kill ${listeners.map((l) => l.pid).join(' ') || '<pid>'}\`) or rerun with ` +
          `\`--port <other-port>\`.`
      )
    );
    return false;
  }

  if (!listeners.length) {
    console.error(red(`[dev] Nothing found to kill. Rerun with \`--port <other-port>\` instead.`));
    return false;
  }

  const answer = await ask(
    `Kill the process using port ${port}? [PID ${listeners.map((l) => l.pid).join(', ')}] (y/N) `
  );

  if (answer !== 'y' && answer !== 'yes') {
    console.error(gray('[dev] Leaving it running. Not starting the dev server.'));
    return false;
  }

  killPids(listeners.map((l) => l.pid));

  // Give it a moment to actually release the socket.
  for (let i = 0; i < 20; i++) {
    if (await isPortFree(port, host)) {
      console.error(gray(`[dev] Port ${port} is now free.`));
      return true;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // Still stuck after SIGTERM — offer SIGKILL rather than giving up silently.
  const forceAnswer = await ask(
    `[dev] Port ${port} is still in use after a normal kill. Force kill (-9)? (y/N) `
  );
  if (forceAnswer === 'y' || forceAnswer === 'yes') {
    forceKillPids(listeners.map((l) => l.pid));
    for (let i = 0; i < 20; i++) {
      if (await isPortFree(port, host)) {
        console.error(gray(`[dev] Port ${port} is now free.`));
        return true;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  console.error(red(`[dev] Port ${port} is still in use. Giving up.`));
  return false;
}
