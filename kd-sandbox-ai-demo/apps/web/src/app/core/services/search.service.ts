import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  FacetField,
  FacetRequest,
  FacetValue,
  SearchRequest,
  SearchResponse,
  SearchResult
} from '../models/search';
import { AppSettingsService } from './app-settings.service';
import { AuthService } from './auth.service';
import { ConceptSearchSettingsService } from './concept-search-settings.service';
import { ResultUrlService } from './result-url.service';

const PRINT_FIELDS = [
  'DRETITLE',
  'TITLE',
  'NAME',
  'DREREFERENCE',
  'DREDBNAME',
  'DREDATE',
  'DRECREATEDATE',
  'PART_MIMETYPE',
  'AUTHOR',
  'FOLDER',
  'CONNECTOR_GROUP',
  'DETECTEDLANGUAGE',
  'NODE_ID',
  'OBJID'
].join(',');

const TITLE_CANDIDATES = ['NAME', 'DRETITLE', 'TITLE'];
const DATE_CANDIDATES = ['DREDATE', 'DRECREATEDATE'];

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);
  private readonly appSettings = inject(AppSettingsService);
  private readonly auth = inject(AuthService);
  private readonly resultUrls = inject(ResultUrlService);
  private readonly searchSettings = inject(ConceptSearchSettingsService);

  search(req: SearchRequest): Observable<SearchResponse> {
    const pageSize = req.pageSize ?? 20;
    const start = req.start ?? 1;
    const text = (req.queryText ?? '').trim() || '*';
    const token = this.auth.getSecurityInfo();
    const isMatchAll = text === '*';

    if (!token && !this.auth.allowsUnauthedAci()) {
      return throwError(() => new Error('You are not signed in. Please sign in again.'));
    }

    if (!req.databases.length) {
      return throwError(() => new Error('Select at least one database to search.'));
    }

    const base = this.appSettings.requestUrl('contentApiUrl').replace(/\/?$/, '/');
    const summaryType = this.searchSettings.summaryType();
    const summaryLen = this.searchSettings.summaryLength();
    const summaryOff = summaryType === 'Off';

    let params = new HttpParams()
      .set('action', 'Query')
      .set('Text', text)
      .set('DatabaseMatch', req.databases.join(','))
      .set('Print', 'Fields')
      .set('PrintFields', PRINT_FIELDS)
      .set('MaxResults', String(pageSize))
      .set('Start', String(start))
      .set('TotalResults', 'True')
      .set('Predict', 'False')
      .set('Sort', 'Relevance')
      .set('ResponseFormat', 'simplejson');

    if (summaryOff) {
      params = params.set('Summary', 'Off');
    } else if (!isMatchAll) {
      // Term search: full summary + highlight (worth the cost for relevance UX).
      const links = text.replace(/ /g, '+');
      params = params
        .set('showsummary', 'true')
        .set('Summary', summaryType)
        .set('Characters', String(summaryLen))
        .set('Highlight', 'SummaryTerms')
        .set('Links', links)
        .set('HighlightTagTerm', 'true')
        .set('StartTag', "<mark class='kd-highlight'>")
        .set('EndTag', '</mark>');
    } else {
      // Match-all (Text=*): Context/Paragraph/Sentence force heavy per-hit extraction
      // across every returned doc (and with SecurityInfo this dominates latency).
      // Quick is a cheap teaser; honour Off / Concept / Quick from Settings as-is.
      const matchAllType =
        summaryType === 'Context' ||
        summaryType === 'Paragraph' ||
        summaryType === 'Sentence'
          ? 'Quick'
          : summaryType;
      const matchAllChars = Math.min(summaryLen, 120);
      params = params
        .set('showsummary', 'true')
        .set('Summary', matchAllType)
        .set('Characters', String(matchAllChars));
    }

    if (req.fieldText?.trim()) {
      params = params.set('FieldText', req.fieldText.trim());
    }

    if (token) {
      // HttpParams encodes once (required for + / = in SecurityInfo)
      params = params.set('SecurityInfo', token);
    }

    return this.http.get<unknown>(base, { params }).pipe(
      map((response) => this.parseResponse(response, text, start, pageSize)),
      // Attach open-URLs after parse. Preload is started on search page init so
      // this is usually synchronous; if not, never fail the whole search.
      switchMap((parsed) =>
        this.resultUrls.resolveHits(parsed.hits).pipe(
          map((hits) => ({ ...parsed, hits })),
          catchError(() => of(parsed))
        )
      ),
      catchError((err) => throwError(() => this.toSearchError(err)))
    );
  }

  /**
   * Visible document count per database for the current query (Print=NoResults).
   * One cheap Query per DB so SecurityInfo and FieldText are honoured.
   */
  getDatabaseCounts(req: {
    queryText: string;
    databases: string[];
    fieldText?: string;
  }): Observable<Map<string, number>> {
    const dbs = [...new Set(req.databases.map((d) => d.trim()).filter(Boolean))];
    if (!dbs.length) {
      return of(new Map());
    }

    const token = this.auth.getSecurityInfo();
    if (!token && !this.auth.allowsUnauthedAci()) {
      return throwError(() => new Error('You are not signed in.'));
    }

    const text = (req.queryText ?? '').trim() || '*';
    const base = this.appSettings.requestUrl('contentApiUrl').replace(/\/?$/, '/');

    const requests = dbs.map((database) => {
      let params = new HttpParams()
        .set('action', 'Query')
        .set('Text', text)
        .set('DatabaseMatch', database)
        .set('Print', 'NoResults')
        .set('MaxResults', '1')
        .set('TotalResults', 'True')
        .set('Predict', 'False')
        .set('Summary', 'Off')
        .set('ResponseFormat', 'simplejson');
      if (req.fieldText?.trim()) {
        params = params.set('FieldText', req.fieldText.trim());
      }
      if (token) {
        params = params.set('SecurityInfo', token);
      }
      return this.http.get<unknown>(base, { params }).pipe(
        map((response) => {
          const parsed = this.parseResponse(response, text, 1, 1);
          return [database, parsed.totalHits] as const;
        }),
        catchError(() => of([database, 0] as const))
      );
    });

    return forkJoin(requests).pipe(map((pairs) => new Map(pairs)));
  }

  /**
   * Load parametric facet values (GetQueryTagValues).
   * Returns raw fields keyed by idol path; caller maps labels from config.
   *
   * Always uses FieldName=* then filters client-side. Listing only configured
   * fields fails on this engine when any entry is not parametric (HTTP 200 +
   * empty/error body — no reliable HTTP error to trigger a fallback).
   */
  getFacetValues(req: FacetRequest): Observable<Map<string, FacetValue[]>> {
    const text = (req.queryText ?? '').trim() || '*';
    const token = this.auth.getSecurityInfo();
    if (!token && !this.auth.allowsUnauthedAci()) {
      return throwError(() => new Error('You are not signed in.'));
    }
    if (!req.databases.length) {
      return throwError(() => new Error('Select at least one database.'));
    }

    const base = this.appSettings.requestUrl('contentApiUrl').replace(/\/?$/, '/');
    let params = new HttpParams()
      .set('action', 'GetQueryTagValues')
      .set('Text', text)
      .set('DatabaseMatch', req.databases.join(','))
      .set('FieldName', '*')
      .set('DocumentCount', 'True')
      // Sidebar shows top 5; dialog lists the rest — 50 per field is enough.
      .set('MaxValues', '50');

    if (req.fieldText?.trim()) {
      params = params.set('FieldText', req.fieldText.trim());
    }
    if (token) {
      params = params.set('SecurityInfo', token);
    }

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((xml) => this.parseTagValues(xml, req.idolFields)),
      switchMap((parsed) => this.fillMissingTagValues(req, parsed)),
      map((parsed) => parsed.values),
      catchError((err) => throwError(() => this.toSearchError(err)))
    );
  }

  /**
   * FieldName=DOCUMENT/X is rejected on this engine even when the short name
   * works (READABILITY_LANG). Only retry fields that * already listed with no
   * values — never probe non-parametric fields and never sample Query.
   */
  private fillMissingTagValues(
    req: FacetRequest,
    parsed: { values: Map<string, FacetValue[]>; seen: Set<string> }
  ): Observable<{ values: Map<string, FacetValue[]>; seen: Set<string> }> {
    const missing = req.idolFields
      .map((path) => this.shortFieldName(path))
      .filter(
        (short) =>
          !!short &&
          parsed.seen.has(short.toUpperCase()) &&
          !this.lookupFacetValues(parsed.values, short).length
      );
    if (!missing.length) {
      return of(parsed);
    }

    const token = this.auth.getSecurityInfo();
    const base = this.appSettings.requestUrl('contentApiUrl').replace(/\/?$/, '/');
    const requests = missing.map((short) => {
      let params = new HttpParams()
        .set('action', 'GetQueryTagValues')
        .set('Text', (req.queryText ?? '').trim() || '*')
        .set('DatabaseMatch', req.databases.join(','))
        .set('FieldName', short)
        .set('DocumentCount', 'True')
        .set('MaxValues', '50');
      if (req.fieldText?.trim()) {
        params = params.set('FieldText', req.fieldText.trim());
      }
      if (token) {
        params = params.set('SecurityInfo', token);
      }
      return this.http.get(base, { params, responseType: 'text' }).pipe(
        map((xml) => this.parseTagValues(xml, [short])),
        catchError(() =>
          of({ values: new Map<string, FacetValue[]>(), seen: new Set<string>() })
        )
      );
    });

    return forkJoin(requests).pipe(
      map((extras) => {
        const merged = new Map(parsed.values);
        for (const extra of extras) {
          for (const [k, v] of extra.values) {
            if (v.length) {
              this.indexFacetValues(merged, k, v);
            }
          }
        }
        return { values: merged, seen: parsed.seen };
      })
    );
  }

  /**
   * Fetch documents by DREREFERENCE via Content GetContent.
   * Soft-fails to [] so callers (e.g. AnswerServer source titles) can fall back.
   */
  getByReferences(
    references: string[],
    databases: string[] = []
  ): Observable<SearchResult[]> {
    const refs = [
      ...new Set(references.map((r) => (r ?? '').trim()).filter(Boolean))
    ];
    if (!refs.length) {
      return of([]);
    }

    const token = this.auth.getSecurityInfo();
    const base = this.appSettings.requestUrl('contentApiUrl').replace(/\/?$/, '/');
    let params = new HttpParams()
      .set('action', 'GetContent')
      .set('Print', 'Fields')
      .set('PrintFields', PRINT_FIELDS)
      .set('ResponseFormat', 'simplejson');

    for (const reference of refs) {
      params = params.append('Reference', reference);
    }
    if (databases.length) {
      params = params.set('DatabaseMatch', databases.join(','));
    }
    if (token) {
      params = params.set('SecurityInfo', token);
    }

    return this.http.get<unknown>(base, { params }).pipe(
      map((response) => this.parseResponse(response, refs.join(','), 1, refs.length).hits),
      switchMap((hits) => {
        const missing = this.unmatchedReferences(refs, hits);
        if (!missing.length) {
          return of(hits);
        }
        return this.queryByMatchReferences(missing, databases).pipe(
          map((extra) => [...hits, ...extra])
        );
      }),
      catchError(() => this.queryByMatchReferences(refs, databases))
    );
  }

  /** Query + MatchReference for refs GetContent did not return. */
  private queryByMatchReferences(
    references: string[],
    databases: string[]
  ): Observable<SearchResult[]> {
    const refs = references.map((r) => r.trim()).filter(Boolean);
    if (!refs.length) {
      return of([]);
    }

    const token = this.auth.getSecurityInfo();
    const base = this.appSettings.requestUrl('contentApiUrl').replace(/\/?$/, '/');

    const requests = refs.map((reference) => {
      let params = new HttpParams()
        .set('action', 'Query')
        .set('Text', '*')
        .set('MatchReference', reference)
        .set('Print', 'Fields')
        .set('PrintFields', PRINT_FIELDS)
        .set('MaxResults', '1')
        .set('TotalResults', 'False')
        .set('Predict', 'False')
        .set('Summary', 'Off')
        .set('ResponseFormat', 'simplejson');
      if (databases.length) {
        params = params.set('DatabaseMatch', databases.join(','));
      }
      if (token) {
        params = params.set('SecurityInfo', token);
      }
      return this.http.get<unknown>(base, { params }).pipe(
        map((response) => this.parseResponse(response, reference, 1, 1).hits),
        catchError(() => of([] as SearchResult[]))
      );
    });

    return forkJoin(requests).pipe(map((groups) => groups.flat()));
  }

  private unmatchedReferences(refs: string[], hits: SearchResult[]): string[] {
    const found = new Set(
      hits.flatMap((h) =>
        [h.reference, h.fields['DREREFERENCE'] || '']
          .map((v) => this.normalizeLookupRef(v))
          .filter(Boolean)
      )
    );
    return refs.filter((r) => !found.has(this.normalizeLookupRef(r)));
  }

  private normalizeLookupRef(ref: string): string {
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

  /** Build IDOL FieldText from selected facet values. */
  static buildFieldText(
    selections: {
      fieldTextName: string;
      values: string[];
      operator?: 'MATCH' | 'STRING';
    }[]
  ): string {
    const parts: string[] = [];
    for (const sel of selections) {
      if (!sel.values.length) {
        continue;
      }
      const escaped = sel.values.map((v) => v.replace(/[{},]/g, ' ').trim()).filter(Boolean);
      if (!escaped.length) {
        continue;
      }
      const op = sel.operator === 'STRING' ? 'STRING' : 'MATCH';
      if (op === 'STRING' && escaped.length > 1) {
        parts.push(
          `(${escaped.map((v) => `STRING{${v}}:${sel.fieldTextName}`).join(' OR ')})`
        );
      } else {
        parts.push(`${op}{${escaped.join(',')}}:${sel.fieldTextName}`);
      }
    }
    return parts.join(' AND ');
  }

  private parseTagValues(
    xmlText: string,
    allowedIdolFields: string[]
  ): { values: Map<string, FacetValue[]>; seen: Set<string> } {
    const result = new Map<string, FacetValue[]>();
    const seen = new Set<string>();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const ns = 'http://schemas.autonomy.com/aci/';

    const allowed = new Set<string>();
    for (const f of allowedIdolFields) {
      const short = this.shortFieldName(f);
      allowed.add(f.toUpperCase());
      allowed.add(short.toUpperCase());
      allowed.add(`DOCUMENT/${short}`.toUpperCase());
    }

    let fieldNodes = Array.from(doc.getElementsByTagNameNS(ns, 'field'));
    if (!fieldNodes.length) {
      fieldNodes = Array.from(doc.getElementsByTagName('field'));
    }
    for (const fieldNode of fieldNodes) {
      const name =
        fieldNode.getElementsByTagNameNS(ns, 'name')[0]?.textContent?.trim() ||
        fieldNode.getElementsByTagName('name')[0]?.textContent?.trim() ||
        '';
      if (!name) {
        continue;
      }
      const nameUp = name.toUpperCase();
      const shortUp = this.shortFieldName(name).toUpperCase();
      if (allowed.size && !allowed.has(nameUp) && !allowed.has(shortUp)) {
        if (allowedIdolFields.length > 0) {
          continue;
        }
      }
      seen.add(nameUp);
      seen.add(shortUp);

      const values: FacetValue[] = [];
      let valueNodes = Array.from(fieldNode.getElementsByTagNameNS(ns, 'value'));
      if (!valueNodes.length) {
        valueNodes = Array.from(fieldNode.getElementsByTagName('value'));
      }
      for (const vNode of valueNodes) {
        const text = vNode.textContent?.trim() ?? '';
        if (!text) {
          continue;
        }
        const countAttr = Array.from(vNode.attributes).find((a) => a.localName === 'count');
        const count = parseInt(countAttr?.value ?? '0', 10);
        values.push({ value: text, count: Number.isFinite(count) ? count : 0 });
      }
      if (values.length) {
        this.indexFacetValues(result, name, values);
      }
    }
    return { values: result, seen };
  }

  private shortFieldName(path: string): string {
    const raw = (path ?? '').trim();
    return raw.includes('/') ? raw.split('/').pop() || raw : raw;
  }

  lookupFacetValues(valueMap: Map<string, FacetValue[]>, field: string): FacetValue[] {
    const short = this.shortFieldName(field);
    return (
      valueMap.get(field) ||
      valueMap.get(field.toUpperCase()) ||
      valueMap.get(short) ||
      valueMap.get(short.toUpperCase()) ||
      valueMap.get(`DOCUMENT/${short}`) ||
      valueMap.get(`DOCUMENT/${short}`.toUpperCase()) ||
      []
    );
  }

  facetOperator(valueMap: Map<string, FacetValue[]>, field: string): 'MATCH' | 'STRING' {
    const short = this.shortFieldName(field).toUpperCase();
    const flag = valueMap.get(`__op:${short}`);
    return flag?.[0]?.value === 'STRING' ? 'STRING' : 'MATCH';
  }

  private indexFacetValues(
    dest: Map<string, FacetValue[]>,
    name: string,
    values: FacetValue[]
  ): void {
    const short = this.shortFieldName(name);
    for (const key of [
      name,
      name.toUpperCase(),
      short,
      short.toUpperCase(),
      `DOCUMENT/${short}`,
      `DOCUMENT/${short}`.toUpperCase()
    ]) {
      dest.set(key, values);
    }
  }

  private parseResponse(
    response: unknown,
    queryText: string,
    start: number,
    pageSize: number
  ): SearchResponse {
    const root = response as Record<string, unknown>;
    const autn = (root?.['autnresponse'] ?? root) as Record<string, unknown> | undefined;

    if (!autn) {
      throw new Error('Unexpected search response from Content.');
    }

    const status = String(autn['response'] ?? '').toUpperCase();
    if (status && status !== 'SUCCESS') {
      const data = autn['responsedata'] as Record<string, unknown> | undefined;
      const errMsg =
        (data?.['autn_errorstring'] as string) ||
        (data?.['errorstring'] as string) ||
        'Search failed.';
      throw new Error(errMsg);
    }

    const responseData = (autn['responsedata'] ?? {}) as Record<string, unknown>;
    const numHits = this.toInt(responseData['numhits'] ?? responseData['autn:numhits'], 0);
    const totalHits = this.toInt(
      responseData['totalhits'] ??
        responseData['autn:totalhits'] ??
        responseData['total_hits'] ??
        numHits,
      numHits
    );

    let rawHits = responseData['hit'] ?? responseData['autn:hit'] ?? [];
    if (!Array.isArray(rawHits)) {
      rawHits = rawHits ? [rawHits] : [];
    }

    const hits: SearchResult[] = (rawHits as unknown[])
      .map((h) => this.mapHit(h))
      .sort((a, b) => (b.weight || 0) - (a.weight || 0));

    return { hits, totalHits, numHits, queryText, start, pageSize };
  }

  private mapHit(raw: unknown): SearchResult {
    const hit = (raw ?? {}) as Record<string, unknown>;
    const doc = this.flattenDocument(hit);

    const getField = (key: string): string => {
      const vals = doc[key] ?? doc[key.toUpperCase()] ?? doc[key.toLowerCase()];
      if (!vals?.length) {
        return '';
      }
      return [...new Set(vals)].join('; ');
    };

    const firstOf = (keys: string[]): string => {
      for (const k of keys) {
        const v = getField(k);
        if (v) {
          return v;
        }
      }
      return '';
    };

    const title =
      firstOf(TITLE_CANDIDATES) ||
      String(hit['title'] ?? hit['autn:title'] ?? '').trim() ||
      '(No title)';

    const reference =
      getField('DREREFERENCE') ||
      String(hit['reference'] ?? hit['autn:reference'] ?? '').trim();

    const idolIdRaw = String(hit['id'] ?? hit['autn:id'] ?? '').trim();
    const idolId = /^\d+$/.test(idolIdRaw) ? idolIdRaw : undefined;

    const database =
      String(hit['database'] ?? hit['autn:database'] ?? '').trim() ||
      getField('DREDBNAME');

    const date =
      firstOf(DATE_CANDIDATES) ||
      String(hit['date'] ?? hit['autn:date'] ?? '').trim();

    const summary = String(hit['summary'] ?? hit['autn:summary'] ?? '').trim();

    // Flat field map for Handlebars (prefer upper-case keys)
    const fields: Record<string, string> = {};
    for (const [k, vals] of Object.entries(doc)) {
      if (!vals?.length) {
        continue;
      }
      const joined = [...new Set(vals)].join('; ');
      fields[k] = joined;
      fields[k.toUpperCase()] = joined;
    }
    fields['DREREFERENCE'] = fields['DREREFERENCE'] || reference;
    fields['DRETITLE'] = fields['DRETITLE'] || title;
    fields['DATABASE'] = database;
    fields['DREDBNAME'] = fields['DREDBNAME'] || database;
    // NODE_ID: index field or OpenText:<id> from reference
    if (!fields['NODE_ID']) {
      const m = /^OpenText:(\d+)/i.exec(reference);
      if (m) {
        fields['NODE_ID'] = m[1];
      } else if (fields['OBJID']) {
        fields['NODE_ID'] = fields['OBJID'];
      }
    }

    return {
      reference,
      title,
      summary,
      database,
      date,
      mimeType: getField('PART_MIMETYPE'),
      author: getField('AUTHOR'),
      weight: parseFloat(String(hit['weight'] ?? hit['autn:weight'] ?? '0')) || 0,
      idolId,
      fields
    };
  }

  private flattenDocument(hit: Record<string, unknown>): Record<string, string[]> {
    const doc: Record<string, string[]> = {};
    const content = hit['content'] as Record<string, unknown> | undefined;
    let docArray = content?.['DOCUMENT'] ?? content?.['document'];

    if (!docArray) {
      return doc;
    }

    if (!Array.isArray(docArray)) {
      docArray = [docArray];
    }

    for (const item of docArray as unknown[]) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        const key = k.toUpperCase();
        const values = Array.isArray(v) ? v.map(String) : [String(v)];
        if (!doc[key]) {
          doc[key] = [];
        }
        doc[key].push(...values);
        if (!doc[k]) {
          doc[k] = [];
        }
        doc[k].push(...values);
      }
    }

    return doc;
  }

  private toInt(value: unknown, fallback: number): number {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  private toSearchError(err: unknown): Error {
    if (err instanceof Error && !(err instanceof HttpErrorResponse)) {
      return err;
    }
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new Error('Cannot reach Content. Check the proxy and Content engine.');
      }
      const body =
        typeof err.error === 'string'
          ? err.error
          : err.error
            ? JSON.stringify(err.error)
            : '';
      if (body.includes('AXEQUERY520') || body.toLowerCase().includes('security info')) {
        return new Error(
          'SecurityInfo was rejected by Content. Sign out and sign in again.'
        );
      }
      return new Error(`Search request failed (HTTP ${err.status}).`);
    }
    return new Error('Search request failed.');
  }
}
