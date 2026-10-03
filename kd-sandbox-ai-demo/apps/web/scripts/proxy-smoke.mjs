/**
 * Offline-friendly smoke test that proves the Community ACI host responds
 * and prints the exact log lines you should see from the Angular/Vite proxy
 * when Settings → Community → Test is pressed (with the fixed health service).
 *
 * Run from apps/web:
 *   node scripts/proxy-smoke.mjs
 *
 * This does NOT start Angular — it only hits the upstream the same way the
 * proxy will, and writes a sample log file you can compare against.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'proxy-smoke.log');

const TARGET_HOST = process.env.KD_UPSTREAM_HOST || '127.0.0.1';
const TARGET_PORT = 9030;
const ACI_PATH = '/action=getstatus';
// What the browser should request (same-origin) when Test is pressed:
const BROWSER_PATH = '/community/action=getstatus';

function stamp() {
  return new Date().toISOString();
}

function logLine(msg) {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  return line + '\n';
}

let buf = '';
buf += logLine('=== KD proxy smoke test ===');
buf += logLine(`Browser Test button should request (same-origin):  ${BROWSER_PATH}`);
buf += logLine(`Proxy rewrites that to upstream:                   http://${TARGET_HOST}:${TARGET_PORT}${ACI_PATH}`);
buf += logLine('---');
buf += logLine('WHERE TO FIND REAL PROXY LOGS:');
buf += logLine('  → The TERMINAL where you ran `npm start` / `ng serve`');
buf += logLine('  → NOT the browser DevTools console');
buf += logLine('  → Browser Network tab will show only:  GET /community/action=getstatus  (status 200)');
buf += logLine('---');
buf += logLine('Calling upstream directly (same as proxy target after rewrite)...');

const started = Date.now();
const req = http.request(
  {
    host: TARGET_HOST,
    port: TARGET_PORT,
    path: ACI_PATH,
    method: 'GET',
    timeout: 8000,
    headers: { Accept: '*/*', 'User-Agent': 'kd-proxy-smoke/1.0' }
  },
  (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      const ms = Date.now() - started;
      buf += logLine(`[HPM] GET ${BROWSER_PATH} -> http://${TARGET_HOST}:${TARGET_PORT}${ACI_PATH} [${res.statusCode}] (${ms}ms)`);
      buf += logLine(`Upstream HTTP status: ${res.statusCode}`);
      buf += logLine(`Upstream body (first 240 chars): ${body.replace(/\s+/g, ' ').slice(0, 240)}`);
      const ok = res.statusCode === 200 && /SUCCESS/i.test(body);
      if (ok) {
        buf += logLine('RESULT: OK — Community GetStatus returned SUCCESS.');
        buf += logLine('If UI Test still fails, the request is NOT reaching this upstream via the proxy.');
        buf += logLine('Checklist:');
        buf += logLine('  1. Restart: stop ng serve, then `npm start` (must load proxy.conf.mjs).');
        buf += logLine('  2. Confirm angular.json serve.options.proxyConfig = "proxy.conf.mjs".');
        buf += logLine('  3. To point at a different host, set KD_UPSTREAM_HOST before starting.');
        buf += logLine('  4. Leave "Base host" empty so composeUrl stays relative.');
        buf += logLine('  5. Hard refresh browser after code change.');
      } else {
        buf += logLine(`RESULT: FAIL — unexpected status/body (code=${res.statusCode}).`);
      }
      buf += logLine(`Log file written to: ${OUT}`);
      fs.writeFileSync(OUT, buf, 'utf8');
      process.exit(ok ? 0 : 1);
    });
  }
);

req.on('timeout', () => {
  buf += logLine('RESULT: FAIL — timeout contacting upstream (8s).');
  buf += logLine(`Log file written to: ${OUT}`);
  fs.writeFileSync(OUT, buf, 'utf8');
  req.destroy();
  process.exit(1);
});

req.on('error', (err) => {
  buf += logLine(`RESULT: FAIL — ${err.message}`);
  buf += logLine(`Network/firewall cannot reach ${TARGET_HOST}:${TARGET_PORT} from this machine.`);
  buf += logLine(`Log file written to: ${OUT}`);
  fs.writeFileSync(OUT, buf, 'utf8');
  process.exit(1);
});

req.end();
