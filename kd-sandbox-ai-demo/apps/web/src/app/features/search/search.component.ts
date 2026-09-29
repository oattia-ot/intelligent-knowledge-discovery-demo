import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MarkdownPipe } from '../../shared/pipes/markdown.pipe';
import { WaitIndicatorComponent } from '../../shared/components/wait-indicator/wait-indicator.component';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, forkJoin, from, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ConfigService, DatabaseConfig } from '../../core/services/config.service';
import {
  IdolDatabaseListResult,
  IdolDatabasesService
} from '../../core/services/idol-databases.service';
import { AuthService } from '../../core/services/auth.service';
import { SearchService } from '../../core/services/search.service';
import { ResultUrlService } from '../../core/services/result-url.service';
import {
  TypeaheadService,
  TypeaheadSuggestion
} from '../../core/services/typeahead.service';
import { AqgService, AqgNode, AqgTerm } from '../../core/services/aqg.service';
import { ConceptSearchSettingsService } from '../../core/services/concept-search-settings.service';
import { ExpertiseService } from '../../core/services/expertise.service';
import { SearchInitService } from '../../core/services/search-init.service';
import {
  AnswerHit,
  AnswerService,
  AnswerSource,
  fallbackTitleFromReference,
  isUsableSourceTitle
} from '../../core/services/answer.service';
import { ViewPreviewMetrics, ViewService } from '../../core/services/view.service';
import { ChatSessionService } from '../../core/services/chat-session.service';
import { FacetField, FacetValue, SearchResult } from '../../core/models/search';
import { ParametricFieldConfig } from '../../core/models/parametric';

/** Fallback if fields.json pagination.pageSize is missing. */
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_QUERY = '*';
/** Debounce before QMS TypeAhead while typing. */
const TYPEAHEAD_DEBOUNCE_MS = 220;
/** Max facet values shown in the left panel before “Show all”. */
const FACET_SIDEBAR_LIMIT = 5;

/** Used when GetStatus throws before it can return IdolDatabaseListResult. */
const LIVE_DB_LIST_UNAVAILABLE: IdolDatabaseListResult = {
  ok: false,
  databases: [],
  error: 'Could not list databases from the Content component.'
};

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [FormsModule, MarkdownPipe, WaitIndicatorComponent],
  templateUrl: './search.component.html',
  styleUrl: './search.component.scss'
})
export class SearchComponent implements OnInit, OnDestroy {
  private readonly config = inject(ConfigService);
  private readonly idolDatabases = inject(IdolDatabasesService);
  private readonly auth = inject(AuthService);
  private readonly searchService = inject(SearchService);
  private readonly resultUrls = inject(ResultUrlService);
  private readonly typeaheadService = inject(TypeaheadService);
  private readonly aqgService = inject(AqgService);
  private readonly conceptSettings = inject(ConceptSearchSettingsService);
  private readonly expertise = inject(ExpertiseService);
  private readonly searchInit = inject(SearchInitService);
  private readonly answerService = inject(AnswerService);
  private readonly chatSession = inject(ChatSessionService);
  private readonly viewService = inject(ViewService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private searchSub?: Subscription;
  private facetSub?: Subscription;
  private dbCountSub?: Subscription;
  private aqgSub?: Subscription;
  private answerSub?: Subscription;
  /** Content GetContent title lookup for AnswerServer sources. */
  private answerTitleSub?: Subscription;
  private initSub?: Subscription;
  private typeaheadSub?: Subscription;
  private routeSub?: Subscription;
  /** Debounce empty-query → match-all (avoids races while deleting). */
  private clearQueryTimer?: ReturnType<typeof setTimeout>;
  /** Debounce TypeAhead while typing. */
  private typeaheadTimer?: ReturnType<typeof setTimeout>;
  /** Skip one typeahead cycle after picking a suggestion. */
  private skipNextTypeahead = false;
  /**
   * Last query scope used for facets/AQG. Pagination reuses the same key so we
   * do not re-hit GetQueryTagValues / QuerySummary on every page change.
   */
  private lastSidePanelKey = '';
  /** Query + FieldText scope for per-database counts (independent of DB checkboxes). */
  private lastDbCountKey = '';
  /** Config JSON loaded — route `q` is applied only after this. */
  private configReady = false;
  /** Last `/search?q=` value applied (avoids re-running on duplicate emissions). */
  private lastAppliedRouteQ: string | null = null;
  private pendingRouteQ: string | null = null;
  /** Last AnswerServer Ask scope (question + DatabaseMatch) to skip redundant Ask. */
  private lastAnswerScopeKey = '';

  /** Document preview modal state */
  previewResult = signal<SearchResult | null>(null);
  previewUrl = signal<SafeResourceUrl | null>(null);
  previewError = signal<string | null>(null);
  previewLoading = signal(false);
  /** Diagnostics panel (gear) open/closed. */
  previewDebugOpen = signal(false);
  previewActionId = signal<string | null>(null);
  previewMetrics = signal<ViewPreviewMetrics | null>(null);
  /** blob: URL to revoke on close */
  private previewBlobUrl: string | null = null;
  private previewSub?: Subscription;
  private profileSub?: Subscription;

  /**
   * Typed box value (adds a concept on Search; empty does not run Text=*).
   * Defaults to the wildcard so the box always starts showing `*` and an
   * unmodified Search press returns the full match-all result set.
   */
  query = DEFAULT_QUERY;
  databases = signal<DatabaseConfig[]>([]);
  selectedDbIds = signal<Set<string>>(new Set());
  /** Matching document counts keyed by databaseMatch / id. */
  dbCounts = signal<Map<string, number>>(new Map());
  loadError = signal<string | null>(null);

  /** Facet definitions from config (v1 only). */
  facetDefs = signal<ParametricFieldConfig[]>([]);
  /** Live facet values from GetQueryTagValues. */
  facetPanels = signal<FacetField[]>([]);
  /**
   * Selected facet values keyed by facet id (e.g. mime → Set of MIME strings).
   */
  selectedFacets = signal<Record<string, Set<string>>>({});

  /**
   * Facet expand dialog: which facet id is open (null = closed).
   * Panel data is re-resolved from facetPanels so counts stay live after re-query.
   */
  facetDialogId = signal<string | null>(null);
  /** Client-side filter text inside the expand dialog. */
  facetDialogFilter = '';

  hits = signal<SearchResult[]>([]);
  totalHits = signal(0);
  pageStart = signal(1);
  loading = signal(false);
  facetsLoading = signal(false);
  searchError = signal<string | null>(null);
  hasSearched = signal(false);
  lastQuery = signal('');

  /** QMS TypeAhead suggestions under the search box. */
  suggestions = signal<TypeaheadSuggestion[]>([]);
  suggestionsOpen = signal(false);
  suggestionsLoading = signal(false);
  /** Keyboard highlight index into suggestions(); -1 = none. */
  suggestionIndex = signal(-1);

  /** Automatic Query Guidance (QMS QuerySummary) — right panel taxonomy. */
  aqgTerms = signal<AqgTerm[]>([]);
  /** Cluster hierarchy (positive cluster = parent + children). */
  aqgTree = signal<AqgNode[]>([]);
  aqgSummary = signal('');
  aqgLoading = signal(false);
  /** Selected AQG phrases (multi-select → OR search). */
  selectedAqg = signal<Set<string>>(new Set());
  /** Expanded cluster roots (key = cluster id + head text). Default: all with children. */
  aqgExpanded = signal<Set<string>>(new Set());

  /** AnswerServer NLQA panel (parallel to Content search). */
  answerHits = signal<AnswerHit[]>([]);
  answerQuestion = signal('');
  answerLoading = signal(false);
  answerError = signal<string | null>(null);
  answerWarnings = signal<string[]>([]);
  /** Which answer source snippets are expanded. */
  answerSourcesOpen = signal(false);

  /** From config/fields.json → pagination.pageSize (MaxResults per page). */
  pageSize = signal(DEFAULT_PAGE_SIZE);

  /**
   * Multi-concept search: tags under the search box.
   * Combined with header Settings operator into the Content Text query.
   */
  concepts = signal<string[]>([]);

  /** Current join operator from header Settings. */
  conceptOperator(): string {
    return this.conceptSettings.operator();
  }

  get selectedCount(): number {
    const selected = this.selectedDbIds();
    return this.databases().filter((d) => selected.has(d.id)).length;
  }

  get pageEnd(): number {
    const start = this.pageStart();
    const n = this.hits().length;
    if (n === 0) {
      return 0;
    }
    return start + n - 1;
  }

  get canPrev(): boolean {
    return this.pageStart() > 1 && !this.loading();
  }

  get canNext(): boolean {
    return this.pageEnd < this.totalHits() && !this.loading();
  }

  get activeFacetCount(): number {
    return Object.values(this.selectedFacets()).reduce((n, s) => n + s.size, 0);
  }

  get selectedAqgCount(): number {
    return this.selectedAqg().size;
  }

  ngOnInit(): void {
    // Default search value: box starts on the wildcard, not empty.
    this.query = DEFAULT_QUERY;
    // Prefetch result-url templates off the critical path (do not block first Query).
    this.resultUrls.preload().subscribe();
    // Re-run search when header Settings change (operator, summary type/length)
    this.conceptSettings.onSettingsChange(() => {
      if (!this.hasSearched()) {
        return;
      }
      this.pageStart.set(1);
      if (this.concepts().length > 0) {
        this.runConceptsSearch();
      } else {
        this.runSearch(this.lastQuery() || DEFAULT_QUERY);
      }
    });
    this.bootstrapConfig();
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      this.searchInit.rememberSearchUrl(this.router.url);
      const q = (params.get('q') || '').trim();
      this.onRouteQuery(q);
    });
  }

  ngOnDestroy(): void {
    this.conceptSettings.onSettingsChange(null);
    this.clearClearQueryTimer();
    this.clearTypeaheadTimer();
    this.searchSub?.unsubscribe();
    this.facetSub?.unsubscribe();
    this.dbCountSub?.unsubscribe();
    this.aqgSub?.unsubscribe();
    this.answerSub?.unsubscribe();
    this.answerTitleSub?.unsubscribe();
    this.initSub?.unsubscribe();
    this.typeaheadSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    this.previewSub?.unsubscribe();
    this.profileSub?.unsubscribe();
    this.revokePreviewBlob();
  }

  toggleAnswerSources(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.answerSourcesOpen.update((v) => !v);
  }

  continueInChat(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const hit = this.answerHits()[0];
    if (!hit?.text) {
      return;
    }
    this.chatSession.queueContinue({
      question: this.answerQuestion() || this.lastQuery(),
      answerText: hit.text,
      sources: hit.sources ?? [],
      databases: this.selectedDatabaseMatchValues(),
      returnUrl: this.resultsPageUrl()
    });
    void this.router.navigate(['/chat']);
  }

  startNewChat(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.chatSession.rememberResultsUrl(this.resultsPageUrl());
    this.chatSession.queueNew(this.selectedDatabaseMatchValues());
    void this.router.navigate(['/chat'], { queryParams: { new: '1' } });
  }

  /** `/search?q=` for the current question — not `router.url` (query strings break routerLink). */
  private resultsPageUrl(): string {
    const q = (this.answerQuestion() || this.lastQuery() || this.concepts()[0] || '').trim();
    if (q && q !== '*') {
      return `/search?q=${encodeURIComponent(q)}`;
    }
    const url = this.router.url || '';
    if (url.startsWith('/search?')) {
      return url;
    }
    return '/search';
  }

  dismissAnswer(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.clearAnswerPanel();
  }

  // ── Multi-concept search ─────────────────────────────────────────────────

  /**
   * Add a concept tag and re-run search.
   * @returns true if the concept was added (or already present and search refreshed).
   */
  addConcept(raw: string, options?: { runSearch?: boolean }): boolean {
    const text = this.normalizeConcept(raw);
    if (!text || text === DEFAULT_QUERY) {
      return false;
    }
    const current = this.concepts();
    const exists = current.some((c) => c.toLowerCase() === text.toLowerCase());
    if (!exists) {
      this.concepts.set([...current, text]);
    }
    this.query = '';
    this.closeSuggestions();
    if (options?.runSearch !== false) {
      this.pageStart.set(1);
      this.runConceptsSearch();
    }
    return true;
  }

  removeConcept(text: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const next = this.concepts().filter((c) => c !== text);
    this.concepts.set(next);
    this.pageStart.set(1);
    this.runConceptsSearch();
  }

  clearConcepts(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.concepts().length) {
      this.runMatchAll();
      return;
    }
    this.concepts.set([]);
    this.pageStart.set(1);
    this.runMatchAll();
  }

  /**
   * Build Content Text from concept tags + header Settings operator.
   *
   * A single concept (e.g. from the home landing page) is sent as free text —
   * multi-word phrases are NOT exact-quoted (that over-constrains IDOL and is
   * wrong for natural queries like "Waikato River").
   * When joining 2+ concepts with AND/OR/NEAR, multi-word tags are quoted so
   * the operator binds phrases correctly.
   */
  buildConceptQueryText(
    concepts = this.concepts(),
    op = this.conceptSettings.operator()
  ): string {
    const raw = concepts
      .map((t) => this.normalizeConcept(t))
      .filter((t) => !!t && t !== DEFAULT_QUERY);
    if (!raw.length) {
      return DEFAULT_QUERY;
    }

    if (raw.length === 1) {
      const t = raw[0];
      // Questions must stay free-text for Content / AnswerServer.
      if (this.answerService.isQuestion(t)) {
        return this.answerService.toDocumentQueryText(t);
      }
      // Strip any user-typed surrounding quotes; do not re-wrap.
      return t.replace(/^"+|"+$/g, '').trim() || DEFAULT_QUERY;
    }

    const parts = raw.map((t) => {
      if (this.answerService.isQuestion(t)) {
        return this.answerService.toDocumentQueryText(t);
      }
      const cleaned = t.replace(/"/g, '').trim();
      if (!cleaned) {
        return '';
      }
      // Multi-concept: quote multi-word / special tokens for operator binding
      return /\s/.test(cleaned) || /[()]/.test(cleaned) ? `"${cleaned}"` : cleaned;
    }).filter(Boolean);

    if (!parts.length) {
      return DEFAULT_QUERY;
    }
    if (parts.length === 1) {
      return parts[0];
    }
    const join = ` ${op} `;
    return parts.join(join);
  }

  private runConceptsSearch(): void {
    if (!this.concepts().length) {
      this.runMatchAll();
      return;
    }
    const text = this.buildConceptQueryText();
    this.runSearch(text);
  }

  /**
   * Stay on the results page and run Text=*. Clears concept tags and the
   * route `q` so a refresh does not re-apply the previous term.
   */
  private runMatchAll(): void {
    this.clearClearQueryTimer();
    this.clearTypeaheadTimer();
    this.closeSuggestions();
    this.concepts.set([]);
    this.query = '';
    this.pageStart.set(1);
    // Mark before clearing ?q= so the queryParam subscription does not re-enter.
    this.lastAppliedRouteQ = '*';
    if (this.route.snapshot.queryParamMap.get('q')) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true
      });
    }
    this.runSearch(DEFAULT_QUERY);
  }

  private normalizeConcept(raw: string): string {
    return (raw ?? '').trim().replace(/\s+/g, ' ');
  }

  toggleDb(id: string): void {
    const next = new Set(this.selectedDbIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedDbIds.set(next);
    this.onFiltersChanged();
  }

  isDbSelected(id: string): boolean {
    return this.selectedDbIds().has(id);
  }

  /** Matching docs in this database for the current query, or null if not loaded. */
  databaseCount(db: DatabaseConfig): number | null {
    const counts = this.dbCounts();
    if (!counts.size) {
      return null;
    }
    for (const key of [db.databaseMatch, db.id, db.label]) {
      if (key && counts.has(key)) {
        return counts.get(key) ?? 0;
      }
    }
    return null;
  }

  selectAllDatabases(): void {
    this.selectedDbIds.set(new Set(this.databases().map((d) => d.id)));
    this.onFiltersChanged();
  }

  clearDatabases(): void {
    this.selectedDbIds.set(new Set());
    this.onFiltersChanged();
  }

  isFacetSelected(facetId: string, value: string): boolean {
    return !!this.selectedFacets()[facetId]?.has(value);
  }

  /** Values ranked by document count (desc), then value name for stability. */
  rankedFacetValues(panel: FacetField): FacetValue[] {
    return [...panel.values].sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.value.localeCompare(b.value);
    });
  }

  /**
   * Left-panel values: top N by document count, plus any selected values that
   * fall outside the top N so they remain visible/clearable without the dialog.
   */
  visibleFacetValues(panel: FacetField): FacetValue[] {
    const ranked = this.rankedFacetValues(panel);
    const top = ranked.slice(0, FACET_SIDEBAR_LIMIT);
    const topSet = new Set(top.map((v) => v.value));
    const selected = this.selectedFacets()[panel.id];
    if (!selected?.size) {
      return top;
    }
    const extra = ranked.filter((v) => selected.has(v.value) && !topSet.has(v.value));
    return extra.length ? [...top, ...extra] : top;
  }

  hasMoreFacetValues(panel: FacetField): boolean {
    return panel.values.length > FACET_SIDEBAR_LIMIT;
  }

  facetSelectedCount(facetId: string): number {
    return this.selectedFacets()[facetId]?.size ?? 0;
  }

  openFacetDialog(panel: FacetField): void {
    this.facetDialogId.set(panel.id);
    this.facetDialogFilter = '';
  }

  closeFacetDialog(): void {
    this.facetDialogId.set(null);
    this.facetDialogFilter = '';
  }

  /** Live panel for the open expand dialog (null if closed or facet gone). */
  facetDialogPanel(): FacetField | null {
    const id = this.facetDialogId();
    if (!id) {
      return null;
    }
    return this.facetPanels().find((p) => p.id === id) ?? null;
  }

  /** All values for the dialog (count-ranked), filtered by the search box. */
  filteredFacetDialogValues(): FacetValue[] {
    const panel = this.facetDialogPanel();
    if (!panel) {
      return [];
    }
    const ranked = this.rankedFacetValues(panel);
    const q = this.facetDialogFilter.trim().toLowerCase();
    if (!q) {
      return ranked;
    }
    return ranked.filter((fv) => {
      const raw = fv.value.toLowerCase();
      const label = this.formatFacetLabel(fv.value).toLowerCase();
      return raw.includes(q) || label.includes(q);
    });
  }

  clearFacetField(facetId: string): void {
    const all = { ...this.selectedFacets() };
    if (!all[facetId]) {
      return;
    }
    delete all[facetId];
    this.selectedFacets.set(all);
    this.onFiltersChanged();
  }

  toggleFacet(facetId: string, value: string, multiSelect: boolean): void {
    const all = { ...this.selectedFacets() };
    const current = new Set(all[facetId] ?? []);
    if (current.has(value)) {
      current.delete(value);
    } else {
      if (!multiSelect) {
        current.clear();
      }
      current.add(value);
    }
    if (current.size === 0) {
      delete all[facetId];
    } else {
      all[facetId] = current;
    }
    this.selectedFacets.set(all);
    this.onFiltersChanged();
  }

  clearFacets(): void {
    this.selectedFacets.set({});
    this.onFiltersChanged();
  }

  isAqgSelected(text: string): boolean {
    return this.selectedAqg().has(text);
  }

  /** Parent checkbox: fully selected when parent + all children are checked. */
  isAqgParentChecked(node: AqgNode): boolean {
    if (!node.children.length) {
      return this.isAqgSelected(node.term.text);
    }
    const texts = this.aqgBranchTexts(node);
    return texts.every((t) => this.selectedAqg().has(t));
  }

  toggleAqgTerm(text: string): void {
    const next = new Set(this.selectedAqg());
    if (next.has(text)) {
      next.delete(text);
    } else {
      next.add(text);
    }
    this.selectedAqg.set(next);
  }

  /**
   * Parent-level checkbox: with children, select/clear the whole branch
   * (parent + all subtopics). Leaf parents toggle themselves only.
   */
  onAqgParentToggle(node: AqgNode, event?: Event): void {
    if (!node.children.length) {
      this.toggleAqgTerm(node.term.text);
      return;
    }
    this.toggleAqgBranch(node, event);
  }

  clearAqgSelection(): void {
    this.selectedAqg.set(new Set());
  }

  aqgNodeKey(node: AqgNode): string {
    return `${node.cluster}::${node.term.text}`;
  }

  /**
   * Title Case for top-level AQG headings (user-facing “camel case”).
   * Search still uses the original term text from QMS.
   */
  aqgHeadingLabel(text: string): string {
    const s = (text ?? '').trim();
    if (!s) {
      return '';
    }
    return s
      .toLowerCase()
      .replace(/(^|[\s\-_\/])(\S)/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
  }

  isAqgExpanded(node: AqgNode): boolean {
    return this.aqgExpanded().has(this.aqgNodeKey(node));
  }

  toggleAqgExpand(node: AqgNode, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!node.children.length) {
      return;
    }
    const key = this.aqgNodeKey(node);
    const next = new Set(this.aqgExpanded());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.aqgExpanded.set(next);
  }

  private aqgBranchTexts(node: AqgNode): string[] {
    return [node.term.text, ...node.children.map((c) => c.term.text)];
  }

  /** Select or clear parent and all children in a cluster branch. */
  toggleAqgBranch(node: AqgNode, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const texts = this.aqgBranchTexts(node);
    const next = new Set(this.selectedAqg());
    const allSelected = texts.every((t) => next.has(t));
    if (allSelected) {
      for (const t of texts) {
        next.delete(t);
      }
    } else {
      for (const t of texts) {
        next.add(t);
      }
    }
    this.selectedAqg.set(next);
  }

  /** Add one guidance phrase as a concept tag (multi-concept). */
  searchAqgTerm(term: AqgTerm, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const text = term.text.trim();
    if (!text) {
      return;
    }
    this.clearClearQueryTimer();
    this.clearTypeaheadTimer();
    this.closeSuggestions();
    this.selectedAqg.set(new Set([text]));
    this.addConcept(text);
  }

  /** Add all multi-selected AQG phrases as concept tags. */
  searchAqgSelected(): void {
    const selected = [...this.selectedAqg()];
    if (!selected.length) {
      return;
    }
    this.clearClearQueryTimer();
    this.clearTypeaheadTimer();
    this.closeSuggestions();
    // Add all without intermediate searches, then one combined search
    for (const t of selected) {
      this.addConcept(t, { runSearch: false });
    }
    this.pageStart.set(1);
    this.runConceptsSearch();
  }

  onSearch(): void {
    this.clearClearQueryTimer();
    this.clearTypeaheadTimer();
    this.closeSuggestions();
    this.pageStart.set(1);
    const typed = this.query.trim();
    if (typed === DEFAULT_QUERY) {
      // Explicit wildcard: user is asking to see all documents. Honour it
      // even if concept tags are active — clear them and run match-all,
      // rather than silently ignoring the '*' and re-running the old tags.
      this.runMatchAll();
      return;
    }
    if (typed) {
      // Multi-concept: Search adds the typed phrase as a tag
      this.addConcept(typed);
      return;
    }
    // Empty box: re-run with existing concepts, or match-all if none
    this.runConceptsSearch();
  }

  /**
   * When the user clears the search box (delete all text, or the native search "×"):
   * - if concept tags remain, keep those results (do not wipe to *)
   * - if no tags, re-run default match-all (stay on results page)
   * Non-empty input drives QMS TypeAhead suggestions.
   */
  onQueryInput(): void {
    const text = this.query.trim();
    if (text !== '') {
      this.clearClearQueryTimer();
      if (this.skipNextTypeahead) {
        this.skipNextTypeahead = false;
        return;
      }
      this.scheduleTypeahead(text);
      return;
    }
    // Empty input
    this.clearTypeaheadTimer();
    this.typeaheadSub?.unsubscribe();
    this.closeSuggestions();
    this.clearClearQueryTimer();
    // Concept tags own the query — do not force match-all while tags exist
    if (this.concepts().length > 0) {
      return;
    }
    this.clearQueryTimer = setTimeout(() => {
      this.clearQueryTimer = undefined;
      if (this.query.trim() !== '' || this.concepts().length > 0) {
        return;
      }
      if (this.selectedDbIds().size === 0) {
        return;
      }
      if (this.lastQuery() === DEFAULT_QUERY && this.hasSearched()) {
        return;
      }
      this.pageStart.set(1);
      this.runMatchAll();
    }, 200);
  }

  /** Native type=search clear (×) and some browsers fire this on Enter. */
  onQuerySearchEvent(): void {
    if (!this.query.trim()) {
      this.onQueryInput();
    }
  }

  onQueryFocus(): void {
    if (this.suggestions().length > 0) {
      this.suggestionsOpen.set(true);
    } else if (this.query.trim().length >= this.typeaheadService.minChars) {
      this.scheduleTypeahead(this.query.trim());
    }
  }

  onQueryBlur(): void {
    // Delay so mousedown on a suggestion can run first
    setTimeout(() => this.closeSuggestions(), 150);
  }

  onQueryKeydown(event: KeyboardEvent): void {
    const list = this.suggestions();
    const open = this.suggestionsOpen() && list.length > 0;

    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        this.closeSuggestions();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      if (!list.length) {
        return;
      }
      event.preventDefault();
      this.suggestionsOpen.set(true);
      const next = this.suggestionIndex() < 0 ? 0 : (this.suggestionIndex() + 1) % list.length;
      this.suggestionIndex.set(next);
      return;
    }

    if (event.key === 'ArrowUp') {
      if (!open) {
        return;
      }
      event.preventDefault();
      const idx = this.suggestionIndex();
      if (idx <= 0) {
        this.suggestionIndex.set(list.length - 1);
      } else {
        this.suggestionIndex.set(idx - 1);
      }
      return;
    }

    if (event.key === 'Enter' && open && this.suggestionIndex() >= 0) {
      event.preventDefault();
      const pick = list[this.suggestionIndex()];
      if (pick) {
        this.selectSuggestion(pick);
      }
    }
  }

  selectSuggestion(item: TypeaheadSuggestion, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.clearClearQueryTimer();
    this.clearTypeaheadTimer();
    this.typeaheadSub?.unsubscribe();
    this.skipNextTypeahead = true;
    this.closeSuggestions();
    this.addConcept(item.text);
  }

  private clearClearQueryTimer(): void {
    if (this.clearQueryTimer !== undefined) {
      clearTimeout(this.clearQueryTimer);
      this.clearQueryTimer = undefined;
    }
  }

  /** Highlight typed prefix inside a suggestion for the dropdown. */
  suggestionLabelHtml(text: string): SafeHtml {
    const q = this.query.trim();
    if (!q || !text) {
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(text));
    }
    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const at = lowerText.indexOf(lowerQ);
    if (at < 0) {
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(text));
    }
    const before = this.escapeHtml(text.slice(0, at));
    const match = this.escapeHtml(text.slice(at, at + q.length));
    const after = this.escapeHtml(text.slice(at + q.length));
    return this.sanitizer.bypassSecurityTrustHtml(
      `${before}<strong class="suggest-match">${match}</strong>${after}`
    );
  }

  private scheduleTypeahead(text: string): void {
    this.clearTypeaheadTimer();
    if (text.length < this.typeaheadService.minChars) {
      this.typeaheadSub?.unsubscribe();
      this.closeSuggestions();
      return;
    }
    this.typeaheadTimer = setTimeout(() => {
      this.typeaheadTimer = undefined;
      const current = this.query.trim();
      if (current !== text || current.length < this.typeaheadService.minChars) {
        return;
      }
      this.fetchTypeahead(current);
    }, TYPEAHEAD_DEBOUNCE_MS);
  }

  private fetchTypeahead(text: string): void {
    this.typeaheadSub?.unsubscribe();
    this.suggestionsLoading.set(true);
    this.typeaheadSub = this.typeaheadService.suggest(text).subscribe({
      next: (items) => {
        // Stale response guard
        if (this.query.trim().toLowerCase() !== text.toLowerCase()) {
          return;
        }
        this.suggestions.set(items);
        this.suggestionIndex.set(-1);
        this.suggestionsOpen.set(items.length > 0);
        this.suggestionsLoading.set(false);
      },
      error: () => {
        this.suggestionsLoading.set(false);
        this.closeSuggestions();
      }
    });
  }

  private closeSuggestions(): void {
    this.suggestionsOpen.set(false);
    this.suggestionIndex.set(-1);
    this.suggestionsLoading.set(false);
    // Keep last list briefly for re-focus; clear when empty query
    if (!this.query.trim()) {
      this.suggestions.set([]);
    }
  }

  private clearTypeaheadTimer(): void {
    if (this.typeaheadTimer !== undefined) {
      clearTimeout(this.typeaheadTimer);
      this.typeaheadTimer = undefined;
    }
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  prevPage(): void {
    if (!this.canPrev) {
      return;
    }
    this.pageStart.set(Math.max(1, this.pageStart() - this.pageSize()));
    this.runSearch(this.lastQuery() || DEFAULT_QUERY);
  }

  nextPage(): void {
    if (!this.canNext) {
      return;
    }
    this.pageStart.set(this.pageStart() + this.pageSize());
    this.runSearch(this.lastQuery() || DEFAULT_QUERY);
  }

  /** IDOL `weight` is 0–100 on Query; some responses use 0–1. */
  matchPercent(hit: SearchResult): number {
    const weight = Number(hit?.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      return 0;
    }
    const pct = weight <= 1 ? weight * 100 : weight;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  /** Points vs the previous hit in the current ranking (index-1). */
  rankDelta(index: number): number {
    const list = this.hits();
    if (index <= 0 || index >= list.length) {
      return 0;
    }
    return this.matchPercent(list[index]) - this.matchPercent(list[index - 1]);
  }

  rankArrow(index: number): 'lead' | 'up' | 'down' | 'same' {
    if (index <= 0) {
      return 'lead';
    }
    const delta = this.rankDelta(index);
    if (delta > 0) {
      return 'up';
    }
    if (delta < 0) {
      return 'down';
    }
    return 'same';
  }

  snippetHtml(summary: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(summary || '');
  }

  formatFacetLabel(value: string): string {
    // APPLICATION/PDF → PDF-friendly display
    if (value.includes('/')) {
      const part = value.split('/').pop() || value;
      return part.replace(/^X-MS-/i, '').replace(/07$/i, '').replace(/_/g, ' ');
    }
    return value;
  }

  // ── Preview / download (Milestone 5) ──────────────────────────────────────

  /**
   * Preview an AnswerServer source citation via View (same modal as result cards).
   * Source `ref` is typically a filesystem/DREREFERENCE path from RAG metadata.
   */
  openAnswerSourcePreview(src: AnswerSource, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const reference = (src.ref || '').trim();
    const hit: SearchResult = {
      reference,
      title: this.answerSourceTitle(src),
      summary: (src.snippet || '').trim(),
      database: (src.database || '').trim(),
      date: '',
      mimeType: '',
      author: '',
      weight: 0,
      fields: {}
    };
    // Prefer question text for highlight Links when available
    this.openPreview(hit, event, this.answerQuestion() || this.lastQuery());
  }

  canPreviewAnswerSource(src: AnswerSource): boolean {
    return !!(src.ref && src.ref.trim());
  }

  /** Heading for a citation: looked-up title, never the raw DREREFERENCE. */
  answerSourceTitle(src: AnswerSource): string {
    if (isUsableSourceTitle(src.title, src.ref)) {
      return src.title.trim();
    }
    return fallbackTitleFromReference(src.ref);
  }

  openPreview(hit: SearchResult, event?: Event, queryTextForLinks?: string): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!hit.reference) {
      this.previewResult.set(hit);
      this.previewUrl.set(null);
      this.previewError.set('This result has no document reference to preview.');
      this.previewLoading.set(false);
      return;
    }
    this.previewSub?.unsubscribe();
    this.revokePreviewBlob();
    this.previewResult.set(hit);
    this.previewError.set(null);
    this.previewUrl.set(null);
    this.previewActionId.set(null);
    this.previewMetrics.set(null);
    this.previewDebugOpen.set(false);
    this.previewLoading.set(true);
    this.profileSub?.unsubscribe();
    if (this.conceptSettings.expertsEnabled()) {
      this.profileSub = this.expertise.profileFromDocument(hit.idolId).subscribe({
        error: () => undefined
      });
    }

    const linksQuery = (queryTextForLinks ?? this.lastQuery()).trim();

    this.previewSub = this.viewService
      .getPreviewBlobUrl(hit.reference, linksQuery)
      .subscribe({
        next: ({ blobUrl, actionId, metrics }) => {
          this.previewBlobUrl = blobUrl;
          this.previewActionId.set(actionId);
          this.previewMetrics.set(metrics);
          this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl));
          this.previewLoading.set(false);
        },
        error: (err: Error) => {
          this.previewLoading.set(false);
          const previewAid = this.viewService.lastActionId;
          this.previewActionId.set(previewAid);
          this.previewMetrics.set(null);
          const direct = hit.reference
            ? this.viewService.buildViewActionUrl(hit.reference, {
                outputType: 'HTML',
                queryText: linksQuery,
                kind: 'open-tab'
              })
            : null;
          this.viewService.lastActionId = previewAid;
          const lines = [err.message || 'Failed to load document preview.'];
          if (previewAid) lines.push(`Preview ActionID: ${previewAid}`);
          if (direct) {
            lines.push(`Open/View ActionID: ${direct.actionId}`);
            lines.push(
              `Direct View request: ${direct.url.replace(/SecurityInfo=[^&]+/gi, 'SecurityInfo=***')}`
            );
          }
          this.previewError.set(lines.join('\n'));
        }
      });
  }

  togglePreviewDebug(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.previewDebugOpen.update((v) => !v);
  }

  formatBytes(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) {
      return '—';
    }
    if (n < 1024) {
      return `${n} B`;
    }
    if (n < 1024 * 1024) {
      return `${(n / 1024).toFixed(1)} KB`;
    }
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  closePreview(): void {
    this.previewSub?.unsubscribe();
    this.revokePreviewBlob();
    this.previewResult.set(null);
    this.previewUrl.set(null);
    this.previewError.set(null);
    this.previewLoading.set(false);
    this.previewActionId.set(null);
    this.previewMetrics.set(null);
    this.previewDebugOpen.set(false);
  }

  private revokePreviewBlob(): void {
    if (this.previewBlobUrl) {
      URL.revokeObjectURL(this.previewBlobUrl);
      this.previewBlobUrl = null;
    }
  }

  downloadOriginal(hit: SearchResult, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!hit.reference) {
      return;
    }
    this.viewService.openDownload(hit.reference);
  }

  openSourceUrl(hit: SearchResult, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (hit.url) {
      window.open(hit.url, '_blank', 'noopener,noreferrer');
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.facetDialogId()) {
      this.closeFacetDialog();
      return;
    }
    if (this.previewResult()) {
      this.closePreview();
    }
  }

  private onFiltersChanged(): void {
    this.pageStart.set(1);
    if (this.selectedDbIds().size === 0) {
      this.searchSub?.unsubscribe();
      this.facetSub?.unsubscribe();
      this.dbCountSub?.unsubscribe();
      this.aqgSub?.unsubscribe();
      this.lastSidePanelKey = '';
      this.hits.set([]);
      this.totalHits.set(0);
      this.facetPanels.set([]);
      this.aqgTerms.set([]);
      this.aqgTree.set([]);
      this.aqgSummary.set('');
      this.selectedAqg.set(new Set());
      this.aqgExpanded.set(new Set());
      this.loading.set(false);
      this.hasSearched.set(true);
      this.searchError.set('Select at least one database to search.');
      return;
    }
    // Prefer active concept tags; else typed text; else match-all
    if (this.concepts().length > 0) {
      this.runConceptsSearch();
      return;
    }
    this.runSearch(this.query.trim() || DEFAULT_QUERY);
  }

  /**
   * Load databases / facets / page size only. Content Query waits for `/search?q=`.
   */
  private bootstrapConfig(): void {
    this.loading.set(false);
    this.searchError.set(null);
    // Default search value: box starts on the wildcard, not empty.
    this.query = DEFAULT_QUERY;

    if (!this.auth.getSecurityInfo() && !this.auth.allowsUnauthedAci()) {
      this.searchError.set(
        'Signed in session not ready (no SecurityInfo). Sign out and sign in again.'
      );
      return;
    }

    this.initSub?.unsubscribe();
    this.initSub = forkJoin({
      dbs: this.config.getDatabases().pipe(
        catchError(() => {
          this.loadError.set('Could not load database configuration.');
          return of({ defaultScope: 'all', databases: [] as DatabaseConfig[] });
        })
      ),
      liveDbs: from(this.idolDatabases.listDatabases()).pipe(
        catchError(() => of(LIVE_DB_LIST_UNAVAILABLE))
      ),
      facets: this.config.getParametricFilters().pipe(
        catchError(() => of({ fields: [] as ParametricFieldConfig[] }))
      ),
      fields: this.config.getFieldsConfig().pipe(
        catchError(() => of({ pagination: { pageSize: DEFAULT_PAGE_SIZE } }))
      )
    }).subscribe({
      next: ({ dbs, liveDbs, facets, fields }) => {
        const configured = dbs.databases ?? [];
        const existing = this.mergeExistingDatabases(configured, liveDbs);
        this.databases.set(existing);
        const initial = new Set(
          existing.filter((d) => d.defaultSelected !== false).map((d) => d.id)
        );
        this.selectedDbIds.set(initial);

        const defs = (facets.fields ?? [])
          .filter((f) => f.v1 !== false && f.show !== false)
          .map((f, index) => ({ f, index }))
          .sort((a, b) => {
            const ao = Number.isFinite(a.f.order) ? (a.f.order as number) : Number.POSITIVE_INFINITY;
            const bo = Number.isFinite(b.f.order) ? (b.f.order as number) : Number.POSITIVE_INFINITY;
            if (ao !== bo) {
              return ao - bo;
            }
            return a.index - b.index;
          })
          .map(({ f }) => f);
        this.facetDefs.set(defs);

        const configuredPageSize = Number(fields.pagination?.pageSize);
        this.pageSize.set(
          Number.isFinite(configuredPageSize) && configuredPageSize > 0
            ? Math.floor(configuredPageSize)
            : DEFAULT_PAGE_SIZE
        );

        if (existing.length === 0) {
          this.searchError.set(this.emptyDatabaseMessage(liveDbs));
          this.configReady = true;
          return;
        }

        this.configReady = true;
        if (this.pendingRouteQ != null) {
          const q = this.pendingRouteQ;
          this.pendingRouteQ = null;
          this.onRouteQuery(q);
        }
      },
      error: (err: Error) => {
        this.searchError.set(err.message || 'Could not start search.');
      }
    });
  }

  /**
   * Apply `?q=` from the home page (or a deep link).
   * Empty / missing `q` on the results page → match-all (stay on /search).
   */
  private onRouteQuery(q: string): void {
    if (!this.configReady) {
      this.pendingRouteQ = q;
      return;
    }

    // No term (or explicit *): wildcard on results page — do not bounce to /home
    if (!q || q === '*') {
      // Already match-all (e.g. runMatchAll just cleared ?q=)
      if (this.lastAppliedRouteQ === '*') {
        return;
      }
      this.selectedFacets.set({});
      this.selectedAqg.set(new Set());
      this.lastSidePanelKey = '';
      this.runMatchAll();
      return;
    }

    if (q === this.lastAppliedRouteQ && this.hasSearched()) {
      return;
    }
    this.lastAppliedRouteQ = q;
    this.selectedFacets.set({});
    this.selectedAqg.set(new Set());
    this.lastSidePanelKey = '';
    this.pageStart.set(1);
    this.concepts.set([]);
    this.query = '';
    this.addConcept(q);
  }

  /** Message when the merged catalog is empty after bootstrap. */
  private emptyDatabaseMessage(live: IdolDatabaseListResult): string {
    if (live.ok) {
      return 'No databases exist on the Content component.';
    }
    return live.error || 'No databases available to search.';
  }

  /**
   * Restrict the filter list to databases that actually exist on Content.
   * Config supplies labels / title fields / defaultSelected when names match.
   * If GetStatus cannot list DBs, fall back to the configured catalog.
   */
  private mergeExistingDatabases(
    configured: DatabaseConfig[],
    live: IdolDatabaseListResult
  ): DatabaseConfig[] {
    if (!live.ok) {
      return configured;
    }

    const liveRows = live.databases ?? [];
    if (liveRows.length === 0) {
      return [];
    }

    const key = (value: string | undefined) => (value ?? '').trim().toLowerCase();
    return liveRows.map((row) => {
      const name = row.name.trim();
      const match = configured.find((cfg) =>
        [cfg.databaseMatch, cfg.id, cfg.label].some((candidate) => key(candidate) === key(name))
      );
      if (match) {
        return {
          ...match,
          id: match.id || name,
          databaseMatch: name,
          label: match.label || name
        };
      }
      return {
        id: name,
        databaseMatch: name,
        label: name,
        defaultSelected: true
      };
    });
  }

  /** DatabaseMatch values for currently checked filter boxes only. */
  private selectedDatabaseMatchValues(): string[] {
    const selected = this.selectedDbIds();
    return this.databases()
      .filter((d) => selected.has(d.id))
      .map((d) => (d.databaseMatch || d.id).trim())
      .filter(Boolean);
  }

  private currentFieldText(): string {
    const defs = this.facetDefs();
    const selected = this.selectedFacets();
    const parts: {
      fieldTextName: string;
      values: string[];
      operator?: 'MATCH' | 'STRING';
    }[] = [];
    for (const def of defs) {
      const vals = selected[def.id];
      if (!vals?.size) {
        continue;
      }
      const fieldTextName =
        def.fieldTextName ||
        (def.idolField.includes('/') ? def.idolField.split('/').pop()! : def.idolField);
      const panel = this.facetPanels().find((p) => p.id === def.id);
      parts.push({
        fieldTextName,
        values: [...vals],
        operator: panel?.fieldTextOperator
      });
    }
    return SearchService.buildFieldText(parts);
  }

  private runSearch(queryText: string): void {
    const text = (queryText ?? '').trim() || DEFAULT_QUERY;
    // Content Query: freer text for NL questions (unquoted). Ask still uses full NLQ.
    const contentText = this.answerService.isQuestion(text)
      ? this.answerService.toDocumentQueryText(text)
      : text;

    this.searchSub?.unsubscribe();
    this.searchError.set(null);
    this.loading.set(true);
    this.hasSearched.set(true);
    this.lastQuery.set(text);

    const databases = this.selectedDatabaseMatchValues();

    // NLQA in parallel when the query looks like a question — scoped to selected DBs
    this.refreshAnswer(text, databases);

    if (!databases.length) {
      this.loading.set(false);
      this.searchError.set('Select at least one database to search.');
      this.hits.set([]);
      this.totalHits.set(0);
      this.aqgTerms.set([]);
      this.aqgTree.set([]);
      this.aqgSummary.set('');
      this.lastSidePanelKey = '';
      return;
    }

    const fieldText = this.currentFieldText();

    // Side panels share query scope but not the same ACI host cost:
    //  - AQG → QMS (safe to run in parallel with Content Query)
    //  - Facets → Content GetQueryTagValues (competes with Query on the same
    //    engine; start AFTER hits so results are not starved)
    // Skip both when only the page number changed.
    const sideKey = this.sidePanelScopeKey(contentText, databases, fieldText);
    const refreshSidePanels = sideKey !== this.lastSidePanelKey;
    if (refreshSidePanels) {
      this.lastSidePanelKey = sideKey;
      this.refreshAqg(contentText, databases, fieldText);
    }

    this.searchSub = this.searchService
      .search({
        queryText: contentText,
        databases,
        start: this.pageStart(),
        pageSize: this.pageSize(),
        fieldText: fieldText || undefined
      })
      .subscribe({
        next: (res) => {
          this.hits.set(res.hits);
          this.totalHits.set(res.totalHits);
          this.loading.set(false);
          if (refreshSidePanels) {
            this.refreshFacets(contentText, databases, fieldText);
          }
          this.refreshDatabaseCountsIfNeeded(contentText, fieldText);
        },
        error: (err: Error) => {
          this.hits.set([]);
          this.totalHits.set(0);
          this.loading.set(false);
          this.searchError.set(err.message || 'Search failed.');
          // Still try facets so the left panel is not empty after an error.
          if (refreshSidePanels) {
            this.refreshFacets(contentText, databases, fieldText);
          }
          this.refreshDatabaseCountsIfNeeded(contentText, fieldText);
        }
      });
  }

  /** Identity for facet/AQG scope (excludes page number). */
  private sidePanelScopeKey(
    text: string,
    databases: string[],
    fieldText: string
  ): string {
    return `${text}\u0000${databases.join(',')}\u0000${fieldText}`;
  }

  /**
   * AnswerServer Ask when the user asked a natural-language question.
   * Does not block Content search; failures show a soft message only.
   * Scoped with DatabaseMatch to the left-panel database filter.
   * Skips re-Ask on pagination when question + selected DBs are unchanged.
   */
  private refreshAnswer(queryText: string, databases: string[]): void {
    const fromConcepts = this.answerService.questionFromConcepts(this.concepts());
    const candidate =
      fromConcepts ||
      (this.answerService.isQuestion(queryText) ? queryText.trim() : null);

    if (!candidate) {
      this.clearAnswerPanel();
      return;
    }

    if (!databases.length) {
      this.clearAnswerPanel();
      return;
    }

    const scopeKey = `${candidate}\u0000${[...databases].sort().join(',')}`;
    // Same question + same DB filter already showing or in flight (e.g. page change)
    if (
      scopeKey === this.lastAnswerScopeKey &&
      (this.answerLoading() || this.answerHits().length > 0 || this.answerError())
    ) {
      return;
    }
    this.lastAnswerScopeKey = scopeKey;

    this.answerSub?.unsubscribe();
    this.answerTitleSub?.unsubscribe();
    this.answerLoading.set(true);
    this.answerError.set(null);
    this.answerWarnings.set([]);
    this.answerHits.set([]);
    this.answerQuestion.set(candidate);
    this.answerSourcesOpen.set(false);

    this.answerSub = this.answerService
      .ask(candidate, { databases })
      .subscribe({
        next: (res) => {
          this.answerHits.set(res.answers);
          this.answerWarnings.set(res.warnings);
          this.answerLoading.set(false);
          if (!res.answers.length && !res.warnings.length) {
            this.answerError.set('No answer returned for this question.');
          }
          this.lookupAnswerSourceTitles(databases, scopeKey);
        },
        error: (err: Error) => {
          this.answerHits.set([]);
          this.answerLoading.set(false);
          this.answerError.set(err.message || 'Answer Server request failed.');
        }
      });
  }

  /**
   * Ask citations usually carry DREREFERENCE only. Resolve NAME/DRETITLE/TITLE
   * from Content GetContent and patch the source headings.
   */
  private lookupAnswerSourceTitles(databases: string[], scopeKey: string): void {
    const pageHits = this.hits();
    if (pageHits.length) {
      this.answerHits.update((current) => this.applyLookedUpSourceTitles(current, pageHits));
    }

    const latest = this.answerHits();
    const refs = [
      ...new Set(
        latest
          .flatMap((a) => a.sources)
          .filter((s) => s.ref && !isUsableSourceTitle(s.title, s.ref))
          .map((s) => s.ref.trim())
      )
    ];
    if (!refs.length) {
      return;
    }

    const sourceDbs = [
      ...new Set(
        latest
          .flatMap((a) => a.sources)
          .map((s) => (s.database || '').trim())
          .filter((d): d is string => !!d)
      )
    ];
    const lookupDbs = [...new Set([...sourceDbs, ...databases])];

    this.answerTitleSub?.unsubscribe();
    this.answerTitleSub = this.searchService.getByReferences(refs, lookupDbs).subscribe({
      next: (hits) => {
        if (this.lastAnswerScopeKey !== scopeKey) {
          return;
        }
        this.answerHits.update((current) => this.applyLookedUpSourceTitles(current, hits));
      }
    });
  }

  private applyLookedUpSourceTitles(
    answers: AnswerHit[],
    hits: SearchResult[]
  ): AnswerHit[] {
    if (!hits.length) {
      return answers;
    }
    return answers.map((ans) => ({
      ...ans,
      sources: ans.sources.map((src) => {
        const hit = this.findHitForSource(src, hits);
        const title = hit ? this.titleFromContentHit(hit) : '';
        if (!isUsableSourceTitle(title, src.ref)) {
          return src;
        }
        return { ...src, title };
      })
    }));
  }

  private findHitForSource(src: AnswerSource, hits: SearchResult[]): SearchResult | undefined {
    const want = this.normalizeReference(src.ref);
    if (!want) {
      return undefined;
    }
    const exact = hits.find((h) => this.normalizeReference(h.reference) === want);
    if (exact) {
      return exact;
    }
    return hits.find((h) => {
      const got = this.normalizeReference(h.fields['DREREFERENCE'] || '');
      return !!got && got === want;
    });
  }

  private normalizeReference(ref: string): string {
    const raw = (ref ?? '').trim();
    if (!raw) {
      return '';
    }
    try {
      return decodeURIComponent(raw).replace(/[\\/]+$/, '').toLowerCase();
    } catch {
      return raw.replace(/[\\/]+$/, '').toLowerCase();
    }
  }

  /** Prefer per-database titleFields (NAME for xECM, DRETITLE for CAD). */
  private titleFromContentHit(hit: SearchResult): string {
    const db = this.databases().find(
      (d) =>
        d.databaseMatch === hit.database ||
        d.id === hit.database ||
        d.label === hit.database
    );
    const candidates =
      db?.titleFields?.length ? db.titleFields : ['NAME', 'DRETITLE', 'TITLE'];
    for (const field of candidates) {
      const value = (hit.fields[field] || hit.fields[field.toUpperCase()] || '').trim();
      if (isUsableSourceTitle(value, hit.reference)) {
        return value;
      }
    }
    const mapped = (hit.title || '').trim();
    return isUsableSourceTitle(mapped, hit.reference) ? mapped : '';
  }

  private clearAnswerPanel(): void {
    this.answerSub?.unsubscribe();
    this.answerTitleSub?.unsubscribe();
    this.lastAnswerScopeKey = '';
    this.answerHits.set([]);
    this.answerQuestion.set('');
    this.answerLoading.set(false);
    this.answerError.set(null);
    this.answerWarnings.set([]);
    this.answerSourcesOpen.set(false);
  }

  private refreshAqg(text: string, databases: string[], fieldText: string): void {
    this.aqgSub?.unsubscribe();
    this.aqgLoading.set(true);
    // New result set → clear multi-select so labels match current guidance
    this.selectedAqg.set(new Set());

    this.aqgSub = this.aqgService
      .getGuidance({
        queryText: text,
        databases,
        fieldText: fieldText || undefined
      })
      .subscribe({
        next: (res) => {
          this.aqgSummary.set(res.summary);
          this.aqgTerms.set(res.terms);
          this.aqgTree.set(res.tree);
          // Expand all cluster parents by default
          const expanded = new Set<string>();
          for (const node of res.tree) {
            if (node.children.length) {
              expanded.add(this.aqgNodeKey(node));
            }
          }
          this.aqgExpanded.set(expanded);
          this.aqgLoading.set(false);
        },
        error: () => {
          this.aqgTerms.set([]);
          this.aqgTree.set([]);
          this.aqgSummary.set('');
          this.aqgExpanded.set(new Set());
          this.aqgLoading.set(false);
        }
      });
  }

  private refreshDatabaseCountsIfNeeded(text: string, fieldText: string): void {
    const countKey = `${text}\u0000${fieldText}`;
    if (countKey === this.lastDbCountKey && this.dbCounts().size > 0) {
      return;
    }
    this.lastDbCountKey = countKey;

    const dbs = this.databases()
      .map((d) => (d.databaseMatch || d.id).trim())
      .filter(Boolean);
    if (!dbs.length) {
      this.dbCounts.set(new Map());
      return;
    }

    this.dbCountSub?.unsubscribe();
    this.dbCountSub = this.searchService
      .getDatabaseCounts({
        queryText: text,
        databases: dbs,
        fieldText: fieldText || undefined
      })
      .subscribe({
        next: (counts) => this.dbCounts.set(counts),
        error: () => {
          if (this.lastDbCountKey === countKey) {
            this.lastDbCountKey = '';
          }
        }
      });
  }

  private refreshFacets(text: string, databases: string[], fieldText: string): void {
    const defs = this.facetDefs();
    if (!defs.length) {
      this.facetPanels.set([]);
      return;
    }

    this.facetSub?.unsubscribe();
    this.facetsLoading.set(true);

    const idolFields = defs.map((d) => d.idolField);
    const requestKey = this.sidePanelScopeKey(text, databases, fieldText);

    this.facetSub = this.searchService
      .getFacetValues({
        queryText: text,
        databases,
        fieldText: fieldText || undefined,
        idolFields
      })
      .subscribe({
        next: (valueMap) => {
          const panels: FacetField[] = [];
          for (const def of defs) {
            const values = this.searchService.lookupFacetValues(valueMap, def.idolField);
            if (!values.length) {
              // Keep panel if user has a selection on this facet (so they can clear it)
              const sel = this.selectedFacets()[def.id];
              if (!sel?.size) {
                continue;
              }
            }
            const fieldTextName =
              def.fieldTextName ||
              (def.idolField.includes('/') ? def.idolField.split('/').pop()! : def.idolField);
            panels.push({
              id: def.id,
              idolField: def.idolField,
              fieldTextName,
              label: def.label,
              multiSelect: def.multiSelect !== false,
              fieldTextOperator: this.searchService.facetOperator(valueMap, def.idolField),
              values: values.length
                ? values
                : [...(this.selectedFacets()[def.id] ?? [])].map((v) => ({
                    value: v,
                    count: 0
                  }))
            });
          }
          this.facetPanels.set(panels);
          this.facetsLoading.set(false);
        },
        error: () => {
          this.facetsLoading.set(false);
          // Allow the same query scope to retry facets on the next search.
          if (this.lastSidePanelKey === requestKey) {
            this.lastSidePanelKey = '';
          }
          // Non-fatal: keep previous facet panels
        }
      });
  }
}
