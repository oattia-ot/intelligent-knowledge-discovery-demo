import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Every external ACI/HTTP endpoint the SPA talks to, plus origin values.
 * Keys line up 1:1 with `environment.ts`.
 */
export type EndpointKey =
  | 'gatewayOrigin'
  | 'communityApiUrl'
  | 'contentApiUrl'
  | 'contentIndexApiUrl'
  | 'qmsApiUrl'
  | 'viewApiUrl'
  | 'viewServerUrl'
  | 'viewUpstreamOrigin'
  | 'agentstoreApiUrl'
  | 'categoryApiUrl'
  | 'answerServerApiUrl'
  | 'nifiCanvasUrl';

export type EndpointFamily = 'idol' | 'nifi' | 'app';

/** Authoritative default NiFi canvas URL. Kept in one place. */
export const DEFAULT_NIFI_CANVAS_URL = 'https://172.25.125.123:27111/nifi';

/** Filename loaded at boot for component defaults (assets copy of config/config.json). */
export const APP_CONFIG_FILE = 'config.json';
export const APP_CONFIG_ASSET_PATH = 'assets/config/config.json';

export type EndpointOverrides = Partial<Record<EndpointKey, string>>;

export interface EndpointField {
  key: EndpointKey;
  label: string;
  description: string;
  upstream?: string;
  /** Build-time / config.json default (path or absolute). */
  default: string;
  kind: 'origin' | 'path';
  /** IDOL ACI services vs independent integrations (NiFi) vs app origins. */
  family?: EndpointFamily;
}

export interface AppConfigFile {
  protocol?: 'http' | 'https';
  baseHost?: string;
  /** ACI backend host/FQDN. Origin fields are composed from this + component.upstream port. */
  upstreamHost?: string;
  components?: Array<{
    key: string;
    label?: string;
    description?: string;
    path?: string;
    absoluteDefault?: string;
    kind?: 'origin' | 'path';
    family?: EndpointFamily;
    upstream?: string;
    host?: string;
    port?: number | string;
    protocol?: 'http' | 'https';
  }>;
  business?: {
    defaultOperator?: string;
    defaultSummaryType?: string;
    defaultSummaryLength?: number;
    expertsSearch?: boolean;
    recommendations?: boolean;
    recommendationsOnHome?: boolean;
  };
  localization?: {
    defaultLanguage?: string;
    defaultTheme?: string;
    enableRtlLanguages?: boolean;
    customSwatches?: Record<string, string>;
  };
  branding?: {
    title?: string;
    subtitle?: string;
    footerPrimary?: string;
    footerPowered?: string;
    logo?: string | null;
  };
  health?: {
    timeoutMs?: number;
  };
}

const STORAGE_KEY = 'kd_endpoint_overrides';
const STORAGE_PROTOCOL = 'kd_endpoint_protocol';
const STORAGE_BASE = 'kd_endpoint_base_host';

/** Fallback metadata when config.json is missing or incomplete. */
const FALLBACK_FIELDS: readonly EndpointField[] = [
  {
    key: 'gatewayOrigin',
    label: 'Gateway origin',
    description: 'SPA + reverse-proxy origin. Leave blank to use the current page origin.',
    default: environment.gatewayOrigin,
    kind: 'origin',
    family: 'app'
  },
  {
    key: 'communityApiUrl',
    label: 'Community',
    description: 'Login / session — UserRead, SecurityInfo.',
    upstream: 'community:9030',
    default: environment.communityApiUrl,
    kind: 'path',
    family: 'idol'
  },
  {
    key: 'contentApiUrl',
    label: 'Content',
    description: 'Search / Query against the Content engine.',
    upstream: 'content:9100',
    default: environment.contentApiUrl,
    kind: 'path',
    family: 'idol'
  },
  {
    key: 'contentIndexApiUrl',
    label: 'Content Index',
    description: 'Index port — DRECREATEDBASE and other DRE* admin calls (not the ACI query port).',
    upstream: 'content:9101',
    default: environment.contentIndexApiUrl,
    kind: 'path',
    family: 'idol'
  },
  {
    key: 'qmsApiUrl',
    label: 'QMS',
    description: 'Query Manipulation Server — TypeAhead, AQG.',
    upstream: 'qms:16000',
    default: environment.qmsApiUrl,
    kind: 'path',
    family: 'idol'
  },
  {
    key: 'viewApiUrl',
    label: 'View',
    description: 'Document preview / View component.',
    upstream: 'view:9080',
    default: environment.viewApiUrl,
    kind: 'path',
    family: 'idol'
  },
  {
    key: 'viewServerUrl',
    label: 'View Server',
    description: 'View ACI actions (same-origin path).',
    upstream: 'view:9080',
    default: environment.viewServerUrl,
    kind: 'path',
    family: 'idol'
  },
  {
    key: 'viewUpstreamOrigin',
    label: 'View Upstream Origin',
    description: 'Absolute origin for nested View iframe rewrites (xECM).',
    upstream: 'view:9080',
    default: environment.viewUpstreamOrigin,
    kind: 'origin',
    family: 'idol'
  },
  {
    key: 'agentstoreApiUrl',
    label: 'Agentstore',
    description: 'Agentstore component.',
    upstream: 'agentstore:9150',
    default: environment.agentstoreApiUrl,
    kind: 'path',
    family: 'idol'
  },
  {
    key: 'categoryApiUrl',
    label: 'Category',
    description: 'Category component.',
    upstream: 'category:9020',
    default: environment.categoryApiUrl,
    kind: 'path',
    family: 'idol'
  },
  {
    key: 'answerServerApiUrl',
    label: 'AnswerServer',
    description: 'NLQA Answer Server.',
    upstream: 'answerserver:12000',
    default: environment.answerServerApiUrl,
    kind: 'path',
    family: 'idol'
  },
  {
    key: 'nifiCanvasUrl',
    label: 'NiFi canvas',
    description: 'Apache NiFi canvas UI. Independent of IDOL services — excluded from Apply to All.',
    upstream: 'nifi:27111',
    default: DEFAULT_NIFI_CANVAS_URL,
    kind: 'origin',
    family: 'nifi'
  }
];

/** Mutable export kept for older imports; refreshed after config.json load. */
export let ENDPOINT_FIELDS: readonly EndpointField[] = FALLBACK_FIELDS;

@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private readonly _overrides = signal<EndpointOverrides>(this.loadOverrides());
  private readonly _fields = signal<readonly EndpointField[]>(FALLBACK_FIELDS);
  private readonly _protocol = signal<'http' | 'https'>(this.loadProtocol());
  private readonly _baseHost = signal<string>(this.loadBaseHost());
  private readonly _upstreamHost = signal<string>('');
  private readonly _configLoaded = signal(false);
  /** Raw config.json as fetched at boot, kept to round-trip unmodeled keys on export. */
  private _rawConfigFile: Record<string, unknown> | null = null;

  readonly overrides = this._overrides.asReadonly();
  readonly fields = this._fields.asReadonly();
  readonly protocol = this._protocol.asReadonly();
  readonly baseHost = this._baseHost.asReadonly();
  readonly configLoaded = this._configLoaded.asReadonly();
  /** Resolves once config.json has loaded (or failed) and `fields()` holds
   *  the real defaults. Await this before reading fields/effective values
   *  for the first time, so consumers never render blanks or auto-test
   *  against fallback env values while the real config is still in flight. */
  readonly ready: Promise<void>;

  readonly effective = computed<Record<EndpointKey, string>>(() => {
    const ov = this._overrides();
    const fields = this._fields();
    const out = {} as Record<EndpointKey, string>;
    for (const field of fields) {
      out[field.key] = ov[field.key] ?? field.default;
    }
    // Ensure every known key exists even if config omitted it
    for (const field of FALLBACK_FIELDS) {
      if (!(field.key in out)) {
        out[field.key] = ov[field.key] ?? field.default;
      }
    }
    return out;
  });

  readonly hasOverrides = computed(() => Object.keys(this._overrides()).length > 0);

  constructor(private readonly http: HttpClient) {
    this.ready = this.loadConfigFile();
  }

  /** Join protocol + base host + path without duplicate slashes. */
  composeUrl(path: string, protocol?: 'http' | 'https', baseHost?: string): string {
    const p = (path ?? '').trim();
    const proto = protocol ?? this._protocol();
    const host = (baseHost ?? this._baseHost()).trim().replace(/\/+$/, '');

    if (!p) {
      return host ? `${proto}://${host.replace(/^https?:\/\//i, '')}` : '';
    }
    if (/^https?:\/\//i.test(p)) {
      return p;
    }
    const normalizedPath = p.startsWith('/') ? p : `/${p}`;
    if (!host) {
      return normalizedPath;
    }
    const hostNoScheme = host.replace(/^https?:\/\//i, '');
    return `${proto}://${hostNoScheme}${normalizedPath}`;
  }

  /** Preview URL for a component path using current protocol + base host. */
  previewUrl(path: string): string {
    return this.composeUrl(path);
  }

  /** Port from `view:9083` / `https://host:9083`. */
  portFromUpstream(upstream?: string): string | undefined {
    const raw = String(upstream || '').trim();
    const m = raw.match(/:(\d+)\s*$/);
    return m ? m[1] : undefined;
  }

  /**
   * Compose an absolute origin from config.json `upstreamHost` + the
   * component's `upstream` port. Used so `absoluteDefault` is never a
   * baked-in IP — it always follows the current upstreamHost.
   */
  composeOriginFromUpstream(
    upstream?: string,
    upstreamHost?: string,
    protocol?: 'http' | 'https'
  ): string {
    const proto = protocol ?? this._protocol();
    const host = (upstreamHost ?? this._upstreamHost())
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');
    if (!host) {
      return '';
    }
    const port = this.portFromUpstream(upstream);
    return port ? `${proto}://${host}:${port}` : `${proto}://${host}`;
  }

  setProtocol(protocol: 'http' | 'https'): void {
    this._protocol.set(protocol);
    try {
      localStorage.setItem(STORAGE_PROTOCOL, protocol);
    } catch {
      /* ignore */
    }
  }

  setBaseHost(host: string): void {
    const clean = host.trim().replace(/\/+$/, '');
    this._baseHost.set(clean);
    try {
      localStorage.setItem(STORAGE_BASE, clean);
    } catch {
      /* ignore */
    }
  }

  gatewayOrigin(): string {
    return this.get('gatewayOrigin');
  }

  communityApiUrl(): string {
    return this.get('communityApiUrl');
  }

  /**
   * URL the browser should actually call for an ACI component.
   *
   * Settings may save `https://172.25.125.123/community` (host + path, no ACI
   * port). Hitting that from localhost:4200 is cross-origin and is not the
   * Community port (9030). Settings → Test works because it uses /__kd-probe
   * to `https://host:9030`. For same-origin proxy traffic, fall back to the
   * configured path (`/community`) when the stored value points at another host.
   */
  requestUrl(key: EndpointKey): string {
    const stored = this.get(key);
    const field = this.fields().find((f) => f.key === key);
    if (key === 'nifiCanvasUrl' || field?.family === 'nifi') {
      return stored || field?.default || DEFAULT_NIFI_CANVAS_URL;
    }
    const canonical = this.canonicalProxyPath(key, field);
    const fallbackPath = canonical || field?.default || stored;
    if (!stored) return fallbackPath;
    if (!/^https?:\/\//i.test(stored)) {
      return stored === '/' && canonical ? canonical : stored;
    }
    if (typeof window === 'undefined') return stored;
    try {
      const u = new URL(stored);
      const pathFromUrl = u.pathname && u.pathname !== '/' ? u.pathname : '';
      if (u.host === window.location.host) {
        return pathFromUrl || fallbackPath;
      }
      const path = pathFromUrl || fallbackPath;
      return path.startsWith('/') ? path : `/${path}`;
    } catch {
      return stored;
    }
  }

  /** Same-origin proxy prefix (/content, /qms, …). Never '/' or a bare origin. */
  private canonicalProxyPath(key: EndpointKey, field?: EndpointField): string {
    const raw = (field?.default || FALLBACK_FIELDS.find((f) => f.key === key)?.default || '').trim();
    if (!raw) return '';
    if (raw.startsWith('/')) return raw === '/' ? '' : raw;
    try {
      const u = new URL(raw);
      return u.pathname && u.pathname !== '/' ? u.pathname : '';
    } catch {
      return '';
    }
  }

  contentApiUrl(): string {
    return this.get('contentApiUrl');
  }

  contentIndexApiUrl(): string {
    return this.get('contentIndexApiUrl');
  }

  qmsApiUrl(): string {
    return this.get('qmsApiUrl');
  }

  viewApiUrl(): string {
    return this.get('viewApiUrl');
  }

  viewServerUrl(): string {
    return this.get('viewServerUrl') || this.get('viewApiUrl');
  }

  viewUpstreamOrigin(): string {
    return this.get('viewUpstreamOrigin');
  }

  agentstoreApiUrl(): string {
    return this.get('agentstoreApiUrl');
  }

  categoryApiUrl(): string {
    return this.get('categoryApiUrl');
  }

  answerServerApiUrl(): string {
    return this.get('answerServerApiUrl');
  }

  nifiCanvasUrl(): string {
    return this.get('nifiCanvasUrl') || DEFAULT_NIFI_CANVAS_URL;
  }

  isIdolField(field: EndpointField | EndpointKey): boolean {
    const f = typeof field === 'string' ? this.fields().find((x) => x.key === field) : field;
    if (!f) return false;
    if (f.family) return f.family === 'idol';
    return f.key !== 'nifiCanvasUrl' && f.key !== 'gatewayOrigin';
  }

  isNifiField(field: EndpointField | EndpointKey): boolean {
    const f = typeof field === 'string' ? this.fields().find((x) => x.key === field) : field;
    return !!f && (f.family === 'nifi' || f.key === 'nifiCanvasUrl');
  }

  configFileName(): string {
    return APP_CONFIG_FILE;
  }

  configAssetPath(): string {
    return APP_CONFIG_ASSET_PATH;
  }

  replaceProtocol(url: string, protocol: 'http' | 'https'): string {
    const raw = (url ?? '').trim();
    if (!raw || raw.startsWith('/')) return raw;
    try {
      const u = new URL(raw.includes('://') ? raw : `${protocol}://${raw}`);
      u.protocol = `${protocol}:`;
      const keepSlash = u.pathname !== '/' || /https?:\/\/[^/]+\//i.test(raw);
      const path = keepSlash ? u.pathname : (u.pathname === '/' ? '' : u.pathname);
      return `${u.protocol}//${u.host}${path}${u.search}${u.hash}`;
    } catch {
      return raw.replace(/^https?:\/\//i, `${protocol}://`);
    }
  }

  parseHostPortProtocol(raw: string): { host: string; port: string; protocol: 'http' | 'https' | '' } {
    const value = (raw ?? '').trim();
    if (!value || value.startsWith('/')) {
      const up = value.match(/:(\d+)\s*$/);
      return { host: '', port: up ? up[1] : '', protocol: '' };
    }
    try {
      const u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      return {
        host: u.hostname,
        port: u.port || '',
        protocol: u.protocol === 'http:' ? 'http' : /^https?:\/\//i.test(value) ? 'https' : ''
      };
    } catch {
      const m = value.match(/^(?:(https?):\/\/)?([^:/]+)(?::(\d+))?/i);
      return {
        host: m?.[2] ?? '',
        port: m?.[3] ?? '',
        protocol: m?.[1] === 'http' || m?.[1] === 'https' ? m[1] : ''
      };
    }
  }

  /**
   * After an imported config.json is applied as field defaults, also write
   * runtime overrides from host/port/absoluteDefault so the rest of the app
   * (search, login, View, QMS…) reads the imported values immediately.
   */
  applyImportedComponentRuntime(cfg: AppConfigFile): void {
    for (const c of cfg.components ?? []) {
      if (!c?.key) continue;
      const key = c.key as EndpointKey;
      if (!FALLBACK_FIELDS.some((f) => f.key === key)) continue;
      const field = this._fields().find((f) => f.key === key);
      const proto: 'http' | 'https' =
        c.protocol === 'http' || c.protocol === 'https' ? c.protocol : this._protocol();
      const abs = (c.absoluteDefault || '').trim();
      const host = (c.host || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      const port = c.port != null && String(c.port).trim() !== '' ? String(c.port).trim() : '';
      if (port) {
        this.patchComponentPort(key, port);
      }
      if (abs && this.isValid(abs)) {
        this.setOverride(key, /^https?:\/\//i.test(abs) ? this.replaceProtocol(abs, proto) : abs);
        continue;
      }
      if (host) {
        const hostPort = port && !/:\d+$/.test(host.split('/')[0]) ? `${host.replace(/:\d+$/, '')}:${port}` : host;
        const path = field?.kind === 'path' ? (c.path || field.default || '') : '';
        const composed = this.composeUrl(path.startsWith('/') ? path : this.pathOf(path), proto, hostPort);
        if (composed && this.isValid(composed)) {
          this.setOverride(key, composed);
        }
      }
    }
  }

  /**
   * Browser calls the same-origin proxy path. This is the ACI origin the
   * proxy is supposed to dial (Settings protocol + host + port 12000).
   */
  answerServerDirectOrigin(): string {
    const proto = this.protocol();
    const raw = (this.baseHost() || this._upstreamHost() || '').trim();
    const host = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (/:\d+$/.test(host)) {
      return `${proto}://${host}`;
    }
    return `${proto}://${host}:12000`;
  }

  get(key: EndpointKey): string {
    return this.effective()[key];
  }

  setOverride(key: EndpointKey, value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
      this.clearOverride(key);
      return true;
    }
    if (!this.isValid(trimmed)) {
      return false;
    }
    this._overrides.update((ov) => ({ ...ov, [key]: trimmed }));
    this.persistOverrides();
    return true;
  }

  /**
   * Set a component path (e.g. `/view`). When a base host is configured,
   * stores the composed absolute URL; otherwise stores the path.
   */
  setComponentPath(key: EndpointKey, path: string): boolean {
    const trimmed = path.trim();
    if (!trimmed) {
      this.clearOverride(key);
      return true;
    }
    const composed = this.composeUrl(trimmed);
    return this.setOverride(key, composed);
  }

  /**
   * Update the in-memory `upstream` label (service:port) so Settings and
   * origin composition pick up a port the user just typed.
   */
  patchComponentPort(key: EndpointKey, port: string): void {
    const p = String(port || '').trim();
    if (!/^\d{1,5}$/.test(p)) {
      return;
    }
    const n = Number(p);
    if (n < 1 || n > 65535) {
      return;
    }
    this._fields.update((fields) =>
      fields.map((f) => {
        if (f.key !== key) {
          return f;
        }
        const raw = String(f.upstream || f.key);
        const nextUpstream = raw.includes(':')
          ? raw.replace(/:\d+\s*$/, `:${p}`)
          : `${raw}:${p}`;
        let nextDefault = f.default;
        if (/^https?:\/\//i.test(f.default)) {
          try {
            const u = new URL(f.default);
            u.port = p;
            nextDefault = u.origin + (u.pathname === '/' ? '' : u.pathname) + u.search;
          } catch {
            /* keep default */
          }
        }
        return { ...f, upstream: nextUpstream, default: nextDefault };
      })
    );
    ENDPOINT_FIELDS = this._fields();
  }

  setScheme(key: EndpointKey, scheme: 'http' | 'https'): void {
    const current = this.get(key);
    if (!/^https?:\/\//i.test(current)) {
      return;
    }
    this.setOverride(key, this.replaceProtocol(current, scheme));
  }

  clearOverride(key: EndpointKey): void {
    this._overrides.update((ov) => {
      if (!(key in ov)) {
        return ov;
      }
      const next = { ...ov };
      delete next[key];
      return next;
    });
    this.persistOverrides();
  }

  resetAll(): void {
    this._overrides.set({});
    this.persistOverrides();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_PROTOCOL);
      localStorage.removeItem(STORAGE_BASE);
    } catch {
      /* ignore */
    }
  }

  async reloadDefaultsFromFile(): Promise<void> {
    this.resetAll();
    await this.loadConfigFile();
  }

  isValid(value: string): boolean {
    if (value.startsWith('/')) {
      return true;
    }
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  isAbsolute(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  /** Extract path portion for display in path-only inputs. */
  pathOf(value: string): string {
    const v = (value ?? '').trim();
    if (!v) {
      return '';
    }
    if (v.startsWith('/')) {
      return v;
    }
    try {
      const u = new URL(v);
      return u.pathname || '/';
    } catch {
      return v;
    }
  }

  private async loadConfigFile(): Promise<void> {
    try {
      const cfg = await firstValueFrom(
        this.http.get<AppConfigFile & Record<string, unknown>>('assets/config/config.json')
      );
      // Keep the raw payload (including keys we don't model, e.g. $schema_comment,
      // business, localization) so exportConfigSnapshot() can round-trip them.
      this._rawConfigFile = cfg;
      this.applyConfigFile(cfg);
    } catch {
      // Missing or invalid config.json — keep environment defaults
      this._fields.set(FALLBACK_FIELDS);
      ENDPOINT_FIELDS = FALLBACK_FIELDS;
    } finally {
      this._configLoaded.set(true);
    }
  }

  private applyConfigFile(cfg: AppConfigFile): void {
    // Boot order: config.json is the source of truth, then localStorage is
    // rewritten to match. Stale http toggles from an older session must not
    // win over the file (and the default protocol is always https).
    const protocol: 'http' | 'https' =
      cfg.protocol === 'http' || cfg.protocol === 'https' ? cfg.protocol : 'https';
    this._protocol.set(protocol);
    if (typeof cfg.baseHost === 'string') {
      this._baseHost.set(cfg.baseHost.trim().replace(/\/+$/, ''));
    }
    if (typeof cfg.upstreamHost === 'string') {
      this._upstreamHost.set(cfg.upstreamHost.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, ''));
    }

    if (Array.isArray(cfg.components) && cfg.components.length > 0) {
      const mapped: EndpointField[] = [];
      const seen = new Set<string>();
      for (const c of cfg.components) {
        if (!c?.key) continue;
        const key = c.key as EndpointKey;
        if (!FALLBACK_FIELDS.some((f) => f.key === key)) continue;
        const kind = c.kind === 'origin' ? 'origin' : 'path';
        const fallback = FALLBACK_FIELDS.find((f) => f.key === key)!;
        const family: EndpointFamily =
          c.family || fallback.family || (key === 'nifiCanvasUrl' ? 'nifi' : key === 'gatewayOrigin' ? 'app' : 'idol');
        const derivedOrigin =
          kind === 'origin' && family === 'idol'
            ? this.composeOriginFromUpstream(c.upstream || fallback.upstream, cfg.upstreamHost, protocol)
            : '';
        const defaultVal =
          derivedOrigin ||
          (c.absoluteDefault && c.absoluteDefault.trim()) ||
          (c.path && c.path.trim()) ||
          fallback.default;
        mapped.push({
          key,
          label: c.label || fallback.label,
          description: c.description || fallback.description,
          upstream: c.upstream || fallback.upstream,
          default: defaultVal,
          kind,
          family
        });
        seen.add(key);
      }
      // Append any fallback fields missing from config
      for (const f of FALLBACK_FIELDS) {
        if (!seen.has(f.key)) {
          mapped.push(f);
        }
      }
      this._fields.set(mapped);
      ENDPOINT_FIELDS = mapped;
    }
    this.syncLocalStorageFromConfig();
  }

  /**
   * After config.json loads, align browser storage with the file and force
   * https on the global protocol plus every saved absolute override.
   */
  private syncLocalStorageFromConfig(): void {
    const upgraded: EndpointOverrides = {};
    for (const [key, value] of Object.entries(this._overrides())) {
      if (typeof value !== 'string') continue;
      upgraded[key as EndpointKey] = value.replace(/^http:\/\//i, 'https://');
    }
    this._overrides.set(upgraded);
    if (this._protocol() === 'http') {
      this._protocol.set('https');
    }
    try {
      localStorage.setItem(STORAGE_PROTOCOL, this._protocol());
      localStorage.setItem(STORAGE_BASE, this._baseHost());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._overrides()));
    } catch {
      /* ignore quota / private mode */
    }
  }

  private loadOverrides(): EndpointOverrides {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as EndpointOverrides;
      const clean: EndpointOverrides = {};
      const validKeys = new Set(FALLBACK_FIELDS.map((f) => f.key));
      for (const [k, v] of Object.entries(parsed)) {
        if (validKeys.has(k as EndpointKey) && typeof v === 'string' && this.isValid(v)) {
          clean[k as EndpointKey] = v;
        }
      }
      return clean;
    } catch {
      return {};
    }
  }

  private loadProtocol(): 'http' | 'https' {
    try {
      const raw = localStorage.getItem(STORAGE_PROTOCOL);
      if (raw === 'http' || raw === 'https') {
        return raw;
      }
    } catch {
      /* ignore */
    }
    return 'https';
  }

  private loadBaseHost(): string {
    try {
      return (localStorage.getItem(STORAGE_BASE) ?? '').trim().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  private persistOverrides(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._overrides()));
    } catch {
      /* ignore */
    }
  }

  /**
   * Build a config.json-shaped snapshot of the CURRENT effective endpoint
   * settings (build defaults + any Save'd overrides), so it reflects what
   * this browser actually resolved to per field, not just what's in
   * localStorage.
   *
   * IMPORTANT: `config/config.json` is a static asset served by nginx and
   * this is a client-only SPA with no backend — the browser has no way to
   * write to that file on disk. "Save" here only ever persists to this
   * browser's localStorage (see persistOverrides()). This snapshot exists
   * so an admin can download it and manually replace
   * `config/config.json` on the server (then redeploy / reload nginx) to
   * make a change the new default for every user, not just this browser.
   */
  exportConfigSnapshot(): Record<string, unknown> {
    const base: Record<string, unknown> = this._rawConfigFile
      ? (JSON.parse(JSON.stringify(this._rawConfigFile)) as Record<string, unknown>)
      : { protocol: this._protocol(), baseHost: this._baseHost(), components: [] };

    base['protocol'] = this._protocol();
    base['baseHost'] = this._baseHost();
    if (this._upstreamHost()) {
      base['upstreamHost'] = this._upstreamHost();
    }

    const existing = Array.isArray(base['components']) ? (base['components'] as Record<string, unknown>[]) : [];
    const byKey = new Map(existing.map((c) => [c['key'], c]));
    const eff = this.effective();

    base['components'] = this._fields().map((field) => {
      const prior = byKey.get(field.key) ?? {};
      const value = eff[field.key];
      const entry: Record<string, unknown> = {
        ...prior,
        key: field.key,
        label: field.label,
        description: field.description,
        family: field.family ?? prior['family'] ?? (field.key === 'nifiCanvasUrl' ? 'nifi' : 'idol'),
        upstream: field.upstream ?? prior['upstream'] ?? ''
      };
      if (field.kind === 'origin') {
        entry['kind'] = 'origin';
        entry['path'] = '';
        entry['absoluteDefault'] = value || '';
      } else {
        delete entry['kind'];
        if (this.isAbsolute(value)) {
          // A per-row host was set: pin the absolute URL so it survives
          // even if the global protocol/baseHost above differ.
          entry['absoluteDefault'] = value;
          entry['path'] = this.pathOf(value);
        } else {
          delete entry['absoluteDefault'];
          entry['path'] = value || this.pathOf(field.default);
        }
      }
      const parsed = this.parseHostPortProtocol(value || field.default || String(entry['upstream'] || ''));
      if (parsed.host) entry['host'] = parsed.host;
      if (parsed.port) entry['port'] = Number(parsed.port);
      if (parsed.protocol) entry['protocol'] = parsed.protocol;
      if (parsed.port && entry['upstream']) {
        entry['upstream'] = String(entry['upstream']).replace(/:\d+\s*$/, `:${parsed.port}`);
      } else if (parsed.port && !entry['upstream']) {
        entry['upstream'] = `${field.key}:${parsed.port}`;
      }
      return entry;
    });

    return base;
  }

  /**
   * Apply a parsed config.json payload as the new source of truth for this
   * browser (fields + protocol + upstream host), clearing stale overrides
   * so the imported file actually wins.
   */
  importConfigSnapshot(
    cfg: AppConfigFile & Record<string, unknown>
  ): { ok: true; processed: Array<{ key: string; label: string; value: string }> } | { ok: false; error: string } {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      return { ok: false, error: 'config.json must be a JSON object.' };
    }
    if (cfg.components != null && !Array.isArray(cfg.components)) {
      return { ok: false, error: 'config.json "components" must be an array.' };
    }
    this.resetAll();
    this._rawConfigFile = cfg;
    this.applyConfigFile(cfg);
    this.applyImportedComponentRuntime(cfg);
    const eff = this.effective();
    const processed = this._fields().map((field) => ({
      key: field.key,
      label: field.label,
      value: eff[field.key] || field.default || ''
    }));
    return { ok: true, processed };
  }

  /** Trigger a browser download of exportConfigSnapshot() as a .json file. */
  downloadConfigSnapshot(filename = 'config.json'): void {
    try {
      const json = JSON.stringify(this.exportConfigSnapshot(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* ignore */
    }
  }
}
