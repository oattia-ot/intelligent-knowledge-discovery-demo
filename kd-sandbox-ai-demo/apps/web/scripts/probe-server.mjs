#!/usr/bin/env node
/**
 * Standalone dynamic-target probe server for the Settings → Test button.
 *
 * WHY THIS EXISTS (please read before "simplifying" this back into
 * proxy.conf.mjs — it has been tried twice and doesn't work):
 *
 * The Angular dev server's --proxy-config is handed straight to Vite's
 * `server.proxy`, which Vite implements with its own vendored copy of the
 * `http-proxy` package. That vendored copy does NOT implement the `router`
 * option — grep the installed `vite/dist/node/chunks/*.js` for the string
 * "router" and you will find zero matches. Any `router: (req) => ...`
 * you put in a Vite ProxyOptions entry is silently ignored; the proxy
 * always dials the static `target` you configured, forever. There is no
 * way to pick a different upstream host per request through Vite's proxy.
 *
 * That's why every earlier attempt at a dynamic '/__kd-probe' entry in
 * proxy.conf.mjs kept connecting to the http://127.0.0.1:9 fallback
 * regardless of what target the client asked for (via query string or
 * headers) — the fallback IS the static `target`, and nothing overrides
 * it.
 *
 * The fix: don't ask Vite's proxy to route dynamically at all. This tiny
 * server does the dynamic part itself with a plain Node `http`/`https`
 * request (which has no such limitation), and proxy.conf.mjs proxies
 * '/__kd-probe' to this server with an ordinary STATIC target — the one
 * thing Vite's proxy is actually good at.
 *
 * Flow:
 *   Browser --(X-KD-Probe-Target / X-KD-Probe-Test headers)--> /__kd-probe
 *     --(static Vite proxy, target=http://127.0.0.1:PROBE_PORT)--> this server
 *       --(real dynamic http/https request)--> whatever host:port the user typed
 */

import http from 'node:http';
import https from 'node:https';
import { colorByStatus, red } from './log-colors.mjs';
import { handlePreflight, writeCors } from './cors-headers.mjs';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __probeDir = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_JSON = path.resolve(__probeDir, '../../../config/config.json');

function loadAllowedUpstreams() {
  const hosts = new Set(['127.0.0.1', 'localhost']);
  const ports = new Set();
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_JSON, 'utf8'));
    if (typeof cfg.upstreamHost === 'string' && cfg.upstreamHost.trim()) {
      hosts.add(cfg.upstreamHost.trim().toLowerCase());
    }
    for (const row of cfg.components || []) {
      const up = String(row.upstream || '');
      const m = up.match(/:(\d+)\s*$/);
      if (m) ports.add(Number(m[1]));
      if (row.statusPort) ports.add(Number(row.statusPort));
    }
  } catch {
    /* keep loopback only */
  }
  // Known IDOL ACI / service ports used by this demo
  for (const port of [9030, 9033, 9080, 9083, 9100, 9101, 9102, 9103, 9104, 9105, 9150, 9200, 9020, 9060, 12000, 16000, 20050, 8443, 27111, 27113]) {
    ports.add(port);
  }
  return { hosts, ports };
}

const ALLOWED = loadAllowedUpstreams();

function redactProbeLabel(label) {
  return String(label)
    .replace(/Password=[^&]*/gi, 'Password=***')
    .replace(/SecurityInfo=[^&]*/gi, 'SecurityInfo=***');
}

function assertSafeProbe(parsedTarget, testPath) {
  const host = (parsedTarget.hostname || '').toLowerCase();
  const port = Number(parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80));
  if (!ALLOWED.hosts.has(host)) {
    throw new Error(`probe target host is not in the configured allow-list (${host})`);
  }
  if (port === 80 || port === 443) {
    throw new Error('probe target must use an IDOL ACI port, not 80/443');
  }
  if (![...ALLOWED.ports].includes(port)) {
    throw new Error(`probe target port ${port} is not an allowed IDOL port`);
  }
  const pathAndQuery = testPath || '/';
  if (/password=/i.test(pathAndQuery) || /securityinfo=/i.test(pathAndQuery)) {
    throw new Error('probe path must not carry credentials or SecurityInfo');
  }
  const allowedHealth =
    /getstatus/i.test(pathAndQuery) ||
    /^\/DRESTATUS\/?$/i.test(pathAndQuery) ||
    /^\/nifi\/?$/i.test(pathAndQuery);
  if (/userread|manage|converse|\bask\b/i.test(pathAndQuery)) {
    throw new Error('probe path is limited to health checks');
  }
  if (/^\/DRE(?!STATUS\b)/i.test(pathAndQuery)) {
    throw new Error('probe path is limited to DRESTATUS / GetStatus health checks');
  }
  if (!allowedHealth) {
    throw new Error('probe path must be action=GetStatus, /DRESTATUS, or /nifi');
  }
}

export const PROBE_PORT = Number(process.env.KD_PROBE_PORT || 4300);
const PROBE_HOST = '127.0.0.1';
const REQUEST_TIMEOUT_MS = Number(process.env.KD_PROBE_TIMEOUT_MS || 9000);

function readTarget(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const fromHeader = req.headers['x-kd-probe-target'];
  const target = (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader) ||
    url.searchParams.get('target') ||
    '';
  return target;
}

function readTestPath(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const fromHeader = req.headers['x-kd-probe-test'];
  const test = (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader) ||
    url.searchParams.get('test') ||
    '/action=getstatus';
  return test.startsWith('/') ? test : `/${test}`;
}

// Redirects (3xx) are followed here rather than being handed straight back
// to the browser as a "failure". ROOT CAUSE: every configured endpoint was
// being reported by the Settings → Test button as a dead-end 301 even
// though the upstream service was actually up and healthy — it was just
// doing an ordinary http->https (or trailing-slash) redirect, which this
// probe used to hand back as-is with no Location header (only
// Content-Type was ever forwarded, see the old writeHead call below), so
// the browser had no way to tell the difference between "really broken"
// and "just redirected". We now do the extra hop(s) ourselves, the same
// way a normal browser tab would, and only report the *final* outcome.
const MAX_REDIRECTS = 5;

function requestOnce(parsedTarget, testPath, log, label) {
  return new Promise((resolve, reject) => {
    const client = parsedTarget.protocol === 'https:' ? https : http;
    const upstreamReq = client.request(
      {
        protocol: parsedTarget.protocol,
        hostname: parsedTarget.hostname,
        port: parsedTarget.port || (parsedTarget.protocol === 'https:' ? 443 : 80),
        path: testPath,
        method: 'GET',
        timeout: REQUEST_TIMEOUT_MS,
        rejectUnauthorized: process.env.KD_TLS_INSECURE === '0' ? true : false
      },
      (upstreamRes) => {
        log.log(colorByStatus(upstreamRes.statusCode, `[probe] GET ${label}  ←  ${upstreamRes.statusCode}`));
        resolve(upstreamRes);
      }
    );

    upstreamReq.on('timeout', () => {
      log.error(red(`[probe] ERROR GET ${label}: timeout after ${REQUEST_TIMEOUT_MS}ms`));
      upstreamReq.destroy(new Error('Probe request timed out'));
    });

    upstreamReq.on('error', reject);
    upstreamReq.end();
  });
}

async function probeWithRedirects(initialTarget, initialTestPath, log) {
  let parsedTarget = initialTarget;
  let testPath = initialTestPath;
  const chain = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const label = redactProbeLabel(`${parsedTarget.origin}${testPath}`);
    log.log(`[probe] GET ${label}`);
    const upstreamRes = await requestOnce(parsedTarget, testPath, log, label);
    const status = upstreamRes.statusCode || 502;
    const location = upstreamRes.headers['location'];

    if (status >= 300 && status < 400 && location) {
      chain.push(`${label} -> ${status}`);
      // Drain this response before following the redirect so the socket
      // is freed and doesn't dangle.
      upstreamRes.resume();
      let nextUrl;
      try {
        nextUrl = new URL(location, parsedTarget);
      } catch {
        // Location header present but unparsable — give up and report
        // this hop's redirect as-is rather than throwing.
        return { upstreamRes, status, location, redirectChain: chain, finalUrl: label };
      }
      if (hop === MAX_REDIRECTS) {
        // Too many hops — report the *last* redirect rather than looping
        // forever, but the chain we followed is still useful diagnostic
        // info for the caller.
        return { upstreamRes, status, location, redirectChain: chain, finalUrl: nextUrl.toString() };
      }
      parsedTarget = new URL(nextUrl.origin);
      testPath = `${nextUrl.pathname || '/'}${nextUrl.search || ''}`;
      continue;
    }

    return { upstreamRes, status, location, redirectChain: chain, finalUrl: label };
  }

  // Unreachable, but keeps TypeScript-less linting happy.
  throw new Error('probeWithRedirects: exhausted loop unexpectedly');
}

export function startProbeServer({ port = PROBE_PORT, host = PROBE_HOST, log = console } = {}) {
  const server = http.createServer(async (req, res) => {
    if (handlePreflight(req, res)) return;
    writeCors(res, req);
    const rawTarget = readTarget(req);

    // No target header/param at all — this is a plain readiness/health
    // check (e.g. serve.sh polling http://127.0.0.1:4300/ before starting
    // ng serve, or a browser hitting / directly), not a real probe
    // request. Every real probe carries X-KD-Probe-Target. Answer 200
    // and stop — don't log it as an error, and don't log it at all, since
    // the startup poll can hit this several times per second.
    if (!rawTarget) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('probe-server ready version=1.2.12');
      return;
    }

    const testPath = readTestPath(req);

    let parsedTarget;
    try {
      parsedTarget = new URL(rawTarget);
      if (!['http:', 'https:'].includes(parsedTarget.protocol) || !parsedTarget.hostname) {
        throw new Error('target must be an absolute HTTP(S) URL');
      }
      assertSafeProbe(parsedTarget, testPath);
    } catch (err) {
      log.error(red(`[probe] ERROR invalid target "${rawTarget}": ${err.message}`));
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Invalid probe target: ${err.message}`);
      return;
    }

    const label = redactProbeLabel(`${parsedTarget.origin}${testPath}`);

    try {
      const { upstreamRes, status, location, redirectChain, finalUrl } = await probeWithRedirects(
        parsedTarget,
        testPath,
        log
      );

      if (redirectChain.length) {
        log.log(`[probe] followed ${redirectChain.length} redirect(s): ${redirectChain.join(' -> ')} -> ${finalUrl}`);
      }

      const headers = {
        'Content-Type': upstreamRes.headers['content-type'] || 'text/plain',
        // Forward these so the browser can show a real diagnostic instead
        // of a generic "check http vs https" guess when a redirect can't
        // be (or wasn't fully) followed — e.g. MAX_REDIRECTS was hit, or
        // the Location header pointed somewhere this probe couldn't reach.
        'X-KD-Probe-Final-Url': finalUrl,
        'X-KD-Probe-Redirect-Count': String(redirectChain.length)
      };
      if (location) {
        headers['Location'] = location;
      }
      res.writeHead(status, headers);
      upstreamRes.pipe(res);
    } catch (err) {
      log.error(red(`[probe] ERROR GET ${label}: ${err.message}`));
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Not connected — ${label}: ${err.message}`);
      } else {
        res.end();
      }
    }
  });

  return new Promise((resolve, reject) => {
    // Without this handler, a bind failure (e.g. EADDRINUSE from a
    // leftover probe process on a previous crashed/killed run) is an
    // unhandled 'error' event — Node throws it and the whole process
    // dies with a raw stack trace instead of failing gracefully.
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        // Leftover probe from a previous serve.sh / npm start. Reuse it
        // the same way admin-server.mjs reuses :4301 — starting a second
        // listener is what produced:
        //   Error: listen EADDRINUSE: address already in use 127.0.0.1:4300
        log.log(
          `[probe] port ${port} already in use — reusing the existing probe server on http://${host}:${port}`
        );
        resolve(null);
        return;
      }
      reject(err);
    });
    server.listen(port, host, () => {
      log.log(`[probe] listening on http://${host}:${port} (dynamic-target probe server)`);
      resolve(server);
    });
  });
}

// Allow running standalone: `node scripts/probe-server.mjs`
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startProbeServer()
    .then((server) => {
      if (!server) {
        console.log('[probe] reused existing listener');
      }
    })
    .catch((err) => {
      console.error(red(`[probe] failed to start: ${err.message || err}`));
      process.exit(1);
    });
}
