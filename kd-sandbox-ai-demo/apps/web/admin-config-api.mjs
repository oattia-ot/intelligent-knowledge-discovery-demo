#!/usr/bin/env node
/**
 * Narrow admin-config writer for KD Enterprise Search.
 *
 * Verifies the caller belongs to Community role KDUIAdmin
 * (RoleUserGetRoleList), then writes TAX_GOV_AE/config/*.json and copies
 * into Angular assets (and the live nginx dest when present).
 *
 * This is not a general BFF — search still goes Nginx → ACI.
 *
 * Usage:
 *   ADMIN_CONFIG_PORT=4201 node admin-config-api.mjs
 * Env:
 *   CONFIG_DIR, ASSETS_CONFIG_DIR, DEPLOYED_CONFIG_DIR
 *   COMMUNITY_ORIGIN (default https://community.idoldemos.net:9030)
 *   ADMIN_ROLE (default KDUIAdmin)
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = __dirname;
const ROOT_DIR = path.resolve(WEB_DIR, '../..');

const PORT = Number(process.env.ADMIN_CONFIG_PORT || 4201);
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(ROOT_DIR, 'config');
const ASSETS_CONFIG_DIR =
  process.env.ASSETS_CONFIG_DIR ||
  path.join(WEB_DIR, 'src/assets/config');
const DEPLOYED_CONFIG_DIR =
  process.env.DEPLOYED_CONFIG_DIR ||
  '/home/vinay/projects/ssl_nifi/nginx/root/Demos/KD/assets/config';
const COMMUNITY_ORIGIN = (
  process.env.COMMUNITY_ORIGIN || 'https://community.idoldemos.net:9030'
).replace(/\/+$/, '');
const ADMIN_ROLE = (process.env.ADMIN_ROLE || 'KDUIAdmin').trim();
const MAX_BODY = 64 * 1024;

const ALLOWED = new Set(['document-viewer']);

function send(res, status, body, extraHeaders = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-KD-Nifi-Method',
    ...extraHeaders
  });
  res.end(json);
}

const NIFI_ORCHESTRATOR =
  process.env.NIFI_AI_ORCHESTRATOR_URL ||
  process.env.NIFI_ORCHESTRATOR_URL ||
  'http://127.0.0.1:27110';
const NIFI_UI =
  process.env.NIFI_AI_UI_URL ||
  process.env.NIFI_UI_URL ||
  'http://127.0.0.1:27120';

function forwardClearAll(targetBase, payload) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL('/api/nifi-ai/clear-all', targetBase);
    } catch (err) {
      resolve({ target: String(targetBase), error: err.message || String(err) });
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-KD-Nifi-Method': 'clearAllObjects'
        },
        timeout: 4000
      },
      (proxied) => {
        proxied.resume();
        resolve({
          target: url.href,
          status: proxied.statusCode || 0
        });
      }
    );
    req.on('error', (err) =>
      resolve({ target: url.href, error: err.message || String(err) })
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ target: url.href, error: 'timeout' });
    });
    req.end(body);
  });
}

async function handleNifiClearAll(req, res) {
  if (req.method === 'OPTIONS') {
    send(res, 204, { ok: true });
    return;
  }
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    send(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const method =
    String(
      payload.method || req.headers['x-kd-nifi-method'] || 'clearAllObjects'
    ).trim() || 'clearAllObjects';
  const objects = Array.isArray(payload.objects) ? payload.objects : [];
  const kinds = Array.isArray(payload.kinds)
    ? payload.kinds
    : ['action', 'skill', 'template'];
  const count = Number(payload.count) || objects.length || 0;

  console.info(
    `[KD][NiFi AI] calling method=${method} action=clear-all kinds=${kinds.join(',')} count=${count}`
  );
  if (objects.length) {
    const names = objects
      .slice(0, 40)
      .map((item) => `${item?.kind || '?'}:${item?.name || '?'}`)
      .join(', ');
    console.info(`[KD][NiFi AI] ${method} objects=${names}`);
  }

  const forwards = await Promise.all([
    forwardClearAll(NIFI_ORCHESTRATOR, {
      ...payload,
      method,
      action: 'clear-all',
      kinds,
      count
    }),
    forwardClearAll(NIFI_UI, {
      ...payload,
      method,
      action: 'clear-all',
      kinds,
      count
    })
  ]);
  forwards.forEach((result) => {
    if (result.status) {
      console.info(
        `[KD][NiFi AI] forwarded ${method} → ${result.target} status=${result.status}`
      );
    } else {
      console.info(
        `[KD][NiFi AI] forwarded ${method} → ${result.target || result.error} error=${result.error || 'unknown'}`
      );
    }
  });

  send(res, 200, {
    ok: true,
    method,
    action: 'clear-all',
    kinds,
    count,
    forwarded: forwards
  });
}

const NIFI_MCP_URL =
  process.env.NIFI_AI_MCP_URL || `${NIFI_ORCHESTRATOR.replace(/\/+$/, '')}/mcp`;
const MCP_METHODS = new Set([
  'runObject',
  'refreshObjects',
  'listObjects',
  'addObject',
  'deleteObject',
  'clearAllObjects'
]);
let mcpRequestId = 0;

/** One raw HTTP POST. Resolves { status, headers, body } or { error }. Never rejects. */
function rawPost(url, payload, extraHeaders = {}) {
  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          ...extraHeaders
        },
        timeout: 8000
      },
      (proxied) => {
        const chunks = [];
        let size = 0;
        proxied.on('data', (c) => {
          if (size < 65536) {
            chunks.push(c);
            size += c.length;
          }
        });
        proxied.on('end', () =>
          resolve({
            status: proxied.statusCode || 0,
            headers: proxied.headers || {},
            body: Buffer.concat(chunks).toString('utf8')
          })
        );
      }
    );
    req.on('error', (err) => resolve({ error: err.message || String(err) }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'timeout' });
    });
    req.end(body);
  });
}

/** Parse a JSON or text/event-stream MCP response body into a JSON-RPC message. */
function parseMcpBody(text) {
  const t = (text || '').trim();
  if (!t) {
    return null;
  }
  try {
    return JSON.parse(t);
  } catch {
    /* maybe SSE */
  }
  const datas = t
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  for (let i = datas.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(datas[i]);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Call an MCP tool over Streamable HTTP. A compliant server requires an
 * `initialize` handshake (and echoes an Mcp-Session-Id) before `tools/call`;
 * without it the server answers 4xx and the tool never runs. Resolves
 * { target, status, ok, error?, detail?, sessionId? }. Never rejects.
 */
async function postMcp(rpc) {
  let url;
  try {
    url = new URL(NIFI_MCP_URL);
  } catch (err) {
    return { target: NIFI_MCP_URL, ok: false, error: err.message || String(err) };
  }
  const base = { 'X-KD-Nifi-Method': rpc.params?.name || '' };
  let sessionHeaders = {};
  let sessionId = '';

  const init = await rawPost(
    url,
    {
      jsonrpc: '2.0',
      id: `init-${rpc.id}`,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'kd-sandbox-ai-demo', version: '1.0' }
      }
    },
    base
  );
  if (init.error) {
    return { target: url.href, ok: false, error: `initialize: ${init.error}` };
  }
  if (init.status >= 200 && init.status < 300) {
    sessionId = String(init.headers['mcp-session-id'] || '');
    if (sessionId) {
      sessionHeaders = { 'Mcp-Session-Id': sessionId };
    }
    await rawPost(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, {
      ...base,
      ...sessionHeaders
    });
  }
  // If initialize was refused (stateless server) we still try tools/call.

  const res = await rawPost(url, rpc, { ...base, ...sessionHeaders });
  if (res.error) {
    return { target: url.href, ok: false, sessionId, error: res.error };
  }
  const msg = parseMcpBody(res.body);
  const rpcError = msg?.error ? msg.error.message || JSON.stringify(msg.error) : '';
  const toolError = msg?.result?.isError
    ? String(msg.result.content?.[0]?.text || 'tool reported isError')
    : '';
  const httpOk = res.status >= 200 && res.status < 300;
  const ok = httpOk && !rpcError && !toolError;
  return {
    target: url.href,
    status: res.status,
    ok,
    sessionId,
    error: rpcError || toolError || (httpOk ? '' : `HTTP ${res.status}`),
    detail: (res.body || '').slice(0, 500)
  };
}

/**
 * POST /api/admin/nifi-ai/mcp
 * Body: { method: 'runObject' | 'refreshObjects', kind?, name?, prompt?, ... }
 * Logged as an MCP tools/call and forwarded to the NiFi AI MCP endpoint.
 */
async function handleNifiMcp(req, res) {
  if (req.method === 'OPTIONS') {
    send(res, 204, { ok: true });
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }
  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    send(res, 400, { ok: false, error: 'Body must be JSON.' });
    return;
  }
  const method = String(
    payload.method || req.headers['x-kd-nifi-method'] || ''
  ).trim();
  if (!MCP_METHODS.has(method)) {
    send(res, 400, { ok: false, error: `Unknown MCP method: ${method || '(none)'}` });
    return;
  }
  const { method: _m, ...args } = payload;
  const id = ++mcpRequestId;
  const rpc = {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: method, arguments: args }
  };
  const label = args.name
    ? `${args.kind || '?'}:${args.name}`
    : `kinds=${(args.kinds || []).join(',')} count=${args.count ?? '?'}`;
  console.info(
    `[KD][NiFi AI] mcp request id=${id} tools/call name=${method} ${label}`
  );
  const result = await postMcp(rpc);
  if (result.ok) {
    console.info(
      `[KD][NiFi AI] mcp response id=${id} name=${method} → ${result.target} status=${result.status} ok`
    );
  } else {
    console.warn(
      `[KD][NiFi AI] mcp response id=${id} name=${method} → ${result.target} FAILED status=${result.status ?? '-'} error=${result.error || 'unknown'} body=${(result.detail || '').replace(/\s+/g, ' ')}`
    );
  }
  // 200 only when the orchestrator really accepted the call; otherwise 502 so
  // the failure is visible in the request log instead of a misleading "ok".
  send(res, result.ok ? 200 : 502, {
    ok: !!result.ok,
    id,
    method,
    error: result.ok ? undefined : result.error,
    forwarded: result
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function communityGet(params) {
  const url = new URL(COMMUNITY_ORIGIN + '/');
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { rejectUnauthorized: false, timeout: 15000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8')
          })
        );
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Community role check timed out.'));
    });
    req.on('error', reject);
  });
}

function parseRoleNames(xmlText) {
  const text = (xmlText || '').trim();
  if (!text || /<html/i.test(text)) {
    return [];
  }
  if (!/<response>\s*SUCCESS\s*<\/response>/i.test(text)) {
    return [];
  }
  const names = new Set();
  const re =
    /<(?:autn:)?(?:rolename|role|name)\b[^>]*>([^<]+)<\/(?:autn:)?(?:rolename|role|name)>/gi;
  let match;
  while ((match = re.exec(text))) {
    const value = match[1].trim();
    if (value) {
      names.add(value);
    }
  }
  return [...names];
}

function hasRole(roles, roleName) {
  const wanted = roleName.toLowerCase();
  return roles.some((role) => role.trim().toLowerCase() === wanted);
}

async function assertAdmin(req) {
  const username = String(req.headers['x-community-username'] || '').trim();
  const token = String(req.headers['x-community-securityinfo'] || '').trim();
  if (!username) {
    const err = new Error('Missing X-Community-Username.');
    err.status = 401;
    throw err;
  }
  if (!token) {
    const err = new Error(
      'Missing SecurityInfo. Sign in with Community to save admin settings.'
    );
    err.status = 401;
    throw err;
  }

  const { body } = await communityGet({
    action: 'RoleUserGetRoleList',
    UserName: username,
    SecurityInfo: token
  });
  const roles = parseRoleNames(body);
  if (!hasRole(roles, ADMIN_ROLE)) {
    const err = new Error(
      `You must belong to the ${ADMIN_ROLE} Community role to change admin settings.`
    );
    err.status = 403;
    throw err;
  }
  return { username, roles };
}

function validateDocumentViewer(payload) {
  const viewer = payload?.documentViewer;
  if (!viewer || (viewer.mode !== 'universal' && viewer.mode !== 'redaction')) {
    throw Object.assign(
      new Error('documentViewer.mode must be universal or redaction.'),
      { status: 400 }
    );
  }
  const universalApiUrl = String(viewer.universalApiUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const redactionApiUrl = String(viewer.redactionApiUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!universalApiUrl) {
    throw Object.assign(new Error('documentViewer.universalApiUrl is required.'), {
      status: 400
    });
  }
  if (!redactionApiUrl) {
    throw Object.assign(new Error('documentViewer.redactionApiUrl is required.'), {
      status: 400
    });
  }
  if (typeof viewer.snippetRedactionEnabled !== 'boolean') {
    throw Object.assign(
      new Error('documentViewer.snippetRedactionEnabled must be true or false.'),
      { status: 400 }
    );
  }
  const comment =
    typeof payload.$schema_comment === 'string' && payload.$schema_comment.trim()
      ? payload.$schema_comment.trim()
      : 'Document preview provider. Set mode to universal or redaction.';
  return {
    $schema_comment: comment,
    documentViewer: {
      mode: viewer.mode,
      universalApiUrl,
      redactionApiUrl,
      snippetRedactionEnabled: viewer.snippetRedactionEnabled
    }
  };
}

function fileFor(name) {
  return path.join(CONFIG_DIR, `${name}.json`);
}

function readConfig(name) {
  const file = fileFor(name);
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error(`Config file not found: ${name}.json`), {
      status: 404
    });
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function atomicWrite(file, json) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function writeConfig(name, json) {
  const targets = [fileFor(name), path.join(ASSETS_CONFIG_DIR, `${name}.json`)];
  if (DEPLOYED_CONFIG_DIR && fs.existsSync(DEPLOYED_CONFIG_DIR)) {
    targets.push(path.join(DEPLOYED_CONFIG_DIR, `${name}.json`));
  }
  const written = [];
  for (const target of targets) {
    atomicWrite(target, json);
    written.push(target);
  }
  return written;
}

function parsePath(url) {
  const u = new URL(url, 'http://127.0.0.1');
  return u.pathname.replace(/\/+$/, '') || '/';
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = parsePath(req.url || '/');
    if (req.method === 'GET' && pathname === '/api/admin/health') {
      send(res, 200, { ok: true, role: ADMIN_ROLE });
      return;
    }

    if (
      pathname === '/api/admin/nifi-ai/mcp' ||
      pathname === '/api/nifi-ai/mcp'
    ) {
      await handleNifiMcp(req, res);
      return;
    }

    if (
      pathname === '/api/admin/nifi-ai/clear-all' ||
      pathname === '/api/nifi-ai/clear-all'
    ) {
      await handleNifiClearAll(req, res);
      return;
    }

    const configMatch = pathname.match(/^\/api\/admin\/config\/([^/]+)$/);
    if (!configMatch) {
      send(res, 404, { ok: false, error: 'Not found.' });
      return;
    }
    const name = configMatch[1];
    if (!ALLOWED.has(name)) {
      send(res, 404, { ok: false, error: `Unknown config file: ${name}` });
      return;
    }

    await assertAdmin(req);

    if (req.method === 'GET') {
      const config = readConfig(name);
      send(res, 200, { ok: true, config });
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        send(res, 400, { ok: false, error: 'Body must be JSON.' });
        return;
      }
      const config =
        name === 'document-viewer' ? validateDocumentViewer(payload) : payload;
      const written = writeConfig(name, config);
      console.info('[admin-config] saved', {
        name,
        files: written.length,
        role: ADMIN_ROLE
      });
      send(res, 200, { ok: true, config, files: written.length });
      return;
    }

    send(res, 405, { ok: false, error: 'Method not allowed.' });
  } catch (err) {
    const status = Number(err.status) || 500;
    send(res, status, { ok: false, error: err.message || 'Admin config failed.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `admin-config-api listening on http://127.0.0.1:${PORT}  (role ${ADMIN_ROLE})`
  );
});
