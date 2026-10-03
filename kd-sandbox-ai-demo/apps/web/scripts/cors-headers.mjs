/**
 * CORS headers applied by the dev proxy, probe-server, and admin-server.
 * IDOL ACI itself does not send Access-Control-* headers; put these on
 * whatever sits in front of it (Vite proxy / Nginx), not on :9100 directly.
 */
export const CORS_ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD';
export const CORS_ALLOW_HEADERS =
  'Content-Type, Authorization, Accept, X-KD-Probe-Target, X-KD-Probe-Test, X-Requested-With';

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    // Same-host pages only. Never reflect arbitrary browser Origin.
    return false;
  } catch {
    return false;
  }
}

export function corsHeaderObject(req) {
  const origin = req?.headers?.origin;
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    'Access-Control-Max-Age': '600',
    'Access-Control-Expose-Headers':
      'Content-Type, Content-Length, Location, X-KD-Probe-Final-Url, X-KD-Probe-Redirect-Count'
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export function applyCorsToProxyRes(proxyRes, req) {
  const extra = corsHeaderObject(req);
  for (const [key, value] of Object.entries(extra)) {
    proxyRes.headers[key.toLowerCase()] = value;
  }
}

export function writeCors(res, req, extra = {}) {
  const headers = { ...corsHeaderObject(req), ...extra };
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

export function handlePreflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  writeCors(res, req);
  res.writeHead(204);
  res.end();
  return true;
}
