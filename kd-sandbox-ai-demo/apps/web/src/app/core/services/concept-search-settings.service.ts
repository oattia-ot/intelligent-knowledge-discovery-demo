import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ConfigService } from './config.service';

/** Operators used between multi-concept tags (IDOL boolean / proximity). */
export type ConceptOperator = 'AND' | 'OR' | 'YNEAR' | 'WNEAR' | 'DNEAR' | 'NEAR';

/**
 * IDOL Query `Summary` parameter values (snippet generation).
 * @see Content Query Summary / Characters
 */
export type SummaryType =
  | 'Context'
  | 'Concept'
  | 'Quick'
  | 'Paragraph'
  | 'Sentence'
  | 'Off';

export const CONCEPT_OPERATORS: readonly ConceptOperator[] = [
  'AND',
  'OR',
  'YNEAR',
  'WNEAR',
  'DNEAR',
  'NEAR'
] as const;

export const SUMMARY_TYPES: readonly SummaryType[] = [
  'Context',
  'Concept',
  'Quick',
  'Paragraph',
  'Sentence',
  'Off'
] as const;

/** Suggested character lengths for result snippets. */
export const SUMMARY_LENGTH_OPTIONS: readonly number[] = [
  50, 100, 150, 200, 300, 400, 500, 800
] as const;

const OPERATOR_KEY = 'kd_concept_operator';
const SUMMARY_TYPE_KEY = 'kd_summary_type';
const SUMMARY_LENGTH_KEY = 'kd_summary_length';
const EXPERTS_SEARCH_KEY = 'kd_experts_search';
const RECS_ENABLED_KEY = 'kd_recommendations';
const RECS_ON_HOME_KEY = 'kd_recommendations_home';

/**
 * Shared search settings (multi-concept operator + result summary + experts).
 * `/settings` writes; SearchService / Search page read.
 */
@Injectable({ providedIn: 'root' })
export class ConceptSearchSettingsService {
  private readonly config = inject(ConfigService);

  readonly operators = CONCEPT_OPERATORS;
  readonly summaryTypes = SUMMARY_TYPES;
  readonly summaryLengthOptions = SUMMARY_LENGTH_OPTIONS;

  private readonly _operator = signal<ConceptOperator>(this.loadOperator());
  readonly operator = this._operator.asReadonly();

  private readonly _summaryType = signal<SummaryType>(this.loadSummaryType());
  readonly summaryType = this._summaryType.asReadonly();

  private readonly _summaryLength = signal<number>(this.loadSummaryLength());
  readonly summaryLength = this._summaryLength.asReadonly();

  private readonly _settingsOpen = signal(false);
  readonly settingsOpen = this._settingsOpen.asReadonly();

  /** Last Text after QMS ExpandQuery — Settings → Troubleshooting. */
  private readonly _lastExpandedQuery = signal('');
  readonly lastExpandedQuery = this._lastExpandedQuery.asReadonly();

  setLastExpandedQuery(text: string): void {
    this._lastExpandedQuery.set((text ?? '').trim());
  }

  /**
   * Admin gate from `expertise.json` → `enabled`.
   * `null` until the file has loaded (do not show expert UI yet).
   */
  private readonly _expertsFeatureAvailable = signal<boolean | null>(null);
  readonly expertsFeatureAvailable = computed(
    () => this._expertsFeatureAvailable() === true
  );
  readonly expertsConfigReady = computed(
    () => this._expertsFeatureAvailable() !== null
  );

  /** User preference from Settings (sessionStorage). Default off. */
  private readonly _expertsSearchUserEnabled = signal<boolean>(this.loadExpertsSearch());
  readonly expertsSearchUserEnabled = this._expertsSearchUserEnabled.asReadonly();

  /**
   * Effective experts search: JSON allows it and Settings is On.
   * When false, hide every experts control except the Settings On/Off
   * (and hide that too when JSON `enabled` is false).
   */
  readonly expertsEnabled = computed(
    () => this.expertsFeatureAvailable() && this._expertsSearchUserEnabled()
  );

  /**
   * Admin gate from `recommendations.json` → `enabled` (default true).
   * `null` until the file has loaded.
   */
  private readonly _recommendationsFeatureAvailable = signal<boolean | null>(null);
  readonly recommendationsFeatureAvailable = computed(
    () => this._recommendationsFeatureAvailable() === true
  );

  /** JSON default for the home panel (`showOnHome`, default true). */
  private readonly _recommendationsShowOnHomeDefault = signal(true);

  /** User preference from Settings (sessionStorage). Default on. */
  private readonly _recommendationsUserEnabled = signal<boolean>(this.loadRecommendationsEnabled());
  readonly recommendationsUserEnabled = this._recommendationsUserEnabled.asReadonly();

  /**
   * Home-panel preference. `null` means use JSON `showOnHome`.
   */
  private readonly _recommendationsOnHomeUser = signal<boolean | null>(
    this.loadRecommendationsOnHome()
  );
  readonly recommendationsOnHomeUserEnabled = computed(() => {
    const user = this._recommendationsOnHomeUser();
    return user === null ? this._recommendationsShowOnHomeDefault() : user;
  });

  /**
   * Effective recommendations: JSON allows it and Settings is On.
   * When false, hide the header link, home panel, and `/recommendations`.
   */
  readonly recommendationsEnabled = computed(
    () => this.recommendationsFeatureAvailable() && this._recommendationsUserEnabled()
  );

  /** Home (landing) panel: feature on and “show on home” on. */
  readonly recommendationsOnHome = computed(
    () => this.recommendationsEnabled() && this.recommendationsOnHomeUserEnabled()
  );

  private readonly expertsFeatureReady$ = this.config.getExpertiseConfig().pipe(
    tap((cfg) => this._expertsFeatureAvailable.set(cfg.enabled === true)),
    map(() => undefined as void),
    catchError(() => {
      this._expertsFeatureAvailable.set(false);
      return of(undefined as void);
    }),
    shareReplay(1)
  );

  private readonly recommendationsFeatureReady$ = this.config.getRecommendationsConfig().pipe(
    tap((cfg) => {
      this._recommendationsFeatureAvailable.set(cfg.enabled !== false);
      this._recommendationsShowOnHomeDefault.set(cfg.showOnHome !== false);
    }),
    map(() => undefined as void),
    catchError(() => {
      this._recommendationsFeatureAvailable.set(true);
      this._recommendationsShowOnHomeDefault.set(true);
      return of(undefined as void);
    }),
    shareReplay(1)
  );

  /** Fired when any setting that affects Query results changes. */
  private settingsChangeHandler: (() => void) | null = null;
  private expertsEnabledChangeHandler: (() => void) | null = null;

  constructor() {
    this.expertsFeatureReady$.subscribe();
    this.recommendationsFeatureReady$.subscribe();
  }

  /** Resolves after `expertise.json` has been read (or failed). */
  whenExpertsFeatureReady(): Observable<void> {
    return this.expertsFeatureReady$;
  }

  /** Resolves after `recommendations.json` has been read (or failed). */
  whenRecommendationsFeatureReady(): Observable<void> {
    return this.recommendationsFeatureReady$;
  }

  getOperator(): ConceptOperator {
    return this._operator();
  }

  setOperator(op: ConceptOperator): void {
    if (!CONCEPT_OPERATORS.includes(op)) {
      return;
    }
    if (this._operator() === op) {
      return;
    }
    this._operator.set(op);
    this.persist(OPERATOR_KEY, op);
    this.settingsChangeHandler?.();
  }

  getSummaryType(): SummaryType {
    return this._summaryType();
  }

  setSummaryType(type: SummaryType): void {
    if (!SUMMARY_TYPES.includes(type)) {
      return;
    }
    if (this._summaryType() === type) {
      return;
    }
    this._summaryType.set(type);
    this.persist(SUMMARY_TYPE_KEY, type);
    this.settingsChangeHandler?.();
  }

  getSummaryLength(): number {
    return this._summaryLength();
  }

  setSummaryLength(length: number): void {
    const n = Math.floor(Number(length));
    if (!Number.isFinite(n) || n < 20 || n > 5000) {
      return;
    }
    if (this._summaryLength() === n) {
      return;
    }
    this._summaryLength.set(n);
    this.persist(SUMMARY_LENGTH_KEY, String(n));
    this.settingsChangeHandler?.();
  }

  getExpertsSearchEnabled(): boolean {
    return this.expertsEnabled();
  }

  setExpertsSearchEnabled(on: boolean): void {
    if (!this.expertsFeatureAvailable()) {
      return;
    }
    if (this._expertsSearchUserEnabled() === on) {
      return;
    }
    this._expertsSearchUserEnabled.set(on);
    this.persist(EXPERTS_SEARCH_KEY, on ? 'true' : 'false');
    this.expertsEnabledChangeHandler?.();
  }

  setRecommendationsEnabled(on: boolean): void {
    if (!this.recommendationsFeatureAvailable()) {
      return;
    }
    if (this._recommendationsUserEnabled() === on) {
      return;
    }
    this._recommendationsUserEnabled.set(on);
    this.persist(RECS_ENABLED_KEY, on ? 'true' : 'false');
  }

  toggleSettings(): void {
    this._settingsOpen.update((v) => !v);
  }

  openSettings(): void {
    this._settingsOpen.set(true);
  }

  closeSettings(): void {
    this._settingsOpen.set(false);
  }

  /** Apply business prefs from an imported config.json (no feature-gate skip). */
  applyFromConfig(prefs: {
    defaultOperator?: string;
    defaultSummaryType?: string;
    defaultSummaryLength?: number;
    expertsSearch?: boolean;
    recommendations?: boolean;
    recommendationsOnHome?: boolean;
  }): void {
    if (prefs.defaultOperator && (CONCEPT_OPERATORS as readonly string[]).includes(prefs.defaultOperator)) {
      this._operator.set(prefs.defaultOperator as ConceptOperator);
      this.persist(OPERATOR_KEY, prefs.defaultOperator);
    }
    if (prefs.defaultSummaryType && (SUMMARY_TYPES as readonly string[]).includes(prefs.defaultSummaryType)) {
      this._summaryType.set(prefs.defaultSummaryType as SummaryType);
      this.persist(SUMMARY_TYPE_KEY, prefs.defaultSummaryType);
    }
    if (typeof prefs.defaultSummaryLength === 'number') {
      this.setSummaryLength(prefs.defaultSummaryLength);
    }
    if (typeof prefs.expertsSearch === 'boolean') {
      this._expertsSearchUserEnabled.set(prefs.expertsSearch);
      this.persist(EXPERTS_SEARCH_KEY, prefs.expertsSearch ? 'true' : 'false');
      this.expertsEnabledChangeHandler?.();
    }
    if (typeof prefs.recommendations === 'boolean') {
      this._recommendationsUserEnabled.set(prefs.recommendations);
      this.persist(RECS_ENABLED_KEY, prefs.recommendations ? 'true' : 'false');
    }
    if (typeof prefs.recommendationsOnHome === 'boolean') {
      this._recommendationsOnHomeUser.set(prefs.recommendationsOnHome);
      this.persist(RECS_ON_HOME_KEY, prefs.recommendationsOnHome ? 'true' : 'false');
    }
    this.settingsChangeHandler?.();
  }

  setRecommendationsOnHome(on: boolean): void {
    if (!this.recommendationsFeatureAvailable()) {
      return;
    }
    if (this.recommendationsOnHomeUserEnabled() === on) {
      return;
    }
    this._recommendationsOnHomeUser.set(on);
    this.persist(RECS_ON_HOME_KEY, on ? 'true' : 'false');
  }

  /**
   * Search page registers a handler to re-query when settings change.
   */
  onSettingsChange(handler: (() => void) | null): void {
    this.settingsChangeHandler = handler;
  }

  /**
   * Search / home register to hide or restore experts UI without re-querying hits.
   */
  onExpertsEnabledChange(handler: (() => void) | null): void {
    this.expertsEnabledChangeHandler = handler;
  }

  /** @deprecated use onSettingsChange */
  onOperatorChange(handler: (() => void) | null): void {
    this.onSettingsChange(handler);
  }

  private loadOperator(): ConceptOperator {
    const raw = this.read(OPERATOR_KEY);
    if (raw && (CONCEPT_OPERATORS as readonly string[]).includes(raw)) {
      return raw as ConceptOperator;
    }
    return 'AND';
  }

  private loadSummaryType(): SummaryType {
    const raw = this.read(SUMMARY_TYPE_KEY);
    if (raw && (SUMMARY_TYPES as readonly string[]).includes(raw)) {
      return raw as SummaryType;
    }
    return 'Context';
  }

  private loadSummaryLength(): number {
    const raw = this.read(SUMMARY_LENGTH_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 20 && n <= 5000) {
        return Math.floor(n);
      }
    }
    const envDefault = Number(environment.summaryContextLength);
    return Number.isFinite(envDefault) && envDefault > 0 ? envDefault : 200;
  }

  private loadExpertsSearch(): boolean {
    const raw = this.read(EXPERTS_SEARCH_KEY);
    // Default off. Only an explicit session value of "true" turns it on.
    // Clear sessionStorage.kd_experts_search to reset a previous On.
    return raw === 'true';
  }

  private loadRecommendationsEnabled(): boolean {
    const raw = this.read(RECS_ENABLED_KEY);
    if (raw === 'false') {
      return false;
    }
    return true;
  }

  /** `null` = no session override; use JSON `showOnHome`. */
  private loadRecommendationsOnHome(): boolean | null {
    const raw = this.read(RECS_ON_HOME_KEY);
    if (raw === 'false') {
      return false;
    }
    if (raw === 'true') {
      return true;
    }
    return null;
  }

  private read(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private persist(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }
}
