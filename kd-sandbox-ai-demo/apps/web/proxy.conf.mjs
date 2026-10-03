/**
 * Dev proxy for KD Enterprise Search (Vite / @angular/build).
 *
 * Every target below is built from ONE value: KD_UPSTREAM_HOST, via the
 * shared ./upstream.config.mjs module. This file is a real ES module,
 * evaluated fresh by Node each time `ng serve` starts — so it can read
 * process.env at startup, unlike proxy.conf.json which is static JSON
 * and can't reference env vars at all (that's the reason it never picks
 * up a new IP/FQDN — see upstream.config.mjs for the single source of
 * truth, also consumed by scripts/generate-config.mjs to keep
 * config/config.json and config/endpoint-health.json in sync).
 *
 * Usage:
 *   KD_UPSTREAM_HOST=10.0.0.5      npm start   # bare host, ports below apply
 *   KD_UPSTREAM_HOST=kd.internal  npm start   # FQDN works the same way
 * If unset, falls back to the previous hardcoded default so nothing
 * breaks for anyone who hasn't set the env var yet.
 *
 * Each entry includes:
 *   target  — upstream ACI host:port
 *   test    — path appended for Settings → Test button
 *   testUrl — full URL = target + test (executed on Test click via endpoint-health.json)
 *
 * Runtime proxy only uses target / rewrite / changeOrigin / secure.
 * `test` and `testUrl` are metadata mirrored in endpoint-health.json.
 */

import { PORTS, targetFor, testUrlFor } from './upstream.config.mjs';
import { PROBE_PORT, startProbeServer } from './scripts/probe-server.mjs';
import { ADMIN_PORT, startAdminServer } from './scripts/admin-server.mjs';
import { colorByStatus, red, gray } from './scripts/log-colors.mjs';
import { applyCorsToProxyRes, handlePreflight } from './scripts/cors-headers.mjs';

/**
 * `ng serve` / Vite loads this file even when the user did not go through
 * `npm start` (dev.mjs) or `serve.sh`. Those launchers start probe :4300
 * and admin :4301; plain `ng serve` does not — which is exactly the
 * ECONNREFUSED 127.0.0.1:4300 / :4301 flood in the terminal.
 * Start both here as save-only sidecars so Settings → Test / Save work
 * regardless of how the dev server was launched. EADDRINUSE is reused.
 */
let sidecarsStarted = false;
function ensureSidecarServers() {
  if (sidecarsStarted) return;
  sidecarsStarted = true;
  startProbeServer().then((server) => {
    if (!server) {
      console.log(gray(`[proxy] probe-server already listening on 127.0.0.1:${PROBE_PORT}`));
    } else {
      console.log(`[proxy] started probe-server on 127.0.0.1:${PROBE_PORT}`);
    }
  }).catch((err) => {
    console.error(red(`[proxy] failed to start probe-server: ${err.message || err}`));
  });
  startAdminServer({}).then((server) => {
    if (!server) {
      console.log(gray(`[proxy] admin-server already listening on 127.0.0.1:${ADMIN_PORT}`));
    } else {
      console.log(`[proxy] started admin-server on 127.0.0.1:${ADMIN_PORT} (save-only)`);
    }
  }).catch((err) => {
    console.error(red(`[proxy] failed to start admin-server: ${err.message || err}`));
  });
}
ensureSidecarServers();

/**
 * IMPORTANT — why '/__kd-probe' is a plain STATIC proxy to a local port,
 * and not a dynamic `router`-based entry (please read before changing this):
 *
 * Vite's dev proxy is handed straight to Vite's own vendored copy of the
 * `http-proxy` package, and that vendored copy does NOT implement the
 * `router` option at all (verified: grepping the whole installed
 * `vite/dist/node/chunks/*.js` for the string "router" returns zero
 * matches). Any `router: (req) => ...` you put here is silently ignored —
 * the proxy always dials the static `target` you configured, forever.
 * There is no supported way to pick a different upstream host per request
 * through Vite's built-in proxy layer. (Two earlier attempts at a dynamic
 * entry here — via query string, then via headers — both "worked" for
 * logging purposes because the log lines were computed independently, but
 * the actual TCP connection always dialed the static fallback target and
 * failed with ECONNREFUSED.)
 *
 * The fix: this entry proxies to scripts/probe-server.mjs, a tiny
 * standalone Node server that performs the *actual* dynamic-target request
 * itself with a plain `http`/`https` call (no such limitation there).
 * `/__kd-probe -> http://127.0.0.1:PROBE_PORT` is an ordinary static
 * target, which is the one thing Vite's proxy handles correctly.
 * EndpointHealthService still sends the real target/test as
 * X-KD-Probe-Target / X-KD-Probe-Test headers; probe-server.mjs reads
 * them and does the real request. Start it via `npm start` (see
 * scripts/dev.mjs), which launches probe-server.mjs alongside `ng serve`.
 */
function probeTarget() {
  return {
    target: `http://127.0.0.1:${PROBE_PORT}`,
    secure: false,
    changeOrigin: true,
    proxyTimeout: 10000,
    timeout: 10000,
    rewrite: (path) => path.replace(/^\/__kd-probe/, '') || '/',
    configure: (proxy) => {
      proxy.on('error', (err, req) => {
        console.error(
          red(
            `[proxy] ERROR ${req?.method} /__kd-probe → probe-server (127.0.0.1:${PROBE_PORT}): ${err.message}. ` +
              'Is the probe server running? It should start automatically with `npm start` — see scripts/dev.mjs.'
          )
        );
      });
    },
  };
}

/**
 * Static proxy entry for the Settings -> "Backend upstream host" textbox.
 * See scripts/admin-server.mjs for what this actually does (write
 * config.json, regenerate derived config, restart `ng serve`). Only
 * available when started via `npm start` (scripts/dev.mjs) — `serve.sh`
 * doesn't hold a handle on the ng child process to restart it, so this
 * proxy target has nothing listening on it in that flow and requests
 * will just fail with ECONNREFUSED, which the UI surfaces as an error.
 */
function adminTarget() {
  return {
    target: `http://127.0.0.1:${ADMIN_PORT}`,
    secure: false,
    changeOrigin: true,
    proxyTimeout: 10000,
    timeout: 10000,
    rewrite: (path) => path.replace(/^\/__kd-admin/, '') || '/',
    configure: (proxy) => {
      proxy.on('error', (err, req) => {
        console.error(
          red(
            `[proxy] ERROR ${req?.method} /__kd-admin → admin-server (127.0.0.1:${ADMIN_PORT}): ${err.message}. ` +
              'Restart-via-UI is only available when started with `npm start` — see scripts/dev.mjs.'
          )
        );
      });
    },
  };
}

function withLog(opts) {
  const { test, testUrl, ...proxyOpts } = opts;
  return {
    // RAG / Converse often exceeds 20s; Angular converse timeout is 180s.
    proxyTimeout: 180000,
    timeout: 180000,
    ...proxyOpts,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        console.log(`[proxy] ${req.method} ${req.url}  →  ${proxyOpts.target}${proxyReq.path}`);
      });
      proxy.on('proxyRes', (proxyRes, req) => {
        applyCorsToProxyRes(proxyRes, req);
        console.log(
          colorByStatus(
            proxyRes.statusCode,
            `[proxy] ${req.method} ${req.url}  ←  ${proxyRes.statusCode}`
          )
        );
      });
      proxy.on('error', (err, req) => {
        const hint =
          err?.message === 'socket hang up'
            ? ' (HTTP client vs TLS ACI will hang up — use KD_UPSTREAM_PROTOCOL=https and the IDOL host, then restart)'
            : /certificate|UNABLE_TO_VERIFY|self signed/i.test(err?.message || '')
              ? ' (IDOL cert not trusted — proxy already uses secure:false; do not call :12000 from the browser)'
              : '';
        console.error(
          red(`[proxy] ERROR ${req?.method} ${req?.url} → ${proxyOpts.target}: ${err.message}${hint}`)
        );
      });
    },
    // Answer OPTIONS here — IDOL ACI does not implement CORS preflight.
    bypass(req, res) {
      if (handlePreflight(req, res)) return false;
    },
  };
}

const viewTarget = withLog({
  target: targetFor(PORTS.view),
  secure: false,
  changeOrigin: true,
  test: '/action=getstatus',
  testUrl: testUrlFor(PORTS.view),
});

/** @type {Record<string, import('vite').ProxyOptions>} */
export default {
  '/__kd-probe': probeTarget(),
  '/__kd-admin': adminTarget(),
  '/nifi-ai': {
    target: process.env.NIFI_AI_UI_URL || 'http://127.0.0.1:27120',
    secure: false,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/nifi-ai/, '') || '/',
    proxyTimeout: 180000,
    timeout: 180000,
  },
  '/api/admin': {
    target: `http://127.0.0.1:${process.env.ADMIN_CONFIG_PORT || 4201}`,
    secure: false,
    changeOrigin: true,
    proxyTimeout: 15000,
    timeout: 15000,
    configure: (proxy) => {
      proxy.on('proxyReq', (_proxyReq, req) => {
        const m = (req.url || '').match(/nifi-ai\/(clear-all|mcp)/);
        if (m) {
          console.info(
            `[proxy] calling nifi-ai/${m[1]} ${req.method} ${req.url}`
          );
        }
      });
    }
  },
  '/api/nifi-ai': {
    target: `http://127.0.0.1:${process.env.ADMIN_CONFIG_PORT || 4201}`,
    secure: false,
    changeOrigin: true,
    proxyTimeout: 15000,
    timeout: 15000,
    configure: (proxy) => {
      proxy.on('proxyReq', (_proxyReq, req) => {
        console.info(`[proxy] calling nifi-ai ${req.method} ${req.url}`);
      });
    }
  },
  '/community': withLog({
    target: targetFor(PORTS.community),
    secure: false,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/community/, '') || '/',
    test: '/action=getstatus',
    testUrl: testUrlFor(PORTS.community),
  }),
  // Must be registered before '/content' so /content/Index/* is not
  // swallowed by the ACI proxy and forwarded to :9100 as /Index/….
  // DRECREATEDBASE lives on the index port (9101) at /DRECREATEDBASE.
  '/content/Index': withLog({
    target: targetFor(PORTS.contentIndex),
    secure: false,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/content\/Index/i, '') || '/',
    test: '/DRESTATUS',
    testUrl: `${targetFor(PORTS.contentIndex)}/DRESTATUS`,
  }),
  '/content-index': withLog({
    target: targetFor(PORTS.contentIndex),
    secure: false,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/content-index/i, '') || '/',
    test: '/DRESTATUS',
    testUrl: `${targetFor(PORTS.contentIndex)}/DRESTATUS`,
  }),
  '/content': withLog({
    target: targetFor(PORTS.content),
    secure: false,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/content/, '') || '/',
    test: '/action=getstatus',
    testUrl: testUrlFor(PORTS.content),
  }),
  '/qms': withLog({
    target: targetFor(PORTS.qms),
    secure: false,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/qms/, '') || '/',
    test: '/action=getstatus',
    testUrl: testUrlFor(PORTS.qms),
  }),
  '/view': {
    ...viewTarget,
    rewrite: (p) => p.replace(/^\/view/, '') || '/',
  },
  '^/action=': viewTarget,
  '^/Action=': viewTarget,
  '/View_files': viewTarget,
  '/viewtemp': viewTarget,
  '/agentstore': withLog({
    target: targetFor(PORTS.agentstore),
    secure: false,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/agentstore/, '') || '/',
    test: '/action=getstatus',
    testUrl: testUrlFor(PORTS.agentstore),
  }),
  '/category': withLog({
    target: targetFor(PORTS.category),
    secure: false,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/category/, '') || '/',
    test: '/action=getstatus',
    testUrl: testUrlFor(PORTS.category),
  }),
  '/answerserver': withLog({
    target: targetFor(PORTS.answerserver),
    secure: false,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/answerserver/, '') || '/',
    test: '/action=getstatus',
    testUrl: testUrlFor(PORTS.answerserver),
  }),
};

/**
 * Lookup table: proxy path prefix → full GetStatus URL.
 * Kept in sync with endpoint-health.json testBase + statusPath.
 * Derived from the same UPSTREAM_HOST as the proxy targets above,
 * so this can never drift from what's actually being proxied to.
 */
export const PROXY_TEST_URLS = {
  '/community': testUrlFor(PORTS.community),
  '/content/Index': `${targetFor(PORTS.contentIndex)}/DRESTATUS`,
  '/content-index': `${targetFor(PORTS.contentIndex)}/DRESTATUS`,
  '/content': testUrlFor(PORTS.content),
  '/qms': testUrlFor(PORTS.qms),
  '/view': testUrlFor(PORTS.view),
  '/action=': testUrlFor(PORTS.view),
  '/Action=': testUrlFor(PORTS.view),
  '/View_files': testUrlFor(PORTS.view),
  '/viewtemp': testUrlFor(PORTS.view),
  '/agentstore': testUrlFor(PORTS.agentstore),
  '/category': testUrlFor(PORTS.category),
  '/answerserver': testUrlFor(PORTS.answerserver),
};
