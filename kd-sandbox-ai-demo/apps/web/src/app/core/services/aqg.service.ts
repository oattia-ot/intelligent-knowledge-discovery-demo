import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AppSettingsService } from './app-settings.service';
import { AuthService } from './auth.service';

const AUTN_NS = 'http://schemas.autonomy.com/aci/';

/**
 * One Automatic Query Guidance concept from QMS QuerySummary.
 *
 * From IDOL docs (Query Summary Response Format):
 * - docs   — documents where all terms of the element appear
 * - pdocs  — documents where the element appears as a phrase
 * - poccs  — total phrase occurrences in the result set
 * - cluster — grouping id; same cluster = related concepts.
 *             Negative cluster ids are weak/noisy (too common/rare);
 *             treat as standalone roots rather than nesting them.
 */
export interface AqgTerm {
  text: string;
  docs: number;
  pdocs: number;
  poccs: number;
  /** QMS cluster id (string; may be negative). */
  cluster: string;
}

/** Hierarchical node for the Query guidance taxonomy panel. */
export interface AqgNode {
  term: AqgTerm;
  /** Sibling concepts in the same positive cluster (empty for leaves / negative clusters). */
  children: AqgNode[];
  cluster: string;
}

export interface AqgResult {
  /** Free-text query summary line when present. */
  summary: string;
  /** Flat list (same set as tree, depth-first). */
  terms: AqgTerm[];
  /** Cluster-based hierarchy for the right-hand panel. */
  tree: AqgNode[];
}

export interface AqgRequest {
  queryText: string;
  databases: string[];
  fieldText?: string;
  maxResults?: number;
  summaryLength?: number;
}

/**
 * Automatic Query Guidance (AQG) via QMS Query + QuerySummary.
 *
 * Hierarchy is derived from the `cluster` attribute on each
 * `<autn:element>` (not nested XML). Positive clusters share a parent
 * (strongest phrase by docs/pdocs/poccs); negative clusters are roots.
 */
@Injectable({ providedIn: 'root' })
export class AqgService {
  private readonly http = inject(HttpClient);
  private readonly appSettings = inject(AppSettingsService);
  private readonly auth = inject(AuthService);

  readonly defaultMaxResults = 300;
  /**
   * Match-all (`*`) QuerySummary over 300 docs is very slow on multi-DB demos.
   * A smaller sample is enough for a useful first-load guidance panel.
   */
  readonly matchAllMaxResults = 80;
  readonly defaultSummaryLength = 50;
  /** Max flat elements kept before building the tree. */
  readonly displayLimit = 40;

  getGuidance(req: AqgRequest): Observable<AqgResult> {
    const text = (req.queryText ?? '').trim() || '*';
    const databases = (req.databases ?? []).filter(Boolean);
    if (!databases.length) {
      return of({ summary: '', terms: [], tree: [] });
    }

    const isMatchAll = text === '*';
    const maxResults =
      req.maxResults ??
      (isMatchAll ? this.matchAllMaxResults : this.defaultMaxResults);

    const base = this.appSettings.requestUrl('qmsApiUrl').replace(/\/?$/, '/');
    let params = new HttpParams()
      .set('action', 'Query')
      .set('Text', text)
      .set('DatabaseMatch', databases.join(','))
      .set('Combine', 'Simple')
      .set('MinScore', '0')
      .set('AnyLanguage', 'true')
      .set('MaxResults', String(Math.max(1, maxResults)))
      .set('Print', 'NoResults')
      .set('QuerySummary', 'true')
      .set(
        'QuerySummaryLength',
        String(Math.max(1, req.summaryLength ?? this.defaultSummaryLength))
      );

    if (req.fieldText?.trim()) {
      params = params.set('FieldText', req.fieldText.trim());
    }

    const token = this.auth.getSecurityInfo();
    if (token) {
      params = params.set('SecurityInfo', token);
    }

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((xml) => this.parseQuerySummaryXml(xml)),
      catchError(() => of({ summary: '', terms: [], tree: [] }))
    );
  }

  /**
   * Build a Content search string from selected guidance phrases.
   * Multi-word phrases are quoted; multiple terms joined with OR.
   */
  buildSearchText(terms: string[]): string {
    const parts = terms
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (/\s/.test(t) ? `"${t.replace(/"/g, '')}"` : t));
    if (!parts.length) {
      return '*';
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return parts.join(' OR ');
  }

  /**
   * Group flat QuerySummary elements into a cluster hierarchy.
   *
   * - cluster >= 0: strongest term is parent; others are children
   * - cluster < 0: each term is a root (per IDOL: ignore negative for clustering)
   */
  buildTree(terms: AqgTerm[]): AqgNode[] {
    if (!terms.length) {
      return [];
    }

    const byCluster = new Map<string, AqgTerm[]>();
    for (const t of terms) {
      const key = t.cluster === '' || t.cluster == null ? '0' : String(t.cluster);
      const list = byCluster.get(key) ?? [];
      list.push(t);
      byCluster.set(key, list);
    }

    const roots: AqgNode[] = [];

    for (const [cluster, members] of byCluster) {
      const sorted = [...members].sort((a, b) => this.compareTerms(a, b));
      const clusterNum = Number(cluster);
      const isWeakCluster = !Number.isFinite(clusterNum) || clusterNum < 0;

      if (isWeakCluster) {
        // Standalone roots — do not invent a parent among noisy clusters
        for (const m of sorted) {
          roots.push({ term: m, children: [], cluster });
        }
        continue;
      }

      if (sorted.length === 1) {
        roots.push({ term: sorted[0], children: [], cluster });
        continue;
      }

      const [head, ...rest] = sorted;
      roots.push({
        term: head,
        cluster,
        children: rest.map((c) => ({ term: c, children: [], cluster }))
      });
    }

    // Stronger clusters first
    roots.sort((a, b) => this.compareTerms(a.term, b.term));
    return roots;
  }

  private parseQuerySummaryXml(xmlText: string): AqgResult {
    if (!xmlText?.trim()) {
      return { summary: '', terms: [], tree: [] };
    }

    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return { summary: '', terms: [], tree: [] };
    }

    const responseEl = doc.getElementsByTagName('response')[0];
    const response = (responseEl?.textContent || '').trim().toUpperCase();
    if (response && response !== 'SUCCESS') {
      return { summary: '', terms: [], tree: [] };
    }

    const summary =
      this.firstText(doc, 'querysummary') ||
      this.firstTextNS(doc, AUTN_NS, 'querysummary') ||
      '';

    const elements = this.collectElements(doc);
    const seen = new Set<string>();
    const terms: AqgTerm[] = [];

    for (const el of elements) {
      const text = (el.textContent || '').trim();
      if (!text) {
        continue;
      }
      const key = text.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      terms.push({
        text,
        docs: this.numAttr(el, 'docs'),
        pdocs: this.numAttr(el, 'pdocs'),
        poccs: this.numAttr(el, 'poccs'),
        cluster: el.getAttribute('cluster') ?? ''
      });
    }

    // Keep strongest elements, then build hierarchy from full retained set
    terms.sort((a, b) => this.compareTerms(a, b));
    const limited = terms.slice(0, this.displayLimit);
    const tree = this.buildTree(limited);

    return {
      summary: summary.trim(),
      terms: limited,
      tree
    };
  }

  /** Prefer more documents / phrase hits, then alpha. */
  private compareTerms(a: AqgTerm, b: AqgTerm): number {
    return (
      b.docs - a.docs ||
      b.pdocs - a.pdocs ||
      b.poccs - a.poccs ||
      a.text.localeCompare(b.text)
    );
  }

  private collectElements(doc: Document): Element[] {
    const byNs = Array.from(doc.getElementsByTagNameNS(AUTN_NS, 'element'));
    if (byNs.length) {
      return byNs;
    }
    return Array.from(doc.getElementsByTagName('autn:element')).concat(
      Array.from(doc.getElementsByTagName('element'))
    );
  }

  private firstText(doc: Document, local: string): string {
    return (doc.getElementsByTagName(local)[0]?.textContent || '').trim();
  }

  private firstTextNS(doc: Document, ns: string, local: string): string {
    return (doc.getElementsByTagNameNS(ns, local)[0]?.textContent || '').trim();
  }

  private numAttr(el: Element, name: string): number {
    const raw = el.getAttribute(name);
    if (raw == null || raw === '') {
      return 0;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
}
