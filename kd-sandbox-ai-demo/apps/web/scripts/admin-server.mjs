#!/usr/bin/env node
/**
 * Config-admin server for the Settings -> "Backend upstream host" textbox.
 *
 * WHY THIS EXISTS: the browser can't write files or restart the dev
 * server on its own. This tiny localhost-only server gives the Settings
 * UI a real (if narrow) API to do both:
 *   - POST /update-host  { host }  -> writes config/config.json's
 *     "upstreamHost" field, re-runs generate-config.mjs (so
 *     endpoint-health.json / proxy.conf.json stay in sync — see
 *     upstream.config.mjs for the full resolution order), then calls the
 *     onRestart() callback dev.mjs gave us so `ng serve` restarts with
 *     the new proxy targets (proxy.conf.mjs re-imports upstream.config.mjs
 *     fresh every time `ng serve` starts).
 *   - GET  /current-host           -> current upstreamHost, for the
 *     textbox's initial value.
 *
 * Reached from the browser the same way probe-server.mjs is: a plain
 * STATIC Vite proxy entry '/__kd-admin' -> http://127.0.0.1:ADMIN_PORT
 * (see proxy.conf.mjs). No CORS needed since it's same-origin through
 * the proxy.
 *
 * Only wired up by scripts/dev.mjs (the `npm start` flow), because only
 * dev.mjs holds a live reference to the `ng serve` child process it can
 * kill and respawn. serve.sh runs `ng serve` as its own foreground
 * process with no such handle, so restart-from-the-UI isn't available
 * there — config.json still gets updated and picked up on the next
 * manual restart.
 */

import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { red, gray, green } from './log-colors.mjs';
import { handlePreflight, writeCors } from './cors-headers.mjs';

export const ADMIN_PORT = Number(process.env.KD_ADMIN_PORT || 4301);
const ADMIN_HOST = '127.0.0.1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
// apps/web -> apps -> TAX_GOV_AE (repo root) -> config/config.json
const CONFIG_JSON_PATH = path.resolve(WEB_ROOT, '../../config/config.json');
const DATABASES_JSON_PATH = path.resolve(WEB_ROOT, '../../config/databases.json');
const DATABASES_ASSETS_PATH = path.resolve(WEB_ROOT, 'src/assets/config/databases.json');
const ANSWER_JSON_PATH = path.resolve(WEB_ROOT, '../../config/answer.json');
const ANSWER_ASSETS_PATH = path.resolve(WEB_ROOT, 'src/assets/config/answer.json');
const GENERATE_CONFIG_SCRIPT = path.join(WEB_ROOT, 'scripts', 'generate-config.mjs');

// Bare hostname or IPv4/IPv6-ish literal only — no protocol, no port, no
// path, no whitespace. Keeps this a plain "host" the same way
// upstream.config.mjs's UPSTREAM_HOST is used (targetFor() adds the
// protocol and port itself).
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

function isValidHost(host) {
  if (typeof host !== 'string') return false;
  const trimmed = host.trim();
  // Empty string is allowed: clears "upstreamHost" to "" in config.json.
  // Non-empty values must still be a bare hostname/IP (no protocol/port/path).
  if (!trimmed) return true;
  if (trimmed.length > 253) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return false; // reject "http://...", "ftp://...", etc.
  if (/[:/\s]/.test(trimmed)) return false; // no port, no path, no whitespace
  return HOST_PATTERN.test(trimmed);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e5) req.destroy(new Error('Request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function readCurrentHost() {
  const raw = readFileSync(CONFIG_JSON_PATH, 'utf8');
  const config = JSON.parse(raw);
  return typeof config.upstreamHost === 'string' ? config.upstreamHost : '';
}

function readCurrentProtocol() {
  try {
    const raw = readFileSync(CONFIG_JSON_PATH, 'utf8');
    const config = JSON.parse(raw);
    return config.protocol === 'http' || config.protocol === 'https' ? config.protocol : 'https';
  } catch {
    return 'https';
  }
}

function writeHost(host, protocol) {
  const raw = readFileSync(CONFIG_JSON_PATH, 'utf8');
  const config = JSON.parse(raw);
  config.upstreamHost = host;
  if (protocol === 'http' || protocol === 'https') {
    config.protocol = protocol;
  }
  writeFileSync(CONFIG_JSON_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

const KEY_TO_SERVICE_NAME = {
  communityApiUrl: 'community',
  contentApiUrl: 'content',
  contentIndexApiUrl: 'content',
  qmsApiUrl: 'qms',
  viewApiUrl: 'view',
  viewServerUrl: 'view',
  viewUpstreamOrigin: 'view',
  agentstoreApiUrl: 'agentstore',
  categoryApiUrl: 'category',
  answerServerApiUrl: 'answerserver',
  nifiCanvasUrl: 'nifi'
};

function serviceNameFromUpstream(upstream, key) {
  const raw = String(upstream || '').trim();
  if (raw && !raw.includes('://')) {
    const name = raw.split(':')[0];
    if (name && !/^\d+$/.test(name)) return name;
  }
  return KEY_TO_SERVICE_NAME[key] || '';
}

function parseHostPort(value) {
  const raw = String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!raw) return { host: '', port: undefined };
  const m = raw.match(/^(?:\[([^\]]+)\]|([^:/]+)):(\d+)$/);
  if (m) {
    return { host: (m[1] || m[2] || '').trim(), port: Number(m[3]) };
  }
  if (/^\d+$/.test(raw)) return { host: '', port: Number(raw) };
  return { host: raw.split('/')[0], port: undefined };
}

/**
 * Persist per-row host:port edits from Settings into config.json:
 *   - protocol / upstreamHost when a host is present
 *   - components[].upstream serviceName:port when a port is present
 * generate-config.mjs then refreshes endpoint-health.json + assets copy.
 */
function writeEndpoints(payload) {
  const raw = readFileSync(CONFIG_JSON_PATH, 'utf8');
  const config = JSON.parse(raw);
  const rows = Array.isArray(payload?.components) ? payload.components : [];
  const changed = [];

  if (payload?.protocol === 'http' || payload?.protocol === 'https') {
    if (config.protocol !== payload.protocol) {
      config.protocol = payload.protocol;
      changed.push(`protocol=${payload.protocol}`);
    }
  }

  if (typeof payload?.host === 'string') {
    const hostOnly = payload.host.trim().replace(/^https?:\/\//i, '').replace(/:\d+$/, '').replace(/\/+$/, '');
    if (isValidHost(hostOnly) && config.upstreamHost !== hostOnly) {
      config.upstreamHost = hostOnly;
      changed.push(`upstreamHost=${hostOnly || '""'}`);
    }
  }

  const byKey = new Map((config.components || []).map((c) => [c.key, c]));
  for (const row of rows) {
    const key = typeof row?.key === 'string' ? row.key : '';
    const component = byKey.get(key);
    if (!component) continue;

    const parsed = parseHostPort(row.host ?? row.hostPort ?? row.value ?? '');
    const port =
      Number(row.port) > 0
        ? Number(row.port)
        : parsed.port;
    const host = (typeof row.hostname === 'string' ? row.hostname.trim() : '') || parsed.host;

    if (host && isValidHost(host) && !config.upstreamHost) {
      config.upstreamHost = host;
      changed.push(`upstreamHost=${host}`);
    } else if (host && isValidHost(host) && rows.length === 1) {
      // A single-row save that includes a host should update the shared
      // upstreamHost so the next generate-config / proxy start uses it.
      if (config.upstreamHost !== host) {
        config.upstreamHost = host;
        changed.push(`upstreamHost=${host}`);
      }
    }

    if (port && Number.isFinite(port) && port > 0 && port < 65536) {
      const svc = serviceNameFromUpstream(component.upstream, key);
      const nextUpstream = svc ? `${svc}:${port}` : String(port);
      if (component.upstream !== nextUpstream) {
        component.upstream = nextUpstream;
        changed.push(`${key}.upstream=${nextUpstream}`);
      }
    }

    if (row.protocol === 'http' || row.protocol === 'https') {
      // Per-row protocol is stored globally; IDOL sandbox is one scheme.
      if (config.protocol !== row.protocol) {
        config.protocol = row.protocol;
        changed.push(`protocol=${row.protocol}`);
      }
    }
  }

  writeFileSync(CONFIG_JSON_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return { config, changed };
}

function readDatabasesFile() {
  try {
    return JSON.parse(readFileSync(DATABASES_JSON_PATH, 'utf8'));
  } catch {
    return { defaultScope: 'all', databases: [] };
  }
}

function sanitizeDatabaseRow(row) {
  if (!row || typeof row !== 'object') return null;
  const name = String(row.databaseMatch || row.id || row.name || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) return null;
  const id = String(row.id || name).trim() || name;
  const label = String(row.label || name).trim() || name;
  const out = {
    id,
    databaseMatch: name,
    label,
    defaultSelected: row.defaultSelected !== false
  };
  if (typeof row.description === 'string' && row.description.trim()) {
    out.description = row.description.trim();
  }
  if (Array.isArray(row.titleFields) && row.titleFields.length) {
    out.titleFields = row.titleFields.map((f) => String(f).trim()).filter(Boolean);
  } else {
    out.titleFields = ['DRETITLE', 'TITLE', 'NAME'];
  }
  if (typeof row.referenceStrategy === 'string' && row.referenceStrategy.trim()) {
    out.referenceStrategy = row.referenceStrategy.trim();
  } else {
    out.referenceStrategy = 'drereference';
  }
  if (typeof row.notes === 'string' && row.notes.trim()) out.notes = row.notes.trim();
  return out;
}

function writeDatabasesFile(payload) {
  const existing = readDatabasesFile();
  const incoming = Array.isArray(payload?.databases) ? payload.databases : [];
  const databases = incoming.map(sanitizeDatabaseRow).filter(Boolean);
  const file = {
    $schema_comment:
      existing.$schema_comment ||
      'Pre-configured IDOL databases for KD Enterprise Search. Updated at runtime from Content GetStatus.',
    defaultScope: payload?.defaultScope || existing.defaultScope || 'all',
    databases
  };
  const text = JSON.stringify(file, null, 2) + '\n';
  let previous = '';
  try {
    previous = readFileSync(DATABASES_JSON_PATH, 'utf8');
  } catch {
    previous = '';
  }
  if (previous === text) {
    return { ...file, unchanged: true };
  }
  writeFileSync(DATABASES_JSON_PATH, text, 'utf8');
  // Never write src/assets/config at runtime. The Angular/Vite dev server
  // watches that tree; a write triggers a full page reload, which re-lists
  // Content databases and used to write the file again.
  return file;
}


// ---- answer.json: external LLM system (Settings -> Application) -------------
const SYSTEM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function splitSystems(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Public view: never returns the API key itself. */
function readExternalLlm() {
  const file = readJsonFile(ANSWER_JSON_PATH, {});
  const ext = file.externalLlm && typeof file.externalLlm === 'object' ? file.externalLlm : {};
  const key = typeof ext.apiKey === 'string' ? ext.apiKey : '';
  return {
    systemName: typeof ext.systemName === 'string' ? ext.systemName : '',
    apiKeySet: !!key,
    apiKeyHint: key ? `••••${key.slice(-4)}` : '',
    systemNames: String(file.systemNames || file.systemName || 'RAG')
  };
}

/**
 * Update config/answer.json:
 *   externalLlm = { systemName, apiKey }   (apiKey lives ONLY in config/)
 *   systemNames = base systems + externalLlm.systemName
 * and mirror systemNames + externalLlm.systemName (no key) into
 * src/assets/config/answer.json, because that copy is served to browsers.
 * Blank apiKey keeps the stored key; remove:true clears the external system.
 */
function writeExternalLlm(payload) {
  const file = readJsonFile(ANSWER_JSON_PATH, {});
  const prev = file.externalLlm && typeof file.externalLlm === 'object' ? file.externalLlm : {};
  const prevName = typeof prev.systemName === 'string' ? prev.systemName.trim() : '';

  const remove = payload?.remove === true;
  const name = remove ? '' : String(payload?.systemName ?? '').trim();
  if (name && !SYSTEM_NAME_PATTERN.test(name)) {
    const err = new Error('System name may only contain letters, digits, "_" and "-".');
    err.status = 400;
    throw err;
  }
  const incomingKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';
  const apiKey = remove ? '' : incomingKey || (typeof prev.apiKey === 'string' ? prev.apiKey : '');

  let base = splitSystems(file.systemNames || file.systemName).filter((s) => s !== prevName);
  if (!base.length) base = ['RAG'];
  const systems = name && !base.includes(name) ? [...base, name] : base;

  file.systemNames = systems.join(',');
  delete file.systemName;
  if (name) {
    file.externalLlm = { systemName: name, apiKey };
  } else {
    delete file.externalLlm;
  }
  writeFileSync(ANSWER_JSON_PATH, JSON.stringify(file, null, 2) + '\n', 'utf8');

  const pub = readJsonFile(ANSWER_ASSETS_PATH, { ...file });
  pub.systemNames = file.systemNames;
  delete pub.systemName;
  if (name) {
    pub.externalLlm = { systemName: name };
  } else {
    delete pub.externalLlm;
  }
  writeFileSync(ANSWER_ASSETS_PATH, JSON.stringify(pub, null, 2) + '\n', 'utf8');

  return { systemNames: file.systemNames, systemName: name, apiKeySet: !!apiKey };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * @param {object} opts
 * @param {() => void} [opts.onRestart] - called after a successful host
 *   update to restart `ng serve`. Omit to run in "save only" mode (e.g.
 *   no known way to restart the caller's dev server).
 */
export function startAdminServer({ port = ADMIN_PORT, host = ADMIN_HOST, onRestart, log = console } = {}) {
  const server = http.createServer(async (req, res) => {
    if (handlePreflight(req, res)) return;
    writeCors(res, req);
    const url = new URL(req.url || '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('admin-server ready');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/current-host') {
      try {
        sendJson(res, 200, {
          host: readCurrentHost(),
          protocol: readCurrentProtocol(),
          canRestart: !!onRestart
        });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/current-answer') {
      sendJson(res, 200, readExternalLlm());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/update-answer') {
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' });
        return;
      }
      try {
        const result = writeExternalLlm(payload);
        log.log(green(`[admin] answer.json systemNames -> ${result.systemNames}`));
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        log.error(red(`[admin] ERROR updating answer.json: ${err.message}`));
        sendJson(res, err.status || 500, { ok: false, error: err.message });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/current-databases') {
      try {
        sendJson(res, 200, readDatabasesFile());
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/update-databases') {
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' });
        return;
      }
      try {
        const file = writeDatabasesFile(payload);
        if (file.unchanged) {
          log.log(gray(`[admin] databases.json unchanged (${file.databases.length} databases)`));
        } else {
          log.log(green(`[admin] databases.json -> ${file.databases.length} active database(s)`));
        }
        sendJson(res, 200, { ok: true, count: file.databases.length, databases: file.databases });
      } catch (err) {
        log.error(red(`[admin] ERROR updating databases.json: ${err.message}`));
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/update-host') {
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' });
        return;
      }

      const host2 = typeof payload.host === 'string' ? payload.host.trim() : '';
      const protocol2 =
        payload.protocol === 'http' || payload.protocol === 'https' ? payload.protocol : undefined;
      if (!isValidHost(host2)) {
        sendJson(res, 400, {
          ok: false,
          error: 'Enter a bare hostname or IP address — no http://, no port, no path.'
        });
        return;
      }

      try {
        writeHost(host2, protocol2);
        log.log(
          green(
            `[admin] upstreamHost -> ${host2 || '"" (empty)'}` +
              (protocol2 ? ` protocol -> ${protocol2}` : '')
          )
        );

        const gen = spawnSync(process.execPath, [GENERATE_CONFIG_SCRIPT], { encoding: 'utf8' });
        if (gen.status !== 0) {
          log.error(red(`[admin] generate-config failed: ${(gen.stderr || gen.stdout || '').trim()}`));
          sendJson(res, 500, {
            ok: false,
            error: 'Host was saved, but regenerating config files failed. Check the terminal log.'
          });
          return;
        }
        if (gen.stdout) log.log(gray(gen.stdout.trim()));

        sendJson(res, 200, { ok: true, host: host2, restarting: !!onRestart });

        if (onRestart) {
          // Let the HTTP response actually reach the browser before we
          // kill the dev server that's serving it.
          setTimeout(() => {
            log.log(gray('[admin] restarting ng serve to apply the new upstream host...'));
            onRestart();
          }, 250);
        }
      } catch (err) {
        log.error(red(`[admin] ERROR updating host: ${err.message}`));
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/update-endpoints' || url.pathname === '/update-config')) {
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body.' });
        return;
      }

      try {
        const { changed } = writeEndpoints(payload);
        log.log(
          green(
            changed.length
              ? `[admin] config.json endpoints -> ${changed.join(', ')}`
              : '[admin] config.json endpoints unchanged'
          )
        );

        const gen = spawnSync(process.execPath, [GENERATE_CONFIG_SCRIPT], { encoding: 'utf8' });
        if (gen.status !== 0) {
          log.error(red(`[admin] generate-config failed: ${(gen.stderr || gen.stdout || '').trim()}`));
          sendJson(res, 500, {
            ok: false,
            error: 'Endpoints were saved, but regenerating config files failed. Check the terminal log.'
          });
          return;
        }
        if (gen.stdout) log.log(gray(gen.stdout.trim()));

        sendJson(res, 200, {
          ok: true,
          changed,
          host: readCurrentHost(),
          protocol: readCurrentProtocol(),
          restarting: false
        });
      } catch (err) {
        log.error(red(`[admin] ERROR updating endpoints: ${err.message}`));
        sendJson(res, 500, { ok: false, error: err.message });
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        // Leftover admin from a previous serve.sh / npm start. Reuse it.
        log.log(
          `[admin] port ${port} already in use — reusing the existing admin server on http://${host}:${port}`
        );
        resolve(null);
        return;
      }
      reject(err);
    });
    server.listen(port, host, () => {
      log.log(`[admin] listening on http://${host}:${port} (config admin server)`);
      resolve(server);
    });
  });
}

// Allow running standalone: `node scripts/admin-server.mjs`
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startAdminServer();
}
