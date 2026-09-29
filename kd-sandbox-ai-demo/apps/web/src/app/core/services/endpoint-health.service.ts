import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { EndpointKey } from './app-settings.service';

export type VerifyState = 'idle' | 'checking' | 'ok' | 'error' | 'skipped';

export interface VerifyResult {
  state: VerifyState;
  status?: number;
  message?: string;
  url?: string;
}

export interface HealthLogEntry {
  ts: string;
  level: 'info' | 'ok' | 'error' | 'warn';
  message: string;
}

interface EndpointHealthEntry {
  label?: string;
  statusPath?: string;
  /** Absolute IDOL host (= proxy "target"), e.g. http://127.0.0.1:9030 */
  testBase?: string;
  /** Full probe URL if provided (= target + test) */
  testUrl?: string;
  optional?: boolean;
}

interface HealthFile {
  defaults?: { statusPath?: string; timeoutMs?: number };
  endpoints?: Record<string, EndpointHealthEntry>;
}

export const HEALTH_TIMEOUT_STORAGE_KEY = 'kd-endpoint-health-timeout-ms';
export const HEALTH_TIMEOUT_MIN_MS = 1000;
export const HEALTH_TIMEOUT_MAX_MS = 60000;
export const HEALTH_TIMEOUT_DEFAULT_MS = 3000;

/** Filename loaded for health-check defaults. */
export const HEALTH_CONFIG_FILE = 'endpoint-health.json';
export const HEALTH_CONFIG_ASSET_PATH = 'assets/config/endpoint-health.json';

/**
 * Probes IDOL GetStatus using endpoint-health.json.
 *
 * Test button builds the exact upstream URL from the current runtime UI host/FQDN
 * plus the configured service port and status path. The browser sends the probe
 * through /__kd-probe so the Angular dev proxy performs the upstream request.
 */
@Injectable({ providedIn: 'root' })
export class EndpointHealthService {
  private readonly http = inject(HttpClient);
  private readonly _config = signal<HealthFile | null>(null);
  private loadPromise: Promise<void> | null = null;

  readonly configLoaded = signal(false);
  /** Browser override for GetStatus / preflight timeout. null = file default. */
  private readonly _timeoutOverrideMs = signal<number | null>(null);

  /** In-memory log shown in Settings and downloadable as a file. */
  private readonly _log = signal<HealthLogEntry[]>([]);
  readonly log = this._log.asReadonly();

  constructor() {
    this.readTimeoutOverride();
    void this.ensureLoaded();
  }

  clearLog(): void {
    this._log.set([]);
  }

  /** Clear verification state from the in-memory log for one endpoint only. */
  clearEndpointLog(key: EndpointKey | string): void {
    const prefix = `${key}:`;
    this._log.update((rows) => rows.filter((row) => !row.message.startsWith(prefix)));
  }

  /** Public wrapper so Settings can record import / process messages. */
  appendLog(level: HealthLogEntry['level'], message: string): void {
    this.pushLog(level, message);
  }

  private pushLog(level: HealthLogEntry['level'], message: string): void {
    const entry: HealthLogEntry = {
      ts: new Date().toISOString(),
      level,
      message
    };
    this._log.update((rows) => [...rows.slice(-200), entry]);
    const line = `[${entry.ts}] [${level}] ${message}`;
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  /** Download the current log buffer as a .log file (browser filesystem). */
  downloadLog(filename = 'endpoint-health.log'): void {
    const rows = this._log();
    const body =
      rows.length === 0
        ? `# endpoint-health log — empty — ${new Date().toISOString()}\n`
        : rows.map((r) => `[${r.ts}] [${r.level}] ${r.message}`).join('\n') + '\n';
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    this.pushLog('info', `Log downloaded as ${filename} (${rows.length} lines)`);
  }

  async ensureLoaded(): Promise<void> {
    if (this._config()) {
      this.configLoaded.set(true);
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = firstValueFrom(
        this.http.get<HealthFile>('assets/config/endpoint-health.json')
      )
        .then((cfg) => {
          this._config.set(cfg ?? {});
          this.pushLog('info', 'Loaded endpoint-health.json');
        })
        .catch((err) => {
          this._config.set({
            defaults: { statusPath: '/action=getstatus', timeoutMs: HEALTH_TIMEOUT_DEFAULT_MS },
            endpoints: {}
          });
          this.pushLog(
            'warn',
            `endpoint-health.json missing — using defaults (${String(err?.message || err)})`
          );
        })
        .finally(() => this.configLoaded.set(true));
    }
    await this.loadPromise;
  }

  statusPathFor(key: EndpointKey | string): string {
    const cfg = this._config();
    const fromKey = cfg?.endpoints?.[key]?.statusPath;
    const fallback = cfg?.defaults?.statusPath || '/action=getstatus';
    return (fromKey || fallback).trim() || '/action=getstatus';
  }

  testBaseFor(key: EndpointKey | string): string | null {
    const b = this._config()?.endpoints?.[key]?.testBase?.trim();
    return b || null;
  }

  testUrlFor(key: EndpointKey | string): string | null {
    const u = this._config()?.endpoints?.[key]?.testUrl?.trim();
    return u || null;
  }

  isOptional(key: EndpointKey | string): boolean {
    return !!this._config()?.endpoints?.[key]?.optional;
  }

  /**
   * Patch the in-memory probe target for one endpoint so Test / preflight
   * use the port the user just saved, without waiting for a file reload.
   */
  patchEndpointPort(key: EndpointKey | string, port: string): void {
    const p = String(port || '').trim();
    if (!/^\d{1,5}$/.test(p)) {
      return;
    }
    const n = Number(p);
    if (n < 1 || n > 65535) {
      return;
    }
    const cfg = this._config();
    if (!cfg?.endpoints?.[String(key)]) {
      return;
    }
    const rewrite = (url?: string | null): string | undefined => {
      const raw = (url ?? '').trim();
      if (!raw) {
        return raw || undefined;
      }
      try {
        const u = new URL(raw);
        u.port = p;
        return u.toString().replace(/\/$/, '');
      } catch {
        return raw.replace(/:\d+(?=\/|$)/, `:${p}`);
      }
    };
    const current = cfg.endpoints[String(key)];
    const next = {
      ...current,
      testBase: rewrite(current.testBase) ?? current.testBase,
      testUrl: rewrite(current.testUrl) ?? current.testUrl
    };
    this._config.set({
      ...cfg,
      endpoints: { ...cfg.endpoints, [String(key)]: next }
    });
    this.pushLog(
      'info',
      `Processing endpoint ${current.label || key} (${key}): port set to ${p}`
    );
  }

  fileTimeoutMs(): number {
    return this.clampTimeoutMs(this._config()?.defaults?.timeoutMs ?? HEALTH_TIMEOUT_DEFAULT_MS);
  }

  configFileName(): string {
    return HEALTH_CONFIG_FILE;
  }

  configAssetPath(): string {
    return HEALTH_CONFIG_ASSET_PATH;
  }

  /** Pretty-printed contents of the loaded endpoint-health.json for preview. */
  rawConfigJson(): string {
    const cfg = this._config();
    if (!cfg) {
      return '';
    }
    try {
      return JSON.stringify(cfg, null, 2);
    } catch {
      return '';
    }
  }

  /**
   * Effective GetStatus timeout used by Settings → Test and login preflight.
   * A value saved in Settings (localStorage) wins over endpoint-health.json.
   */
  timeoutMs(): number {
    const override = this._timeoutOverrideMs();
    if (override != null) {
      return override;
    }
    return this.fileTimeoutMs();
  }

  readonly timeoutMsSignal = computed(() => {
    const override = this._timeoutOverrideMs();
    return override != null ? override : this.fileTimeoutMs();
  });

  setTimeoutMs(ms: number): number {
    const value = this.clampTimeoutMs(ms);
    this._timeoutOverrideMs.set(value);
    try {
      localStorage.setItem(HEALTH_TIMEOUT_STORAGE_KEY, String(value));
    } catch {
      /* private mode / quota */
    }
    this.pushLog('info', `Health check timeout set to ${value}ms`);
    return value;
  }

  clearTimeoutOverride(): void {
    this._timeoutOverrideMs.set(null);
    try {
      localStorage.removeItem(HEALTH_TIMEOUT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.pushLog('info', `Health check timeout reset to ${this.configFileName()} default (${this.fileTimeoutMs()}ms)`);
  }

  private clampTimeoutMs(ms: number): number {
    if (!Number.isFinite(ms)) {
      return HEALTH_TIMEOUT_DEFAULT_MS;
    }
    return Math.min(HEALTH_TIMEOUT_MAX_MS, Math.max(HEALTH_TIMEOUT_MIN_MS, Math.round(ms)));
  }

  private readTimeoutOverride(): void {
    try {
      const raw = localStorage.getItem(HEALTH_TIMEOUT_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        this._timeoutOverrideMs.set(this.clampTimeoutMs(parsed));
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Build the exact URL the Test button must call.
   *
   * Runtime rule: the host/FQDN entered in Application Configuration always
   * wins. endpoint-health.json supplies only the service port and status path.
   * This prevents a stale testUrl from sending a request to the old IP.
   */
  statusUrl(uiBase: string, key: EndpointKey | string): string | null {
    let path = this.statusPathFor(key);
    if (!path.startsWith('/')) path = `/${path}`;

    const ui = (uiBase ?? '').trim().replace(/\/+$/, '');
    const configuredBase = this.testBaseFor(key);

    // 1) Runtime UI value. Preserve an explicitly supplied port. If the UI
    // value has only a host/FQDN, inherit the configured service port.
    if (/^https?:\/\//i.test(ui)) {
      try {
        const u = new URL(ui);
        let port = u.port;
        if (!port && configuredBase) {
          try {
            port = new URL(configuredBase).port;
          } catch {
            // Keep the UI URL without a port if the configured base is invalid.
          }
        }
        const host = u.hostname + (port ? `:${port}` : '');
        if (u.pathname.includes('action=')) {
          return `${u.protocol}//${host}${u.pathname}${u.search}`;
        }
        return `${u.protocol}//${host}${path}`;
      } catch {
        // Fall through to the configured base for malformed input.
      }
    }

    // 2) A bare runtime host/FQDN. Apply the configured service port
    // and inherit protocol from configuredBase when available (fallback http).
    if (ui && !ui.startsWith('/')) {
      let host = ui.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      let proto = 'http';
      if (configuredBase) {
        try {
          const cfg = new URL(configuredBase);
          proto = cfg.protocol === 'https:' ? 'https' : 'http';
          // Do not add a second port when the user already entered one.
          if (!/:[0-9]+$/.test(host) && cfg.port) host = `${host}:${cfg.port}`;
        } catch {
          // Keep the entered host unchanged.
        }
      }
      return `${proto}://${host}${path}`;
    }

    // 3) Relative values use the Angular dev proxy.
    if (ui.startsWith('/')) {
      const base = ui.endsWith('/') ? ui.slice(0, -1) : ui;
      return `${base}${path}`;
    }

    // 4) No runtime value. Fall back to the static health configuration.
    const configured = this.testUrlFor(key);
    if (configured) return configured;
    if (configuredBase) return `${configuredBase.replace(/\/+$/, '')}${path}`;

    if (!ui && this.isOptional(key)) return null;
    return ui ? `${ui}${path}` : null;

  }

  /**
   * Route every runtime health check through the Angular dev proxy. This keeps
   * the actual upstream target out of the browser CORS path and makes the
   * request visible in the ng serve server log.
   *
   * The target/test are sent as request HEADERS, not a query string.
   * Vite's dev proxy middleware does `req.url = opts.rewrite(req.url)`
   * BEFORE handing the request to node-http-proxy's `router()` (see
   * proxy.conf.mjs for the full explanation) — so anything encoded only in
   * the query string is already gone by the time `router()` reads req.url.
   * Headers are never touched by `rewrite`, so they're the only reliable way
   * to pass data from here through to `router()` on the other side.
   */
  private proxyProbeUrl(): string {
    return '/__kd-probe';
  }

  async verify(base: string, key: EndpointKey | string): Promise<VerifyResult> {
    await this.ensureLoaded();
    const url = this.statusUrl(base, key);
    if (!url) {
      // Optional endpoints (e.g. gatewayOrigin) often have no testBase — not a failure.
      if (this.isOptional(key)) {
        const msg = 'Skipped (optional — no testBase/testUrl configured).';
        this.pushLog('info', `${key}: ${msg}`);
        return { state: 'skipped', message: msg };
      }
      const msg =
        'No URL to test (set testBase/testUrl in endpoint-health.json for this endpoint).';
      this.pushLog('error', `${key}: ${msg}`);
      return { state: 'skipped', message: msg };
    }

    let target = url;
    let test = '/action=getstatus';
    try {
      const parsed = new URL(url);
      target = parsed.origin;
      test = `${parsed.pathname || '/'}${parsed.search || ''}`;
    } catch {
      // Keep the complete URL in target if the URL cannot be parsed.
    }

    const label = this._config()?.endpoints?.[String(key)]?.label || String(key);
    // Keep the runtime endpoint visible in the log as structured data.
    // Example: Processing endpoint Community (communityApiUrl): {"target":"...","test":"..."}
    this.pushLog(
      'info',
      `Processing endpoint ${label} (${key}): ${JSON.stringify({ target, test })}`
    );

    const parsedTarget = (() => {
      try {
        const parsed = new URL(url);
        return {
          target: parsed.origin,
          test: `${parsed.pathname || '/'}${parsed.search || ''}`
        };
      } catch {
        return { target: url, test };
      }
    })();
    const requestUrl = this.proxyProbeUrl();
    const targetTest = JSON.stringify(parsedTarget);

    try {
      const resp = await firstValueFrom(
        this.http
          .get(requestUrl, {
            observe: 'response',
            responseType: 'text',
            headers: {
              'X-KD-Probe-Target': parsedTarget.target,
              'X-KD-Probe-Test': parsedTarget.test
            }
          })
          .pipe(timeout(this.timeoutMs()))
      );
      const status = resp.status;
      const { state, message } = this.classifyStatus(
        status,
        targetTest,
        resp.headers.get('Location'),
        resp.headers.get('X-KD-Probe-Final-Url'),
        resp.headers.get('X-KD-Probe-Redirect-Count')
      );
      this.pushLog(state === 'ok' ? 'ok' : 'error', `${key}: ${message}`);
      return { state, status, url, message };
    } catch (err: unknown) {
      if (err instanceof HttpErrorResponse) {
        const status = err.status;
        if (status === 0) {
          // The browser never got an HTTP response at all: the request was
          // refused, blocked by CORS, or the host/DNS could not be reached.
          // This is genuinely "not connected" — unlike a real 3xx/4xx/5xx
          // response below, where the upstream service DID answer.
          const message = `Not connected (connection refused, DNS failure, or blocked by CORS) — ${targetTest}`;
          this.pushLog('error', `${key}: ${message}`);
          return { state: 'error', status: 0, url, message };
        }
        const location = err.headers?.get?.('Location') ?? null;
        const finalUrl = err.headers?.get?.('X-KD-Probe-Final-Url') ?? null;
        const redirectCount = err.headers?.get?.('X-KD-Probe-Redirect-Count') ?? null;
        const { state, message } = this.classifyStatus(status, targetTest, location, finalUrl, redirectCount);
        this.pushLog(state === 'ok' ? 'ok' : 'error', `${key}: ${message}`);
        return { state, status, url, message };
      }
      const name =
        err && typeof err === 'object' && 'name' in err
          ? String((err as { name: string }).name)
          : '';
      if (name === 'TimeoutError') {
        const message = `Timeout — no response within ${this.timeoutMs()}ms — ${targetTest}`;
        this.pushLog('error', `${key}: ${message}`);
        return { state: 'error', url, message };
      }
      const message = `Not connected (unexpected error) — ${targetTest}`;
      this.pushLog('error', `${key}: ${message}`);
      return { state: 'error', url, message };
    }
  }

  /**
   * Turn a raw HTTP status into a meaningful diagnostic instead of a
   * blanket "Not connected (HTTP <status>)" for anything outside 2xx.
   *
   * ROOT CAUSE FIX (part 1): every configured endpoint in this
   * environment was reporting "Not connected (HTTP 301)" (see
   * endpoint-health.log). A 301 means the probe DID reach the upstream
   * service and got a real HTTP response back — the previous code only
   * checked for the 2xx range and lumped every other status (redirects,
   * auth challenges, not-found, server errors) into the same
   * "Not connected" bucket, hiding the fact that the service is actually
   * up and just redirecting (commonly an http/https protocol mismatch
   * between the probe and the target, or a trailing-slash / reverse-proxy
   * rewrite). Redirects, 4xx and 5xx are now reported as their own
   * distinct, non-"ok" states with a message that explains what was
   * actually observed.
   *
   * ROOT CAUSE FIX (part 2): the "still failed" reports after part 1 were
   * because probe-server.mjs handed the 3xx straight back to the browser
   * without ever forwarding the `Location` header (only Content-Type was
   * forwarded), so `location` here was always null and every redirect got
   * the same generic "check http vs https" guess with no real diagnostic.
   * probe-server.mjs now follows redirects itself (like a normal browser
   * would) and reports the *final* response, plus `X-KD-Probe-Final-Url`
   * / `X-KD-Probe-Redirect-Count` headers describing what it followed.
   * A 3xx can now only reach here if the redirect chain didn't fully
   * resolve (too many hops, or an unparsable Location) — Location is
   * still used when present for that remaining case.
   */
  private classifyStatus(
    status: number,
    targetTest: string,
    location?: string | null,
    finalUrl?: string | null,
    redirectCount?: string | null
  ): { state: VerifyState; message: string } {
    const hops = Number(redirectCount) || 0;
    const followedSuffix =
      hops > 0 && finalUrl ? ` (after following ${hops} redirect${hops === 1 ? '' : 's'} to ${finalUrl})` : '';

    if (status >= 200 && status < 300) {
      return { state: 'ok', message: `Connected (HTTP ${status})${followedSuffix} — ${targetTest}` };
    }
    if (status >= 300 && status < 400) {
      const hint = location
        ? ` — redirected to ${location}, but too many redirects were followed to reach a final answer`
        : ' — check http vs https, or a trailing slash/reverse-proxy rewrite';
      return {
        state: 'error',
        message: `Redirected (HTTP ${status}) — the service responded but did not return status directly${hint} — ${targetTest}`
      };
    }
    if (status === 401) {
      return {
        state: 'error',
        message: `HTTP 401 Unauthorized${followedSuffix} — reachable, but authentication is required — ${targetTest}`
      };
    }
    if (status === 403) {
      return {
        state: 'error',
        message: `HTTP 403 Forbidden${followedSuffix} — reachable, but access was denied — ${targetTest}`
      };
    }
    if (status === 404) {
      return {
        state: 'error',
        message: `HTTP 404 Not Found${followedSuffix} — reachable, but the status path was not found — ${targetTest}`
      };
    }
    if (status >= 500) {
      return {
        state: 'error',
        message: `HTTP ${status} Service error${followedSuffix} — reachable, but the service reported an error — ${targetTest}`
      };
    }
    return { state: 'error', message: `Not connected (HTTP ${status})${followedSuffix} — ${targetTest}` };
  }
}
