/**
 * Single source of truth for the ACI upstream host + per-service ports.
 *
 * Everything that needs to know "where is the backend" — the dev proxy
 * (proxy.conf.mjs) AND the generated runtime config files
 * (config/config.json, config/endpoint-health.json) — imports from here.
 *
 * Host resolution order (first one set wins):
 *   1. KD_UPSTREAM_HOST env var       — quick one-off override, doesn't
 *                                         touch any file.
 *   2. "upstreamHost" in config/config.json — persistent default. Edit
 *                                         this JSON field to change the
 *                                         backend IP for every future
 *                                         `npm start` / `serve.sh`, no
 *                                         env var or code edit needed.
 *   3. Hardcoded fallback below         — last resort if the config file
 *                                         is missing or unreadable.
 *
 * Usage:
 *   KD_UPSTREAM_HOST=10.0.0.5      npm start   # one-off override
 *   KD_UPSTREAM_HOST=kd.internal  npm start   # FQDN works the same way
 *   # or just edit "upstreamHost" in TAX_GOV_AE/config/config.json
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/web -> apps -> TAX_GOV_AE (repo root) -> config/config.json
const CONFIG_JSON_PATH = path.resolve(__dirname, '../../config/config.json');

function loadConfigJson() {
  try {
    return JSON.parse(readFileSync(CONFIG_JSON_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function readHostFromConfigJson() {
  const parsed = loadConfigJson();
  const host = parsed?.upstreamHost;
  return typeof host === 'string' && host.trim() ? host.trim() : undefined;
}

function readProtocolFromConfigJson() {
  const proto = loadConfigJson()?.protocol;
  return proto === 'https' || proto === 'http' ? proto : undefined;
}

/** Parse "view:9083", "host:9083", or "https://host:9083" → 9083 */
export function portFromUpstream(upstream) {
  const raw = String(upstream || '').trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  try {
    if (raw.includes('://')) {
      const u = new URL(raw);
      if (u.port) return Number(u.port);
    }
  } catch {
    /* ignore */
  }
  const m = raw.match(/:(\d+)\s*$/);
  return m ? Number(m[1]) : undefined;
}

export const COMPONENT_KEY_TO_PORT_NAME = {
  communityApiUrl: 'community',
  contentApiUrl: 'content',
  contentIndexApiUrl: 'contentIndex',
  qmsApiUrl: 'qms',
  viewApiUrl: 'view',
  viewServerUrl: 'view',
  viewUpstreamOrigin: 'view',
  agentstoreApiUrl: 'agentstore',
  categoryApiUrl: 'category',
  answerServerApiUrl: 'answerserver',
};

function readPortsFromConfigJson() {
  const components = loadConfigJson()?.components;
  if (!Array.isArray(components)) return {};
  const out = {};
  for (const row of components) {
    const name = COMPONENT_KEY_TO_PORT_NAME[row?.key];
    const port = portFromUpstream(row?.upstream);
    if (name && port) out[name] = port;
  }
  return out;
}

/**
 * Optional per-component override for the health-check ("Test" button)
 * probe port, read from config.json's `statusPort` field.
 *
 * WHY THIS EXISTS: GetStatus is documented as a *service* action, not an
 * ordinary ACI action — IDOL requires it be sent to the component's
 * Service port, which can be a different port from the ACI port used for
 * everything else that component does (login/session calls, the a=admin
 * browser console, etc.). Community in this environment is exactly that
 * case: 9033 is its ACI port (a=admin loads fine there, real UserRead /
 * SecurityInfo calls work fine there), but GetStatus sent to that same
 * port gets redirected because it isn't the Service port GetStatus is
 * meant to be sent to. Setting `statusPort` on a component in
 * config.json only affects endpoint-health.json's testBase/testUrl (the
 * Settings → Test button) — it never touches the real proxy target used
 * for that component's actual traffic (see proxy.conf.mjs /
 * PROXY_PATH_TO_PORT in generate-config.mjs), so fixing the health check
 * can't accidentally break the feature itself.
 */
function readStatusPortsFromConfigJson() {
  const components = loadConfigJson()?.components;
  if (!Array.isArray(components)) return {};
  const out = {};
  for (const row of components) {
    const name = COMPONENT_KEY_TO_PORT_NAME[row?.key];
    const port = Number(row?.statusPort);
    if (name && Number.isFinite(port) && port > 0) out[name] = port;
  }
  return out;
}

// Sandbox IDOL ACI is TLS on the demo host. Empty config + no env used to
// silently become http://127.0.0.1:9100 — Vite then logs "socket hang up"
// because nothing (or an HTTPS listener) is on localhost HTTP.
export const UPSTREAM_HOST =
  process.env.KD_UPSTREAM_HOST || readHostFromConfigJson() || '172.25.125.123';

/** http | https — IDOL ACI on this sandbox is TLS (https://host:9030 / :9100). */
export const UPSTREAM_PROTOCOL =
  process.env.KD_UPSTREAM_PROTOCOL === 'https' || process.env.KD_UPSTREAM_PROTOCOL === 'http'
    ? process.env.KD_UPSTREAM_PROTOCOL
    : readProtocolFromConfigJson() || 'https';

console.log(
  `[upstream] ${UPSTREAM_PROTOCOL}://${UPSTREAM_HOST} ` +
    `(env host=${process.env.KD_UPSTREAM_HOST || '-'} ` +
    `env proto=${process.env.KD_UPSTREAM_PROTOCOL || '-'} ` +
    `config host=${readHostFromConfigJson() || '-'} ` +
    `config proto=${readProtocolFromConfigJson() || '-'})`
);

/** Fallback ports when config.json has no components[].upstream. */
const DEFAULT_PORTS = {
  community: 9030,
  content: 9100,
  contentIndex: 9101,
  qms: 16000,
  view: 9080,
  agentstore: 9150,
  category: 9020,
  answerserver: 12000,
};

/** Ports from config.json components[].upstream (e.g. view:9083), else defaults. */
export const PORTS = { ...DEFAULT_PORTS, ...readPortsFromConfigJson() };

/** Per-component health-check port overrides (see readStatusPortsFromConfigJson
 *  above) — only set for components with a `statusPort` in config.json. */
export const STATUS_PORTS = readStatusPortsFromConfigJson();

/** The port endpoint-health.json's Test button should probe for `name`
 *  (a PORTS/STATUS_PORTS key, e.g. "community") — the override if one is
 *  configured, otherwise the same ACI port everything else uses. */
export const healthPortFor = (name) => STATUS_PORTS[name] ?? PORTS[name];

export const STATUS_PATH = '/action=getstatus';

export const targetFor = (port) => `${UPSTREAM_PROTOCOL}://${UPSTREAM_HOST}:${port}`;
export const testUrlFor = (port) => `${targetFor(port)}${STATUS_PATH}`;
