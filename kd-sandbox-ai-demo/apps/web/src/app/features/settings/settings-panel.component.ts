import { ChangeDetectorRef, Component, ElementRef, HostListener, ViewChild, effect, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AppSettingsService,
  EndpointField,
  EndpointKey
} from '../../core/services/app-settings.service';
import {
  CONCEPT_OPERATORS,
  ConceptOperator,
  ConceptSearchSettingsService,
  SUMMARY_LENGTH_OPTIONS,
  SUMMARY_TYPES,
  SummaryType
} from '../../core/services/concept-search-settings.service';
import { SettingsTab, SettingsUiService } from '../../core/services/settings-ui.service';
import { ThemeId, ThemeService, ThemeSwatches } from '../../core/services/theme.service';
import { BrandingService } from '../../core/services/branding.service';
import {
  EndpointHealthService,
  VerifyState,
  HealthLogEntry,
  HEALTH_TIMEOUT_MIN_MS,
  HEALTH_TIMEOUT_MAX_MS
} from '../../core/services/endpoint-health.service';
import { AnswerService } from '../../core/services/answer.service';
import { UpstreamHostAdminService } from '../../core/services/upstream-host-admin.service';
import {
  IdolDatabaseInfo,
  IdolDatabasesService
} from '../../core/services/idol-databases.service';
import { ConfigService } from '../../core/services/config.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { LangCode } from '../../core/i18n/translations';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslatePipe],
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.scss'
})
export class SettingsPanelComponent implements OnInit {
  @ViewChild('configFileInput') private configFileInput?: ElementRef<HTMLInputElement>;

  private readonly ui = inject(SettingsUiService);
  private readonly appSettings = inject(AppSettingsService);
  private readonly conceptSettings = inject(ConceptSearchSettingsService);
  private readonly themes = inject(ThemeService);
  private readonly branding = inject(BrandingService);
  private readonly health = inject(EndpointHealthService);
  private readonly upstreamHostAdmin = inject(UpstreamHostAdminService);
  private readonly answerService = inject(AnswerService);
  private readonly idolDatabases = inject(IdolDatabasesService);
  private readonly config = inject(ConfigService);
  private readonly cdr = inject(ChangeDetectorRef);
  private databasesListGen = 0;
  /** Live endpoint Test log (also downloadable). */
  readonly healthLog = this.health.log;
  /** Whether the "Endpoint test log" section is shown. Hidden by Reset,
   *  shown again the next time a Test / Test all run pushes new entries. */
  readonly logVisible = signal(true);
  private readonly i18n = inject(I18nService);

  readonly open = this.ui.open;
  readonly tab = this.ui.tab;
  /** Languages list is a computed signal (filters RTL langs when disabled). */
  readonly languages = this.i18n.languages;
  readonly lang = this.i18n.lang;
  readonly enableRtlLanguages = this.i18n.enableRtlLanguages;
  readonly themeList = this.themes.themes;
  readonly themeId = this.themes.themeId;
  customDraft: ThemeSwatches = {
    primary: '#7c3aed',
    navy: '#1e1b4b',
    bg: '#faf5ff',
    surface: '#ffffff',
    accent: '#c084fc'
  };
  readonly logoUrl = this.branding.logoUrl;
  readonly appTitle = this.branding.title;
  titleDraft = '';
  subtitleDraft = '';
  footerPrimaryDraft = '';
  footerPoweredDraft = '';
  logoError: string | null = null;
  logoOk = false;
  /** Per-endpoint verify state keyed by EndpointKey. */
  verifyState: Record<string, VerifyState> = {};
  verifyMessage: Record<string, string> = {};
  verifyUrl: Record<string, string> = {};

  readonly conceptOperators = CONCEPT_OPERATORS;
  readonly summaryTypes = SUMMARY_TYPES;
  readonly summaryLengthOptions = SUMMARY_LENGTH_OPTIONS;
  readonly lastExpandedQuery = this.conceptSettings.lastExpandedQuery;
  readonly expertsFeatureAvailable = this.conceptSettings.expertsFeatureAvailable;
  readonly expertsSearchEnabled = this.conceptSettings.expertsSearchUserEnabled;
  readonly recommendationsFeatureAvailable =
    this.conceptSettings.recommendationsFeatureAvailable;
  readonly recommendationsUserEnabled = this.conceptSettings.recommendationsUserEnabled;
  readonly recommendationsOnHomeUserEnabled =
    this.conceptSettings.recommendationsOnHomeUserEnabled;

  /**
   * Draft host (FQDN/IP) per endpoint key.
   * For path-kind fields the component path is fixed and concatenated on save/preview.
   * For origin-kind fields this may hold a full URL or host.
   */
  pathDraft: Record<string, string> = {};
  /** Per-row ACI / service port (1–65535). Empty = inherit from config. */
  portDraft: Record<string, string> = {};
  portError: Record<string, string> = {};
  /** Per-row HTTP/HTTPS choice. */
  protocolByKey: Record<string, 'http' | 'https'> = {};
  pathError: Record<string, string> = {};
  savedFlash = false;
  /** Prevent overlapping auto-verify runs. */
  private autoVerifyRunning = false;

  /** Health-check timeout draft, in seconds (Settings → Application). */
  timeoutSecondsDraft = 3;
  readonly healthTimeoutMinSeconds = HEALTH_TIMEOUT_MIN_MS / 1000;
  readonly healthTimeoutMaxSeconds = HEALTH_TIMEOUT_MAX_MS / 1000;
  timeoutSavedFlash = false;
  /** Preview overlay for endpoint-health.json (Use file default button). */
  healthFilePreviewOpen = false;
  healthFilePreviewPath = '';
  healthFilePreviewJson = '';
  healthFilePreviewError = '';

  // --- Backend upstream host (dev server) ---
  // External LLM (Answer Server system), written to config/answer.json
  externalLlmName = 'Grok';
  externalLlmKey = '';
  externalLlmKeyHint = '';
  externalLlmBusy = signal(false);
  externalLlmMessage = signal('');
  externalLlmError = signal(false);

  upstreamHostDraft = '';
  /** http/https for the Backend upstream host row. Defaults to https —
   *  switching this cascades to every component row's own http/https
   *  toggle below, but only while the upstream host textbox is non-empty
   *  (see setUpstreamHostProtocol). */
  upstreamHostProtocol: 'http' | 'https' = 'https';
  readonly upstreamHostSaveState = this.upstreamHostAdmin.saveState;
  readonly upstreamHostMessage = this.upstreamHostAdmin.saveMessage;
  // --- Content databases ---
  contentDatabases: IdolDatabaseInfo[] = [];
  databasesLoading = false;
  databasesBusy = false;
  databasesError = '';
  databasesMessage = '';
  newDatabaseName = '';

  /** True while a save/restart is in flight — disables the input + button. */
  upstreamHostBusy(): boolean {
    const state = this.upstreamHostSaveState();
    return state === 'saving' || state === 'restarting';
  }

  ngOnInit(): void {
    // If Settings is already open when this component mounts, populate the
    // boxes with the loaded config.json defaults and only then auto-test.
    void this.openApplicationSettings(this.ui.open());
  }

  constructor() {
    effect(() => {
      if (this.ui.open()) {
        this.titleDraft = this.branding.title();
        this.subtitleDraft = this.branding.subtitle();
        this.footerPrimaryDraft = this.branding.footerPrimary();
        this.footerPoweredDraft = this.branding.footerPowered();
        this.customDraft = { ...this.themes.customSwatches() };
        void this.openApplicationSettings(true);
      }
    });
  }

  /**
   * Wait for config.json AND endpoint-health.json to finish loading so every
   * field's textbox shows its real FQDN/IP default — never blank — before
   * Test runs against it. `alwaysTest` runs Test right after syncing (Settings
   * just opened / tab just switched); pass false for a plain resync only.
   */
  private async openApplicationSettings(alwaysTest: boolean): Promise<void> {
    // Wait for both config.json (component paths) and endpoint-health.json
    // (the real IP/FQDN testBase defaults) so every textbox shows its true
    // default value — never blank — before Test runs against it.
    await Promise.all([this.appSettings.ready, this.health.ensureLoaded()]);
    this.syncDraftsFromService();
    this.pathError = {};
    this.savedFlash = false;
    if (!this.upstreamHostBusy()) {
      void this.loadUpstreamHost();
    }
    void this.loadExternalLlm();
    if (alwaysTest) {
      void this.autoVerifyAllEndpoints();
    }
  }

  /** Prefill the "Backend upstream host" textbox from config.json via the
   *  dev-only admin endpoint. Silently leaves the field blank if that
   *  endpoint isn't reachable (built app, or started via serve.sh). */
  private async loadUpstreamHost(): Promise<void> {
    const current = await this.upstreamHostAdmin.fetchCurrentHost();
    if (current) {
      this.upstreamHostDraft = current.host;
      if (current.protocol === 'http' || current.protocol === 'https') {
        this.upstreamHostProtocol = current.protocol;
      }
    }
  }

  private async loadExternalLlm(): Promise<void> {
    const cur = await this.upstreamHostAdmin.fetchExternalLlm();
    if (!cur) {
      return;
    }
    if (cur.systemName) {
      this.externalLlmName = cur.systemName;
    }
    this.externalLlmKey = '';
    this.externalLlmKeyHint = cur.apiKeySet ? cur.apiKeyHint : '';
  }

  async saveExternalLlm(remove = false, event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.externalLlmBusy()) {
      return;
    }
    this.externalLlmBusy.set(true);
    this.externalLlmError.set(false);
    this.externalLlmMessage.set('');
    const res = await this.upstreamHostAdmin.persistExternalLlm({
      systemName: this.externalLlmName.trim(),
      apiKey: this.externalLlmKey.trim(),
      remove
    });
    this.externalLlmBusy.set(false);
    if (!res.ok) {
      this.externalLlmError.set(true);
      this.externalLlmMessage.set(res.error || 'Failed to save.');
      return;
    }
    if (res.systemNames) {
      this.answerService.setSystemNames(res.systemNames);
    }
    this.externalLlmKey = '';
    await this.loadExternalLlm();
    if (remove) {
      this.externalLlmName = 'Grok';
      this.externalLlmKeyHint = '';
    }
    this.externalLlmMessage.set(
      remove
        ? `External system removed. Ask now uses: ${res.systemNames}.`
        : `Saved to config/answer.json. Ask now uses: ${res.systemNames}.`
    );
  }

  /** Save the new upstream host and, if this dev server supports it,
   *  restart `ng serve` to apply it (see upstream-host-admin.service.ts). */
  async saveUpstreamHost(event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    // See SettingsUiService.markReopenAfterRestart: a successful save here
    // can make dev.mjs restart `ng serve`, which forces a full page reload
    // once the browser reconnects. Leave a breadcrumb *before* that happens
    // so Settings reopens on this same tab afterwards instead of the app
    // silently landing back on the home page.
    this.ui.markReopenAfterRestart(this.activeTab());
    await this.upstreamHostAdmin.saveHost(this.upstreamHostDraft, this.upstreamHostProtocol);
    const state = this.upstreamHostSaveState();
    if (state !== 'restarting') {
      // No restart actually happened (saved without restart, failed, or the
      // admin endpoint is unavailable) — don't leave a stale breadcrumb that
      // could reopen Settings on some unrelated later page load.
      this.ui.clearReopenAfterRestart();
    }
  }

  /**
   * Switch the Backend upstream host row's own http/https choice. When the
   * upstream host textbox is non-empty, this also cascades the chosen
   * protocol to every component row below (same effect as clicking each
   * row's toggle individually). When the textbox is empty, only this row's
   * toggle changes — nothing below is touched.
   */
  setUpstreamHostProtocol(protocol: 'http' | 'https', event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.upstreamHostProtocol === protocol) {
      return;
    }
    this.upstreamHostProtocol = protocol;
    if (this.upstreamHostDraft.trim()) {
      this.applyProtocolToAllRows(protocol);
    }
  }

  /**
   * Global "Apply to all" button next to the Backend upstream host
   * http/https toggle. Always enabled (except while a save/restart is
   * already in flight). Pushes the currently selected protocol into every
   * component row below. When the textbox has a host, also pushes that
   * host into every row's IP/FQDN textbox. Then persists those values into
   * the application's effective configuration state and runs the former
   * Save & Restart flow so the dev-only upstream host is also written and
   * the dev server restarts to apply it. An empty textbox is valid: rows
   * keep their existing hosts, and the saved upstreamHost is cleared.
   *
   * ROOT CAUSE FIX: this used to only update the draft textboxes
   * (pathDraft / protocolByKey) and call saveUpstreamHost(), which writes
   * *only* the dev-only "Backend upstream host" admin endpoint — it never
   * persisted the per-row values into AppSettingsService. That left the
   * rows *looking* updated while the app's actual effective configuration
   * (what every other component/API call reads via appSettings.get())
   * silently kept the old values until the user separately pressed the
   * row-level Save button below. Calling saveApplication() here captures
   * the current draft, validates it, and persists it as the new effective
   * override for every field — the same capture -> validate -> persist ->
   * refresh flow the row-level Save uses, and like it, this deliberately
   * leaves the Settings window open (no this.ui.hide() call anywhere in
   * this flow) so the applied values can be reviewed in place.
   */
  applyGlobalProtocol(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.upstreamHostBusy()) {
      return;
    }
    const host = this.upstreamHostDraft.trim();
    this.applyProtocolToAllRows(this.upstreamHostProtocol);
    // Also push the host itself into every row's own IP/FQDN textbox,
    // reusing onPathInput so each row's error state and stale Test
    // result/log get cleared exactly as if the user had typed it there.
    // Only the IP/FQDN portion is replaced — an existing :port on that
    // row (or a scheme/path prefix an origin-kind row may hold) is kept.
    if (host) {
      for (const field of this.idolFields()) {
        const current = this.pathDraft[field.key] ?? '';
        const merged = this.mergeHostKeepingPort(current, host);
        if (current.trim() !== merged) {
          this.onPathInput(field, merged);
        }
      }
    }
    // Persist the now-updated drafts into the application's effective
    // configuration state (see ROOT CAUSE FIX above). Runs synchronously
    // and keeps the modal open; any invalid row is reported the same way
    // the row-level Save reports it (this.pathError), without discarding
    // the rest of the applied values.
    //
    // Do NOT call saveUpstreamHost() here: that can restart ng serve and
    // reload the page, which closes this Settings window. Apply-to-all
    // must persist protocol/host drafts only and leave the modal open.
    this.saveApplication();
  }

  /**
   * Replace only the IP/FQDN portion of an existing row value with
   * `newHost`, preserving any `:port` and, for origin-kind rows that may
   * hold a full URL, any `scheme://` prefix and `/path` suffix.
   * Examples: "1.2.3.4:9030" + "5.6.7.8" -> "5.6.7.8:9030"
   *           "http://old.host:8080/x" + "new.host" -> "http://new.host:8080/x"
   *           "" + "5.6.7.8" -> "5.6.7.8"
   */
  private mergeHostKeepingPort(existing: string, newHost: string): string {
    const trimmed = existing.trim();
    if (!trimmed) {
      return newHost;
    }
    const match = trimmed.match(/^(https?:\/\/)?([^:/]+)(:\d+)?(\/.*)?$/i);
    if (!match) {
      return newHost;
    }
    const [, schemePrefix = '', , port = '', pathSuffix = ''] = match;
    return `${schemePrefix}${newHost}${port}${pathSuffix}`;
  }

  /** Apply `protocol` to every configured endpoint row's http/https toggle,
   *  clearing each changed row's stale Test result/log exactly as if the
   *  user had clicked that row's own toggle (see setProtocolFor). */
  private applyProtocolToAllRows(protocol: 'http' | 'https'): void {
    for (const field of this.idolFields()) {
      if (this.protocolByKey[field.key] === protocol) {
        continue;
      }
      this.protocolByKey = { ...this.protocolByKey, [field.key]: protocol };
      this.verifyState = { ...this.verifyState, [field.key]: 'idle' };
      this.verifyMessage = { ...this.verifyMessage, [field.key]: '' };
      const nextVerifyUrl = { ...this.verifyUrl };
      delete nextVerifyUrl[field.key];
      this.verifyUrl = nextVerifyUrl;
      this.health.clearEndpointLog(field.key);
    }
    if (this.healthLog().length === 0) {
      this.logVisible.set(false);
    }
  }

  isOpen(): boolean {
    return this.open();
  }

  activeTab(): SettingsTab {
    return this.tab();
  }

  setTab(tab: SettingsTab, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.ui.setTab(tab);
    if (tab === 'application') {
      void this.openApplicationSettings(true);
    }
    if (tab === 'databases') {
      void this.refreshDatabases();
    }
  }

  close(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.ui.hide();
  }

  // --- Business ---
  conceptOperator(): ConceptOperator {
    return this.conceptSettings.operator();
  }

  summaryType(): SummaryType {
    return this.conceptSettings.summaryType();
  }

  summaryLength(): number {
    return this.conceptSettings.summaryLength();
  }

  setConceptOperator(op: ConceptOperator, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.conceptSettings.setOperator(op);
  }

  setSummaryType(st: SummaryType, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.conceptSettings.setSummaryType(st);
  }

  setSummaryLength(n: number, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.conceptSettings.setSummaryLength(n);
  }

  setRecommendationsEnabled(on: boolean, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.conceptSettings.setRecommendationsEnabled(on);
  }

  setRecommendationsOnHome(on: boolean, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.conceptSettings.setRecommendationsOnHome(on);
  }

  setExpertsSearchEnabled(on: boolean, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.conceptSettings.setExpertsSearchEnabled(on);
  }

  closeAndGo(event?: Event): void {
    this.ui.hide();
  }

  // --- Application ---
  fields(): readonly EndpointField[] {
    return this.appSettings.fields();
  }

  pathFields(): EndpointField[] {
    return this.fields().filter((f) => f.kind === 'path');
  }

  originFields(): EndpointField[] {
    return this.fields().filter((f) => f.kind === 'origin');
  }

  idolFields(): EndpointField[] {
    return this.fields().filter((f) => this.appSettings.isIdolField(f));
  }

  isNifiField(field: EndpointField): boolean {
    return this.appSettings.isNifiField(field);
  }

  defaultConfigFileName(): string {
    return this.appSettings.configFileName();
  }

  healthConfigFileName(): string {
    return this.health.configFileName();
  }

  healthConfigAssetPath(): string {
    return this.health.configAssetPath();
  }

  /** Fixed component path (e.g. /community) derived from the field default. */
  fixedPath(field: EndpointField): string {
    if (field.kind === 'origin') {
      return '';
    }
    return this.appSettings.pathOf(field.default) || '';
  }

  /** Protocol for a given row (defaults to https). */
  protocolFor(field: EndpointField): 'http' | 'https' {
    return this.protocolByKey[field.key] ?? 'https';
  }

  /** Default port from config.json `upstream` or endpoint-health testBase. */
  defaultPortFor(field: EndpointField): string {
    const fromUpstream = this.appSettings.portFromUpstream(field.upstream);
    if (fromUpstream) {
      return fromUpstream;
    }
    const testBase = this.health.testBaseFor(field.key);
    if (testBase) {
      try {
        return new URL(testBase).port || '';
      } catch {
        const m = testBase.match(/:(\d+)(?:\/|$)/);
        return m ? m[1] : '';
      }
    }
    return '';
  }

  /**
   * Split "host", "host:port", or "https://host:port/path" into hostname and port.
   * IPv6 in brackets is preserved on the host side.
   */
  private splitHostAndPort(raw: string): { host: string; port: string; path: string } {
    const trimmed = (raw ?? '').trim();
    if (!trimmed || trimmed.startsWith('/')) {
      return { host: '', port: '', path: trimmed.startsWith('/') ? trimmed : '' };
    }
    try {
      const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      const host = u.hostname.includes(':') ? `[${u.hostname}]` : u.hostname;
      const path = u.pathname && u.pathname !== '/' ? `${u.pathname}${u.search}` : u.search || '';
      return { host, port: u.port || '', path };
    } catch {
      const m = trimmed.match(/^(?:https?:\/\/)?(\[[^\]]+\]|[^:/]+)(?::(\d+))?(.*)?$/i);
      return {
        host: m?.[1] ?? trimmed,
        port: m?.[2] ?? '',
        path: m?.[3] ?? ''
      };
    }
  }

  isValidPort(port: string): boolean {
    const p = (port ?? '').trim();
    if (!p) {
      return true;
    }
    if (!/^\d{1,5}$/.test(p)) {
      return false;
    }
    const n = Number(p);
    return n >= 1 && n <= 65535;
  }

  /**
   * Host used for compose / persist / Test: hostname plus optional :port.
   * Origin rows may still carry a path suffix.
   */
  composedHost(field: EndpointField): string {
    const raw = (this.pathDraft[field.key] ?? '').trim();
    const { host, path } = this.splitHostAndPort(raw);
    const port = (this.portDraft[field.key] ?? '').trim();
    if (!host) {
      return '';
    }
    const hostPort = port && this.isValidPort(port) ? `${host}:${port}` : host;
    if (field.kind === 'origin' && path) {
      return `${hostPort}${path.startsWith('/') ? path : `/${path}`}`;
    }
    return hostPort;
  }

  onPortInput(field: EndpointField, value: string): void {
    const previous = (this.portDraft[field.key] ?? '').trim();
    const next = String(value ?? '').replace(/[^\d]/g, '').slice(0, 5);
    this.portDraft = { ...this.portDraft, [field.key]: next };
    if (this.isValidPort(next)) {
      delete this.portError[field.key];
    } else {
      this.portError = { ...this.portError, [field.key]: 'invalid' };
    }
    if (previous !== next) {
      this.clearRowVerify(field.key);
    }
  }

  private clearRowVerify(key: string): void {
    this.health.clearEndpointLog(key as EndpointKey);
    this.verifyState = { ...this.verifyState, [key]: 'idle' };
    this.verifyMessage = { ...this.verifyMessage, [key]: '' };
    const nextVerifyUrl = { ...this.verifyUrl };
    delete nextVerifyUrl[key];
    this.verifyUrl = nextVerifyUrl;
    if (this.healthLog().length === 0) {
      this.logVisible.set(false);
    }
  }

  setProtocolFor(field: EndpointField, protocol: 'http' | 'https', event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.protocolByKey[field.key] === protocol) {
      return; // no actual change — leave any existing Test result/log alone
    }
    this.protocolByKey = { ...this.protocolByKey, [field.key]: protocol };

    // Switching http/https changes the effective URL, so any prior Test
    // result for this endpoint no longer applies — clear it and its log
    // lines, same as resetField(), and hide the log section if nothing
    // else is left in it.
    this.verifyState = { ...this.verifyState, [field.key]: 'idle' };
    this.verifyMessage = { ...this.verifyMessage, [field.key]: '' };
    const nextVerifyUrl = { ...this.verifyUrl };
    delete nextVerifyUrl[field.key];
    this.verifyUrl = nextVerifyUrl;
    this.health.clearEndpointLog(field.key);
    if (this.healthLog().length === 0) {
      this.logVisible.set(false);
    }
  }

  previewFor(field: EndpointField): string {
    const host = this.composedHost(field);
    const proto = this.protocolFor(field);
    if (field.kind === 'origin') {
      if (!host) {
        return field.default || '—';
      }
      if (/^https?:\/\//i.test(host)) {
        return this.appSettings.replaceProtocol(host, proto);
      }
      return this.appSettings.composeUrl('', proto, host) || host;
    }
    const path = this.fixedPath(field);
    if (!host) {
      return path || '—';
    }
    return this.appSettings.composeUrl(path, proto, host) || path || '—';
  }

  isOverridden(field: EndpointField): boolean {
    const effective = this.appSettings.get(field.key);
    return effective !== field.default;
  }

  onPathInput(field: EndpointField, value: string): void {
    const previous = (this.pathDraft[field.key] ?? '').trim();
    const split = this.splitHostAndPort(value);
    // Keep a typed :port in the dedicated port box; host box stores hostname only
    // (origin rows keep a path suffix when present).
    if (split.port) {
      this.portDraft = { ...this.portDraft, [field.key]: split.port };
      delete this.portError[field.key];
      const hostOnly =
        field.kind === 'origin' && split.path
          ? `${split.host}${split.path.startsWith('/') ? split.path : `/${split.path}`}`
          : split.host;
      this.pathDraft[field.key] = hostOnly;
    } else {
      this.pathDraft[field.key] = value;
    }
    delete this.pathError[field.key];

    if (previous !== (this.pathDraft[field.key] ?? '').trim()) {
      this.clearRowVerify(field.key);
    }
  }

  resetField(field: EndpointField, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.appSettings.clearOverride(field.key);
    // Re-sync this field's textbox from the now-cleared effective value.
    // Stays empty for path-kind fields (their default is a same-origin
    // relative path with no host) rather than being pre-filled with a raw
    // test host — see defaultHostAndProtocolFor() for why.
    const { host, protocol } = this.defaultHostAndProtocolFor(field);
    const split = this.splitHostAndPort(
      field.kind === 'path' ? host : host || this.appSettings.get(field.key) || field.default
    );
    this.pathDraft[field.key] =
      field.kind === 'origin' && split.path
        ? `${split.host}${split.path}`
        : split.host;
    this.portDraft = {
      ...this.portDraft,
      [field.key]: split.port || this.defaultPortFor(field)
    };
    delete this.portError[field.key];
    this.protocolByKey = { ...this.protocolByKey, [field.key]: protocol };
    delete this.pathError[field.key];

    // Clear this endpoint's Test result/log so a stale "Not connected"
    // doesn't linger under the field it no longer applies to.
    this.health.clearEndpointLog(field.key);
    this.verifyState = { ...this.verifyState, [field.key]: 'idle' };
    this.verifyMessage = { ...this.verifyMessage, [field.key]: '' };
    const nextVerifyUrl = { ...this.verifyUrl };
    delete nextVerifyUrl[field.key];
    this.verifyUrl = nextVerifyUrl;
    // Hide the log section entirely if nothing else is left in it.
    if (this.healthLog().length === 0) {
      this.logVisible.set(false);
    }
  }

  resetAllApp(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    void this.resetAllFromDefaultFile();
  }

  private async resetAllFromDefaultFile(): Promise<void> {
    await this.appSettings.reloadDefaultsFromFile();
    this.health.clearTimeoutOverride();
    this.syncDraftsFromService();
    this.pathError = {};
    this.savedFlash = false;
    this.health.clearLog();
    this.logVisible.set(false);
  }

  applyHealthTimeout(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const seconds = Number(this.timeoutSecondsDraft);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : this.health.fileTimeoutMs();
    const applied = this.health.setTimeoutMs(ms);
    this.timeoutSecondsDraft = Math.round(applied / 1000);
    this.timeoutSavedFlash = true;
    setTimeout(() => (this.timeoutSavedFlash = false), 2000);
  }

  resetHealthTimeout(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    void this.openHealthFilePreview();
  }

  async openHealthFilePreview(): Promise<void> {
    this.healthFilePreviewError = '';
    this.healthFilePreviewPath = [
      this.health.configAssetPath(),
      'config/' + this.health.configFileName()
    ].join('  ·  ');
    // Open immediately so a slow or failed fetch (missing host / extra IP SAN
    // not on this machine) cannot block the preview dialog.
    this.healthFilePreviewJson = this.health.rawConfigJson();
    this.healthFilePreviewOpen = true;
    this.cdr.markForCheck();
    try {
      await this.health.ensureLoaded();
      this.healthFilePreviewJson = this.health.rawConfigJson();
      if (!this.healthFilePreviewJson) {
        this.healthFilePreviewError = 'Could not load ' + this.health.configFileName();
      }
    } catch (err) {
      if (!this.healthFilePreviewJson) {
        this.healthFilePreviewError =
          'Could not load ' + this.health.configFileName() +
          (err instanceof Error ? ' — ' + err.message : '');
      }
    }
    this.cdr.markForCheck();
  }

  closeHealthFilePreview(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.healthFilePreviewOpen = false;
  }

  saveApplication(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    const errors: Record<string, string> = {};
    const changedKeys: string[] = [];
    const previousValues: Record<string, string> = {};
    for (const field of this.fields()) {
      previousValues[field.key] = this.appSettings.get(field.key);
      const port = (this.portDraft[field.key] ?? '').trim();
      if (port && !this.isValidPort(port)) {
        errors[field.key] = 'invalid';
        this.portError = { ...this.portError, [field.key]: 'invalid' };
        continue;
      }
      const host = this.composedHost(field);
      const proto = this.protocolFor(field);
      if (!host) {
        this.appSettings.clearOverride(field.key);
        continue;
      }
      if (field.kind === 'path') {
        const path = this.fixedPath(field);
        const composed = this.appSettings.composeUrl(path, proto, host);
        if (!this.appSettings.isValid(composed) && !this.appSettings.isValid(path)) {
          errors[field.key] = 'invalid';
          continue;
        }
        this.appSettings.setOverride(field.key, composed);
      } else {
        let value = host;
        if (!/^https?:\/\//i.test(host) && !host.startsWith('/')) {
          value = this.appSettings.composeUrl('', proto, host);
        } else if (/^https?:\/\//i.test(host)) {
          value = this.appSettings.replaceProtocol(host, proto);
        }
        if (value && !this.appSettings.isValid(value) && !value.startsWith('/')) {
          errors[field.key] = 'invalid';
          continue;
        }
        this.appSettings.setOverride(field.key, value);
      }
    }
    this.pathError = errors;
    if (Object.keys(errors).length === 0) {
      // Reset only rows whose effective endpoint changed. This removes the old
      // green Connected message and verification result without touching other rows.
      for (const field of this.fields()) {
        const previous = previousValues[field.key];
        const current = this.appSettings.get(field.key);
        if (previous !== current) {
          changedKeys.push(field.key);
          this.health.clearEndpointLog(field.key);
          this.verifyState = { ...this.verifyState, [field.key]: 'idle' };
          this.verifyMessage = { ...this.verifyMessage, [field.key]: '' };
          this.verifyUrl = { ...this.verifyUrl };
          delete this.verifyUrl[field.key];
        }
      }

      this.applyHealthTimeout();
      this.savedFlash = true;
      setTimeout(() => (this.savedFlash = false), 2000);

      for (const field of this.fields()) {
        const port = (this.portDraft[field.key] ?? '').trim();
        if (port && this.isValidPort(port)) {
          this.appSettings.patchComponentPort(field.key, port);
          this.health.patchEndpointPort(field.key, port);
        }
      }

      // Keep config/config.json in sync with the host:port shown in Settings.
      void this.persistEndpointsToConfigJson();

      void this.verifyAll();
    }
  }

  /**
   * Push the current Settings host:port drafts into config.json so the
   * file on disk (upstreamHost + components[].upstream ports) matches the UI.
   */
  private async persistEndpointsToConfigJson(): Promise<void> {
    const components = this.fields().map((field) => {
      const raw = this.composedHost(field);
      const stripped = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      const portRaw = (this.portDraft[field.key] ?? '').trim();
      const portMatch = stripped.match(/:(\d+)$/);
      const port = portRaw && this.isValidPort(portRaw)
        ? Number(portRaw)
        : portMatch
          ? Number(portMatch[1])
          : undefined;
      const hostname = stripped.replace(/:\d+$/, '').split('/')[0];
      return {
        key: field.key,
        host: stripped,
        hostname,
        ...(port ? { port } : {}),
        protocol: this.protocolFor(field)
      };
    });
    const sharedHost = (this.upstreamHostDraft || '').trim();
    const result = await this.upstreamHostAdmin.persistEndpoints({
      host: sharedHost,
      protocol: this.upstreamHostProtocol,
      components
    });
    if (!result.ok && result.error) {
      this.upstreamHostAdmin.saveState.set('error');
      this.upstreamHostAdmin.saveMessage.set(result.error);
    } else if (result.ok) {
      this.upstreamHostAdmin.saveState.set('ok');
      this.upstreamHostAdmin.saveMessage.set(
        result.changed?.length
          ? `config.json updated (${result.changed.join(', ')}). Server restart required before the proxy uses the new host:port.`
          : 'config.json already matched the Settings host:port values. Server restart still required if the running proxy was started with old ports.'
      );
    }
  }

  /**
   * Download the current effective settings as a config.json an admin can
   * drop into config/config.json on the server. Save alone only writes to
   * this browser's localStorage — it never touches the file on disk.
   */
  exportConfig(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    try {
      const json = JSON.stringify(this.buildFullConfigSnapshot(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'config.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.health.appendLog('info', 'Exported full settings snapshot as config.json');
    } catch (err) {
      this.health.appendLog(
        'error',
        `Export config.json failed (${err instanceof Error ? err.message : String(err)})`
      );
    }
  }

  /** Live snapshot of every Settings value the app actually uses. */
  private buildFullConfigSnapshot(): Record<string, unknown> {
    const snap = this.appSettings.exportConfigSnapshot();
    const sharedHost = (this.upstreamHostDraft || '').trim();
    if (sharedHost) {
      snap['upstreamHost'] = sharedHost.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
    snap['protocol'] = this.upstreamHostProtocol || snap['protocol'] || 'https';

    const components = Array.isArray(snap['components'])
      ? [...(snap['components'] as Record<string, unknown>[])]
      : [];
    const byKey = new Map(components.map((c) => [String(c['key']), c]));
    for (const field of this.fields()) {
      const entry = byKey.get(field.key) ?? { key: field.key };
      const host = this.composedHost(field);
      const port = (this.portDraft[field.key] ?? '').trim();
      const proto = this.protocolFor(field);
      const preview = this.previewFor(field);
      entry['key'] = field.key;
      entry['label'] = field.label;
      entry['description'] = field.description;
      entry['family'] = field.family ?? entry['family'];
      entry['protocol'] = proto;
      if (host) {
        const hostname = host.replace(/^https?:\/\//i, '').split('/')[0].replace(/:\d+$/, '');
        entry['host'] = hostname;
      }
      if (port && this.isValidPort(port)) {
        entry['port'] = Number(port);
        const up = String(entry['upstream'] || field.upstream || field.key);
        entry['upstream'] = up.includes(':') ? up.replace(/:\d+\s*$/, `:${port}`) : `${up}:${port}`;
      } else if (field.upstream) {
        entry['upstream'] = field.upstream;
      }
      if (field.kind === 'origin') {
        entry['kind'] = 'origin';
        entry['path'] = '';
        if (preview && preview !== '—') {
          entry['absoluteDefault'] = preview;
        }
      } else {
        entry['path'] = this.fixedPath(field) || entry['path'] || this.appSettings.pathOf(field.default);
        if (preview && /^https?:\/\//i.test(preview)) {
          entry['absoluteDefault'] = preview;
        }
      }
      byKey.set(field.key, entry);
    }
    snap['components'] = this.fields().map((f) => byKey.get(f.key)).filter(Boolean);

    snap['business'] = {
      defaultOperator: this.conceptSettings.getOperator(),
      defaultSummaryType: this.conceptSettings.getSummaryType(),
      defaultSummaryLength: this.conceptSettings.getSummaryLength(),
      expertsSearch: this.conceptSettings.expertsSearchUserEnabled(),
      recommendations: this.conceptSettings.recommendationsUserEnabled(),
      recommendationsOnHome: this.conceptSettings.recommendationsOnHomeUserEnabled()
    };
    snap['localization'] = {
      defaultLanguage: this.i18n.lang(),
      enableRtlLanguages: this.i18n.enableRtlLanguages(),
      defaultTheme: this.themes.themeId(),
      customSwatches: { ...this.themes.customSwatches() }
    };
    snap['branding'] = {
      title: this.branding.title(),
      subtitle: this.branding.subtitle(),
      footerPrimary: this.branding.footerPrimary(),
      footerPowered: this.branding.footerPowered(),
      logo: this.branding.logoUrl()
    };
    snap['health'] = {
      timeoutMs: this.health.timeoutMs()
    };
    return snap;
  }

  /**
   * Open a file picker for a previously exported (or server) config.json
   * and load its values into this browser session.
   */
  importConfig(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const input = this.configFileInput?.nativeElement;
    if (!input) {
      this.health.appendLog('error', 'Import config.json: file picker is not available.');
      return;
    }
    input.value = '';
    input.click();
  }

  onConfigFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    void this.loadImportedConfigFile(file);
  }

  private async loadImportedConfigFile(file: File): Promise<void> {
    this.logVisible.set(true);
    this.health.appendLog('info', `Import config.json: reading ${file.name} (${file.size} bytes)`);
    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.health.appendLog('error', `Import config.json failed — invalid JSON (${msg})`);
      return;
    }

    const result = this.appSettings.importConfigSnapshot(
      parsed as Parameters<AppSettingsService['importConfigSnapshot']>[0]
    );
    if (!result.ok) {
      this.health.appendLog('error', `Import config.json failed — ${result.error}`);
      return;
    }

    this.health.appendLog(
      'ok',
      `Import config.json applied (${result.processed.length} endpoints from ${file.name})`
    );
    for (const ep of result.processed) {
      this.health.appendLog(
        'info',
        `Processing endpoint ${ep.label} (${ep.key}): loaded value ${ep.value || '(empty)'}`
      );
    }

    this.applyImportedAppSettings(parsed as Record<string, unknown>);
    this.syncDraftsFromService();
    this.applyImportedEndpointDrafts(parsed as Record<string, unknown>);
    this.pathError = {};
    this.savedFlash = true;
    setTimeout(() => (this.savedFlash = false), 2000);
    this.saveApplication();
    void this.verifyAll();
  }

  /** Push imported business / localization / branding / health into live services. */
  private applyImportedAppSettings(cfg: Record<string, unknown>): void {
    const business = (cfg['business'] ?? {}) as Record<string, unknown>;
    this.conceptSettings.applyFromConfig({
      defaultOperator: typeof business['defaultOperator'] === 'string' ? business['defaultOperator'] : undefined,
      defaultSummaryType:
        typeof business['defaultSummaryType'] === 'string' ? business['defaultSummaryType'] : undefined,
      defaultSummaryLength:
        typeof business['defaultSummaryLength'] === 'number' ? business['defaultSummaryLength'] : undefined,
      expertsSearch: typeof business['expertsSearch'] === 'boolean' ? business['expertsSearch'] : undefined,
      recommendations: typeof business['recommendations'] === 'boolean' ? business['recommendations'] : undefined,
      recommendationsOnHome:
        typeof business['recommendationsOnHome'] === 'boolean' ? business['recommendationsOnHome'] : undefined
    });

    const loc = (cfg['localization'] ?? {}) as Record<string, unknown>;
    if (typeof loc['enableRtlLanguages'] === 'boolean') {
      this.i18n.setEnableRtlLanguages(loc['enableRtlLanguages']);
    }
    if (typeof loc['defaultLanguage'] === 'string') {
      this.i18n.setLanguage(loc['defaultLanguage'] as LangCode);
    }
    const swatches = loc['customSwatches'];
    if (swatches && typeof swatches === 'object') {
      this.themes.setCustomSwatches(swatches as ThemeSwatches, loc['defaultTheme'] === 'custom');
      this.customDraft = { ...this.themes.customSwatches() };
    }
    if (typeof loc['defaultTheme'] === 'string') {
      this.themes.setTheme(loc['defaultTheme'] as ThemeId);
    }

    const branding = (cfg['branding'] ?? {}) as Record<string, unknown>;
    if (typeof branding['title'] === 'string') {
      this.branding.setTitle(branding['title']);
      this.titleDraft = this.branding.title();
    }
    if (typeof branding['subtitle'] === 'string') {
      this.branding.setSubtitle(branding['subtitle']);
      this.subtitleDraft = this.branding.subtitle();
    }
    if (typeof branding['footerPrimary'] === 'string') {
      this.branding.setFooterPrimary(branding['footerPrimary']);
      this.footerPrimaryDraft = this.branding.footerPrimary();
    }
    if (typeof branding['footerPowered'] === 'string') {
      this.branding.setFooterPowered(branding['footerPowered']);
      this.footerPoweredDraft = this.branding.footerPowered();
    }
    if ('logo' in branding) {
      this.branding.applyLogo(typeof branding['logo'] === 'string' ? branding['logo'] : null);
    }

    const health = (cfg['health'] ?? {}) as Record<string, unknown>;
    if (typeof health['timeoutMs'] === 'number') {
      this.health.setTimeoutMs(health['timeoutMs']);
      this.timeoutSecondsDraft = Math.round(this.health.timeoutMs() / 1000);
    }

    if (typeof cfg['upstreamHost'] === 'string') {
      this.upstreamHostDraft = String(cfg['upstreamHost']).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
    if (cfg['protocol'] === 'http' || cfg['protocol'] === 'https') {
      this.upstreamHostProtocol = cfg['protocol'];
    }
  }

  private applyImportedEndpointDrafts(cfg: Record<string, unknown>): void {
    const components = Array.isArray(cfg['components']) ? (cfg['components'] as Record<string, unknown>[]) : [];
    for (const c of components) {
      const key = String(c['key'] || '');
      const field = this.fields().find((f) => f.key === key);
      if (!field) continue;
      if (c['protocol'] === 'http' || c['protocol'] === 'https') {
        this.protocolByKey = { ...this.protocolByKey, [key]: c['protocol'] };
      }
      const port = c['port'] != null ? String(c['port']).trim() : '';
      if (port && this.isValidPort(port)) {
        this.portDraft = { ...this.portDraft, [key]: port };
        this.health.patchEndpointPort(key, port);
      }
      const host = typeof c['host'] === 'string' ? c['host'].trim() : '';
      if (host) {
        this.pathDraft[key] = host.replace(/^https?:\/\//i, '').replace(/:\d+$/, '');
      }
    }
  }

  /**
   * Parse an effective URL into host (no scheme) and protocol.
   * For pure paths returns empty host and https.
   */
  private parseHostAndProtocol(
    url: string,
    keepPath = false
  ): { host: string; protocol: 'http' | 'https' } {
    const raw = (url ?? '').trim();
    if (!raw || raw.startsWith('/')) {
      return { host: '', protocol: 'https' };
    }
    try {
      const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
      const protocol = u.protocol === 'http:' ? 'http' : 'https';
      const path = keepPath
        ? u.pathname && u.pathname !== '/'
          ? `${u.pathname}${u.search}`
          : u.search || ''
        : '';
      return { host: `${u.host}${path}`, protocol };
    } catch {
      return { host: raw.replace(/^https?:\/\//i, ''), protocol: /^http:/i.test(raw) ? 'http' : 'https' };
    }
  }

  /**
   * Resolve the host/protocol to show in a field's textbox: the user's
   * saved override if any, else — only when the field's own default is
   * already an absolute URL (e.g. viewUpstreamOrigin) — that host.
   *
   * Deliberately does NOT fall back to endpoint-health.json's `testBase`
   * anymore. That JSON value is a raw, unproxied host meant only for the
   * Test button's own probe (which already has its own fallback — see
   * verifyStatus()); pre-filling the textbox with it meant an untouched
   * Save (after just opening Settings, after Reset, or after Reset all)
   * silently created a direct-to-upstream override that bypasses the
   * app's own proxy — the exact cause of the AnswerServer 404 / "0
   * Unknown Error" failures. Leaving the box genuinely empty here means
   * Save keeps the field on its safe, proxied relative default until the
   * user deliberately types a host.
   */
  private defaultHostAndProtocolFor(field: EndpointField): { host: string; protocol: 'http' | 'https' } {
    const effective = this.appSettings.get(field.key);
    return this.parseHostAndProtocol(effective || field.default, field.kind === 'origin');
  }

  private syncDraftsFromService(): void {
    const draft: Record<string, string> = {};
    const ports: Record<string, string> = {};
    const protos: Record<string, 'http' | 'https'> = {};
    for (const field of this.appSettings.fields()) {
      const effective = this.appSettings.get(field.key);
      const { host, protocol } = this.defaultHostAndProtocolFor(field);
      const raw =
        field.kind === 'path'
          ? host
          : host ||
            (effective && !effective.startsWith('/')
              ? effective.replace(/^https?:\/\//i, '')
              : '');
      const split = this.splitHostAndPort(raw);
      draft[field.key] =
        field.kind === 'origin' && split.path
          ? `${split.host}${split.path}`
          : split.host;
      ports[field.key] = split.port || this.defaultPortFor(field);
      protos[field.key] = protocol;
    }
    this.pathDraft = draft;
    this.portDraft = ports;
    this.portError = {};
    this.protocolByKey = protos;
    this.timeoutSecondsDraft = Math.round(this.health.timeoutMs() / 1000);
  }

  // --- Localization ---
  selectLanguage(code: LangCode, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.i18n.setLanguage(code);
  }

  setEnableRtl(enabled: boolean, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.i18n.setEnableRtlLanguages(enabled);
  }

  selectTheme(id: ThemeId, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.themes.setTheme(id);
    if (id === 'custom') {
      this.customDraft = { ...this.themes.customSwatches() };
    }
  }

  onCustomColor(key: keyof ThemeSwatches, value: string): void {
    this.customDraft = { ...this.customDraft, [key]: value };
  }

  async refreshDatabases(event?: Event, force = !!event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    const gen = ++this.databasesListGen;
    this.databasesLoading = true;
    this.databasesError = '';
    this.databasesMessage = '';
    this.cdr.markForCheck();
    try {
      const result = await this.idolDatabases.listDatabases(force);
      if (gen !== this.databasesListGen) return;
      this.contentDatabases = result.databases;
      if (result.ok) {
        // Live catalog stays in memory. Persisting to assets/config while
        // ng serve is running full-reloads the SPA every few seconds.
        this.config.refreshDatabases().subscribe();
      }
      if (!result.ok) {
        this.databasesError = result.error || 'Could not list databases.';
      } else if (result.databases.length === 0) {
        this.databasesMessage = 'No databases were returned by the Content component.';
      }
    } catch (err) {
      if (gen !== this.databasesListGen) return;
      this.databasesError = err instanceof Error ? err.message : 'Could not list databases.';
    } finally {
      if (gen === this.databasesListGen) {
        this.databasesLoading = false;
      }
      this.cdr.markForCheck();
    }
  }

  async createDatabase(event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    const name = this.idolDatabases.sanitizeName(this.newDatabaseName);
    if (!name) {
      this.databasesError = 'Enter a database name using letters, numbers, or underscore.';
      return;
    }
    this.databasesBusy = true;
    this.databasesError = '';
    this.databasesMessage = '';
    this.cdr.markForCheck();
    try {
      const result = await this.idolDatabases.createDatabase(name);
      if (!result.ok) {
        this.databasesError = result.error || 'Could not create the database.';
        return;
      }
      this.newDatabaseName = '';
      this.databasesMessage = `Created database “${result.name}”.`;
      await this.refreshDatabases(undefined, true);
      this.config.refreshDatabases().subscribe((file) => {
        void this.upstreamHostAdmin.persistDatabases(file);
      });
      if (!this.databasesError) {
        this.databasesMessage = `Created database “${result.name}”.`;
      }
    } catch (err) {
      this.databasesError = err instanceof Error ? err.message : 'Could not create the database.';
    } finally {
      this.databasesBusy = false;
      this.databasesLoading = false;
      this.cdr.markForCheck();
    }
  }

  applyCustomTheme(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.themes.setCustomSwatches(this.customDraft, true);
    this.customDraft = { ...this.themes.customSwatches() };
  }

  resetCustomTheme(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.themes.resetCustom();
    this.customDraft = { ...this.themes.customSwatches() };
  }






  saveSubtitle(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.branding.setSubtitle(this.subtitleDraft);
    this.subtitleDraft = this.branding.subtitle();
  }

  saveFooterCopy(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.branding.setFooterPrimary(this.footerPrimaryDraft);
    this.branding.setFooterPowered(this.footerPoweredDraft);
    this.footerPrimaryDraft = this.branding.footerPrimary();
    this.footerPoweredDraft = this.branding.footerPowered();
  }

  resetFooterCopy(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.branding.resetFooterPrimary();
    this.branding.resetFooterPowered();
    this.branding.resetSubtitle();
    this.footerPrimaryDraft = this.branding.footerPrimary();
    this.footerPoweredDraft = this.branding.footerPowered();
    this.subtitleDraft = this.branding.subtitle();
  }

  /**
   * Apply All (Localization tab): persists every draft value in this tab in
   * one action. Deliberately does NOT close the popup — apply and close are
   * separate concerns. The user reviews the applied values and keeps making
   * changes; the popup only closes via the explicit Close / X / Escape
   * controls (see `close()` and the `document:keydown.escape` handler).
   */
  applyLocalization(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.branding.setTitle(this.titleDraft);
    this.branding.setSubtitle(this.subtitleDraft);
    this.branding.setFooterPrimary(this.footerPrimaryDraft);
    this.branding.setFooterPowered(this.footerPoweredDraft);
    this.titleDraft = this.branding.title();
    this.subtitleDraft = this.branding.subtitle();
    this.footerPrimaryDraft = this.branding.footerPrimary();
    this.footerPoweredDraft = this.branding.footerPowered();
    this.themes.setCustomSwatches(this.customDraft, this.themes.themeId() === 'custom');
    this.customDraft = { ...this.themes.customSwatches() };
    // Popup intentionally stays open — no this.ui.hide() here.
  }

  saveTitle(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.branding.setTitle(this.titleDraft);
    this.titleDraft = this.branding.title();
  }

  resetTitle(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.branding.resetTitle();
    this.titleDraft = this.branding.title();
  }




  /** True when endpoint-health.json provides a real probe URL for this key. */
  canAutoTest(fieldKey: string): boolean {
    if (this.health.testUrlFor(fieldKey) || this.health.testBaseFor(fieldKey)) {
      return true;
    }
    // Optional endpoints without testBase (e.g. gatewayOrigin) are not auto-tested
    if (this.health.isOptional(fieldKey)) {
      return false;
    }
    return true;
  }

  verifyStatus(fieldKey: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const field = this.fields().find((f) => f.key === fieldKey);
    if (!field) {
      return;
    }
    // Do not write config.json on Test. Persist only on Save / Apply to all.
    // Writing src/assets/config.json here made Vite full-reload the SPA,
    // which blinked the login card every time Settings opened and auto-tested.
    // Skip optional endpoints with no configured probe (gatewayOrigin, etc.)
    if (!this.canAutoTest(fieldKey)) {
      this.verifyState = { ...this.verifyState, [fieldKey]: 'skipped' };
      this.verifyMessage = {
        ...this.verifyMessage,
        [fieldKey]: 'Skipped (optional — no test URL)'
      };
      return;
    }
    // Prefer draft value so user can test before Save.
    //
    // IMPORTANT: when the IP/FQDN textbox has NOT been changed (host is
    // empty), leave `base` empty rather than falling back to the field's
    // relative default path (e.g. '/community'). A relative value can't be
    // turned into an absolute probe target, which is what was sending
    // '/__kd-probe' requests with an invalid target and landing on the
    // http://127.0.0.1:9 fallback (ECONNREFUSED). An empty `base` makes
    // EndpointHealthService.statusUrl() fall through to the absolute
    // testUrl/testBase already defined in endpoint-health.json — i.e. the
    // same target/test values shipped in proxy.conf.json for this service.
    // When the user HAS typed a new host, build the probe from that value.
    const host = this.composedHost(field);
    const proto = this.protocolFor(field);
    const port = (this.portDraft[field.key] ?? '').trim();
    let base: string;
    if (field.kind === 'path') {
      const path = this.fixedPath(field) || this.appSettings.pathOf(field.default);
      base = host ? (this.appSettings.composeUrl(path, proto, host) || path) : '';
    } else {
      if (host) {
        if (/^https?:\/\//i.test(host)) {
          base = host.replace(/^https?:\/\//i, `${proto}://`);
        } else {
          base = this.appSettings.composeUrl('', proto, host) || host;
        }
      } else {
        const def = field.default || this.appSettings.get(field.key);
        base = /^https?:\/\//i.test(def) ? def : '';
      }
    }
    // Port-only edit with no host: rewrite the health testBase port so Test
    // still hits the service the user just typed.
    if (!host && port && this.isValidPort(port)) {
      const testBase = this.health.testBaseFor(field.key);
      if (testBase) {
        try {
          const u = new URL(testBase);
          u.port = port;
          base = u.origin;
        } catch {
          base = testBase.replace(/:\d+(?=\/|$)/, `:${port}`);
        }
      }
    }
    this.verifyState = { ...this.verifyState, [fieldKey]: 'checking' };
    this.verifyMessage = { ...this.verifyMessage, [fieldKey]: '' };
    this.logVisible.set(true);
    void this.health.verify(base, field.key as never).then((result) => {
      this.verifyState = { ...this.verifyState, [fieldKey]: result.state };
      this.verifyMessage = {
        ...this.verifyMessage,
        [fieldKey]: result.message || ''
      };
      if (result.url) {
        this.verifyUrl = { ...this.verifyUrl, [fieldKey]: result.url };
      }
    });
  }


  downloadHealthLog(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.health.downloadLog('endpoint-health.log');
  }

  clearHealthLog(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.health.clearLog();
    // Only clear the log list itself. Unlike Reset / protocol toggle
    // (where hiding is a side effect of the row no longer having
    // anything to report), an explicit Clear here leaves the log
    // section visible, now showing its empty state.
  }

  verifyIcon(fieldKey: string): string {
    switch (this.verifyState[fieldKey]) {
      case 'checking':
        return '…';
      case 'ok':
        return '✓';
      case 'error':
        return '✕';
      case 'skipped':
        return '–';
      default:
        return '○';
    }
  }


  /**
   * Run Test on every configured endpoint (same as clicking all Test buttons).
   * Triggered when Settings opens or Application tab is selected.
   */
  async autoVerifyAllEndpoints(): Promise<void> {
    if (this.autoVerifyRunning) {
      return;
    }
    this.autoVerifyRunning = true;
    try {
      await this.health.ensureLoaded();
      for (const field of this.fields()) {
        if (!this.canAutoTest(field.key)) {
          this.verifyState = { ...this.verifyState, [field.key]: 'skipped' };
          this.verifyMessage = {
            ...this.verifyMessage,
            [field.key]: 'Skipped (optional — no test URL)'
          };
          continue;
        }
        this.verifyStatus(field.key);
        await new Promise((r) => setTimeout(r, 120));
      }
    } finally {
      setTimeout(() => {
        this.autoVerifyRunning = false;
      }, 500);
    }
  }

  async verifyAll(event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    for (const field of this.fields()) {
      if (!this.canAutoTest(field.key)) {
        this.verifyState = { ...this.verifyState, [field.key]: 'skipped' };
        this.verifyMessage = {
          ...this.verifyMessage,
          [field.key]: 'Skipped (optional — no test URL)'
        };
        continue;
      }
      this.verifyStatus(field.key);
      // small stagger to avoid bursting
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  // --- Branding / logo ---
  async onLogoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.logoError = null;
    this.logoOk = false;
    const result = await this.branding.importFile(file);
    // allow re-selecting the same file
    input.value = '';
    if (!result.ok) {
      this.logoError = result.reason;
      return;
    }
    this.logoOk = true;
    setTimeout(() => (this.logoOk = false), 2000);
  }

  clearLogo(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.branding.clearLogo();
    this.logoError = null;
    this.logoOk = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.healthFilePreviewOpen) {
      this.healthFilePreviewOpen = false;
      return;
    }
    if (this.open()) {
      this.ui.hide();
    }
  }
}
