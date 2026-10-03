import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import Handlebars from 'handlebars';
import {
  Observable,
  forkJoin,
  of,
  shareReplay,
  switchMap,
  map,
  catchError,
  tap
} from 'rxjs';
import { ResultUrlRule, ResultUrlsFile } from '../models/result-url';
import { SearchResult } from '../models/search';

type HbTemplate = HandlebarsTemplateDelegate;

/**
 * Resolves result open-URLs from result-urls.json + Handlebars .hbs templates.
 * Templates and config are loaded once and kept in memory (fast path for search).
 */
@Injectable({ providedIn: 'root' })
export class ResultUrlService {
  private readonly http = inject(HttpClient);
  private readonly templateCache = new Map<string, HbTemplate>();
  private config?: ResultUrlsFile;
  private config$?: Observable<ResultUrlsFile>;
  private preload$?: Observable<void>;
  private helpersRegistered = false;
  /** True after preload finished successfully (sync resolve path is safe). */
  private preloadComplete = false;

  /**
   * Prefetch JSON + every .hbs referenced in the config.
   * Call once after login or when entering search — makes resolveHits cheap.
   */
  preload(): Observable<void> {
    if (this.preload$) {
      return this.preload$;
    }
    this.ensureHelpers();
    this.preload$ = this.loadConfig().pipe(
      switchMap((config) => {
        const ids = this.collectTemplateIds(config);
        if (!ids.length) {
          return of(void 0);
        }
        return forkJoin(ids.map((id) => this.loadTemplate(id))).pipe(map(() => void 0));
      }),
      tap(() => {
        this.preloadComplete = true;
      }),
      shareReplay(1),
      catchError((err) => {
        console.warn('ResultUrlService.preload failed', err);
        this.preload$ = undefined;
        this.preloadComplete = false;
        return of(void 0);
      })
    );
    return this.preload$;
  }

  /** Attach url / urlOpenIn / urlLabel — uses in-memory templates only (no HTTP if preloaded). */
  resolveHits(hits: SearchResult[]): Observable<SearchResult[]> {
    this.ensureHelpers();
    if (!hits.length) {
      return of(hits);
    }
    // Avoid re-entering preload HTTP after first successful warm-up.
    if (this.preloadComplete && this.config) {
      return of(hits.map((hit) => this.resolveHitSync(hit, this.config!)));
    }
    return this.preload().pipe(
      map(() => {
        if (!this.config) {
          return hits;
        }
        return hits.map((hit) => this.resolveHitSync(hit, this.config!));
      })
    );
  }

  /** Skip View and use the resolved http(s) result URL. */
  usesResultUrlPreview(hit: SearchResult): boolean {
    const rule = this.ruleForHit(hit);
    if (rule?.preview !== 'url') {
      return false;
    }
    return /^https?:\/\//i.test((hit.url || '').trim());
  }

  /** Embed that URL in the preview iframe (false when the site forbids framing). */
  shouldIframeUrl(hit: SearchResult): boolean {
    if (!this.usesResultUrlPreview(hit)) {
      return false;
    }
    return this.ruleForHit(hit)?.iframe !== false;
  }

  private ruleForHit(hit: SearchResult): ResultUrlRule | undefined {
    const config = this.config;
    if (!config) {
      return undefined;
    }
    const dbKey = hit.database || hit.fields['DATABASE'] || hit.fields['DREDBNAME'] || '';
    if (dbKey && config.byDatabase?.[dbKey]) {
      return config.byDatabase[dbKey];
    }
    if (dbKey && config.byDatabase?.[dbKey.toUpperCase()]) {
      return config.byDatabase[dbKey.toUpperCase()];
    }
    if (dbKey && config.byDatabase) {
      const upper = dbKey.toUpperCase();
      const match = Object.keys(config.byDatabase).find((k) => k.toUpperCase() === upper);
      if (match) {
        return config.byDatabase[match];
      }
    }
    return config.default;
  }

  private loadConfig(): Observable<ResultUrlsFile> {
    if (this.config) {
      return of(this.config);
    }
    if (!this.config$) {
      this.config$ = this.http.get<ResultUrlsFile>('assets/config/result-urls.json').pipe(
        tap((c) => {
          this.config = c;
        }),
        shareReplay(1)
      );
    }
    return this.config$;
  }

  private collectTemplateIds(config: ResultUrlsFile): string[] {
    const ids = new Set<string>();
    const add = (rule?: ResultUrlRule) => {
      if (!rule) {
        return;
      }
      if (rule.strategy === 'templateId' && rule.templateId) {
        ids.add(rule.templateId);
      }
      if (rule.fallback) {
        add(rule.fallback);
      }
    };
    add(config.default);
    for (const rule of Object.values(config.byDatabase ?? {})) {
      add(rule);
    }
    return [...ids];
  }

  private loadTemplate(templateId: string): Observable<HbTemplate | null> {
    if (this.templateCache.has(templateId)) {
      return of(this.templateCache.get(templateId)!);
    }
    const path = `assets/templates/result-url/${templateId}.hbs`;
    return this.http.get(path, { responseType: 'text' }).pipe(
      map((source) => {
        const compiled = Handlebars.compile(source, { noEscape: true });
        this.templateCache.set(templateId, compiled);
        return compiled;
      }),
      catchError((err) => {
        console.warn(`ResultUrlService: template not loaded: ${templateId}`, err);
        return of(null);
      })
    );
  }

  private resolveHitSync(hit: SearchResult, config: ResultUrlsFile): SearchResult {
    const dbKey = hit.database || hit.fields['DATABASE'] || hit.fields['DREDBNAME'] || '';
    const rule =
      (dbKey && config.byDatabase?.[dbKey]) ||
      (dbKey && config.byDatabase?.[dbKey.toUpperCase()]) ||
      config.default;

    let url = this.applyRuleSync(hit, rule);
    let openIn = rule.openIn ?? 'new_tab';
    let label = rule.label;

    if (!url && rule.fallback) {
      url = this.applyRuleSync(hit, rule.fallback);
      openIn = rule.fallback.openIn ?? openIn;
      label = rule.fallback.label ?? label;
    }

    return {
      ...hit,
      url: url || null,
      urlOpenIn: openIn,
      urlLabel: label
    };
  }

  private applyRuleSync(hit: SearchResult, rule: ResultUrlRule): string | null {
    if (!rule || rule.strategy === 'none') {
      return null;
    }

    if (rule.strategy === 'field') {
      const name = rule.field || 'DREREFERENCE';
      return this.fieldValue(hit, name) || null;
    }

    if (rule.strategy === 'templateId') {
      const id = rule.templateId;
      if (!id) {
        return null;
      }
      const tpl = this.templateCache.get(id);
      if (!tpl) {
        return null;
      }
      try {
        const out = String(tpl(this.buildContext(hit, rule.fields)) ?? '').trim();
        return out || null;
      } catch {
        return null;
      }
    }

    return null;
  }

  private buildContext(hit: SearchResult, fieldList?: string[]): Record<string, string> {
    const nodeId = hit.fields['NODE_ID'] || this.deriveNodeId(hit);
    const ctx: Record<string, string> = {
      ...hit.fields,
      reference: hit.reference,
      title: hit.title,
      database: hit.database,
      summary: hit.summary,
      date: hit.date,
      mimeType: hit.mimeType,
      author: hit.author,
      DREREFERENCE: hit.fields['DREREFERENCE'] || hit.reference,
      DRETITLE: hit.fields['DRETITLE'] || hit.title,
      NAME: hit.fields['NAME'] || '',
      DATABASE: hit.database,
      NODE_ID: nodeId
    };

    if (fieldList?.length) {
      for (const f of fieldList) {
        const key = f.toUpperCase();
        if (ctx[key] === undefined || ctx[key] === '') {
          ctx[f] = hit.fields[f] || hit.fields[key] || '';
          ctx[key] = ctx[f];
        }
      }
    }
    return ctx;
  }

  private fieldValue(hit: SearchResult, name: string): string {
    return (
      hit.fields[name] ||
      hit.fields[name.toUpperCase()] ||
      hit.fields[name.toLowerCase()] ||
      (name.toUpperCase() === 'DREREFERENCE' ? hit.reference : '') ||
      ''
    );
  }

  private deriveNodeId(hit: SearchResult): string {
    const fromField = hit.fields['NODE_ID'] || hit.fields['OBJID'] || '';
    if (fromField) {
      return fromField;
    }
    const ref = hit.reference || hit.fields['DREREFERENCE'] || '';
    const m = /^OpenText:(\d+)/i.exec(ref);
    if (m) {
      return m[1];
    }
    if (/^\d+$/.test(ref.trim())) {
      return ref.trim();
    }
    return '';
  }

  private ensureHelpers(): void {
    if (this.helpersRegistered) {
      return;
    }
    Handlebars.registerHelper('encode', (value: unknown) => {
      if (value === undefined || value === null) {
        return '';
      }
      return encodeURIComponent(String(value));
    });
    Handlebars.registerHelper('lower', (value: unknown) =>
      value === undefined || value === null ? '' : String(value).toLowerCase()
    );
    Handlebars.registerHelper('upper', (value: unknown) =>
      value === undefined || value === null ? '' : String(value).toUpperCase()
    );
    this.helpersRegistered = true;
  }
}
