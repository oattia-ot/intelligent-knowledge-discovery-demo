#!/usr/bin/env node
/**
 * Regenerates the host-derived fields of config/config.json and
 * config/endpoint-health.json from the SAME source used by the dev
 * proxy: ./upstream.config.mjs (KD_UPSTREAM_HOST env var + PORTS map).
 *
 * Why this exists:
 *   proxy.conf.mjs already derives every proxy target from
 *   KD_UPSTREAM_HOST. But config/config.json (viewUpstreamOrigin's
 *   absoluteDefault) and config/endpoint-health.json (testBase/testUrl
 *   per endpoint) are plain static JSON assets served to the browser —
 *   they have no way to read an env var themselves. Previously they
 *   just hardcoded 127.0.0.1 and silently drifted from whatever the
 *   proxy was actually pointed at.
 *
 *   This script closes that gap: it overwrites only the host-derived
 *   fields in those two files, in place, leaving every other key
 *   (labels, descriptions, paths, upstream service names, business /
 *   localization settings, etc.) untouched.
 *
 * When it runs:
 *   Called automatically by sync-config.sh (which itself runs from
 *   serve.sh / npm run sync-config before ng serve starts), so a plain
 *   `KD_UPSTREAM_HOST=kd.internal npm start` keeps proxy.conf.mjs,
 *   config.json and endpoint-health.json all pointed at the same host.
 *
 * Usage:
 *   KD_UPSTREAM_HOST=kd.internal node scripts/generate-config.mjs
 *   npm run generate:config          # uses KD_UPSTREAM_HOST from env, or default
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  UPSTREAM_HOST,
  PORTS,
  STATUS_PATH,
  targetFor,
  testUrlFor,
  healthPortFor,
  COMPONENT_KEY_TO_PORT_NAME
} from '../upstream.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ -> apps/web -> apps -> TAX_GOV_AE (repo root) -> config
const CONFIG_DIR = path.resolve(__dirname, '../../../config');

const CONFIG_JSON_PATH = path.join(CONFIG_DIR, 'config.json');
const ENDPOINT_HEALTH_PATH = path.join(CONFIG_DIR, 'endpoint-health.json');
const ASSETS_CONFIG_DIR = path.resolve(__dirname, '../src/assets/config');
const ASSETS_CONFIG_JSON_PATH = path.join(ASSETS_CONFIG_DIR, 'config.json');
const ASSETS_ENDPOINT_HEALTH_PATH = path.join(ASSETS_CONFIG_DIR, 'endpoint-health.json');
// apps/web/proxy.conf.json — legacy static proxy config (ng serve here
// actually uses proxy.conf.mjs, but this file is kept in sync too so it
// never silently drifts if anything still references it).
const PROXY_CONF_JSON_PATH = path.join(__dirname, '..', 'proxy.conf.json');

/** Maps component/endpoint keys to the PORTS entry that drives their host:port. */
const KEY_TO_PORT = {
  communityApiUrl: PORTS.community,
  contentApiUrl: PORTS.content,
  contentIndexApiUrl: PORTS.contentIndex,
  qmsApiUrl: PORTS.qms,
  viewApiUrl: PORTS.view,
  viewServerUrl: PORTS.view,
  viewUpstreamOrigin: PORTS.view,
  agentstoreApiUrl: PORTS.agentstore,
  categoryApiUrl: PORTS.category,
  answerServerApiUrl: PORTS.answerserver,
};

/** Same mapping, keyed by proxy.conf.json's path prefixes instead of
 *  EndpointKey names — mirrors PROXY_TEST_URLS in proxy.conf.mjs. */
const PROXY_PATH_TO_PORT = {
  '/community': PORTS.community,
  '/content/Index': PORTS.contentIndex,
  '/content-index': PORTS.contentIndex,
  '/content': PORTS.content,
  '/qms': PORTS.qms,
  '/view': PORTS.view,
  '/action=': PORTS.view,
  '/Action=': PORTS.view,
  '/View_files': PORTS.view,
  '/viewtemp': PORTS.view,
  '/agentstore': PORTS.agentstore,
  '/category': PORTS.category,
  '/answerserver': PORTS.answerserver,
};

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  const next = JSON.stringify(data, null, 2) + '\n';
  try {
    const prev = readFileSync(filePath, 'utf8');
    if (prev === next) {
      return false;
    }
  } catch {
    /* file missing — write it */
  }
  writeFileSync(filePath, next, 'utf8');
  return true;
}

function updateConfigJson() {
  const config = loadJson(CONFIG_JSON_PATH);
  let changed = 0;

  for (const component of config.components ?? []) {
    if (component.kind === 'origin' && KEY_TO_PORT[component.key] !== undefined) {
      const next = targetFor(KEY_TO_PORT[component.key]);
      if (component.absoluteDefault !== next) {
        component.absoluteDefault = next;
        changed++;
      }
    }
  }

  writeJson(CONFIG_JSON_PATH, config);
  try {
    writeJson(ASSETS_CONFIG_JSON_PATH, config);
  } catch {
    /* assets dir may not exist yet */
  }
  return changed;
}

function updateEndpointHealth() {
  const health = loadJson(ENDPOINT_HEALTH_PATH);
  let changed = 0;

  if (health.defaults) {
    health.defaults.statusPath = STATUS_PATH;
  }

  for (const [key, entry] of Object.entries(health.endpoints ?? {})) {
    const portName = COMPONENT_KEY_TO_PORT_NAME[key];
    if (portName === undefined) continue; // e.g. gatewayOrigin has no fixed upstream
    // healthPortFor() honors a component's optional config.json `statusPort`
    // override (see upstream.config.mjs) — used when GetStatus needs to go
    // to a different port than the one everything else on that component
    // uses (e.g. Community's ACI port vs. its Service port).
    const port = healthPortFor(portName);
    const nextBase = targetFor(port);
    const nextUrl = testUrlFor(port);
    if (entry.testBase !== nextBase || entry.testUrl !== nextUrl) {
      entry.testBase = nextBase;
      entry.testUrl = nextUrl;
      changed++;
    }
  }

  writeJson(ENDPOINT_HEALTH_PATH, health);
  try {
    writeJson(ASSETS_ENDPOINT_HEALTH_PATH, health);
  } catch {
    /* assets dir may not exist yet; sync-config.sh copies next */
  }
  return changed;
}

/**
 * Updates proxy.conf.json's `target` for every path entry.
 *
 * There is intentionally no `testUrl` field here (removed — it was just
 * `target + test`, redundant with those two fields already present on
 * each entry). Anything that needs the full test URL computes it on the
 * fly as `entry.target + entry.test` instead of reading a stored copy
 * that could drift out of sync with `target`.
 */
function updateProxyConfigJson() {
  const proxyConf = loadJson(PROXY_CONF_JSON_PATH);
  let changed = 0;

  for (const [key, entry] of Object.entries(proxyConf)) {
    const port = PROXY_PATH_TO_PORT[key];
    if (port === undefined) continue;
    const nextTarget = targetFor(port);
    // Drop any leftover testUrl from before it was removed from the schema.
    if ('testUrl' in entry) {
      delete entry.testUrl;
      changed++;
    }
    if (entry.target !== nextTarget) {
      entry.target = nextTarget;
      changed++;
    }
  }

  if (changed > 0) {
    writeJson(PROXY_CONF_JSON_PATH, proxyConf);
  }
  return changed;
}

const configChanges = updateConfigJson();
const healthChanges = updateEndpointHealth();
const proxyJsonChanges = updateProxyConfigJson();

console.log(`generate-config: upstream host = ${UPSTREAM_HOST}`);
console.log(`generate-config: ports = ${JSON.stringify(PORTS)}`);
console.log(`generate-config: config.json — ${configChanges} field(s) updated`);
console.log(`generate-config: endpoint-health.json — ${healthChanges} field(s) updated (config/ + assets/)`);
console.log(`generate-config: proxy.conf.json — ${proxyJsonChanges} field(s) updated`);
