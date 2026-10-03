import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  ContentQueryRequest,
  ContentQueryResponse,
  RecommendedDocument
} from '../models/recommendation';
import { SearchResult } from '../models/search';
import { AuthService } from './auth.service';
import { ConfigService } from './config.service';
import { ResultUrlService } from './result-url.service';

const DEFAULT_PRINT_FIELDS = [
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
  'OBJID',
  'FINAL_URL',
  'URL'
];

const TITLE_CANDIDATES = ['NAME', 'DRETITLE', 'TITLE'];
const DATE_CANDIDATES = ['DREDATE', 'DRECREATEDATE'];

/**
 * Direct Content ACI Query (no QMS). Used by My Recommendations so ranking
 * and snippets come from the user's weighted profile terms, not query rewrite.
 */
@Injectable({ providedIn: 'root' })
export class ContentSearchService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly config = inject(ConfigService);
  private readonly resultUrls = inject(ResultUrlService);

  query(req: ContentQueryRequest): Observable<ContentQueryResponse> {
    const text = (req.text ?? '').trim();
    if (!text) {
      return of({ documents: [], totalHits: 0, queryText: '' });
    }

    const token = this.auth.getSecurityInfo();
    // Same rule as SearchService: stub *or* unsecured Community (UserRead
    // succeeded but no SecurityInfo token) may call Content without a token.
    if (!token && !this.auth.allowsUnauthedAci()) {
      return throwError(() => new Error('You are not signed in. Please sign in again.'));
    }

    const maxResults = Math.max(1, req.maxResults || 2);
    const databases = (req.databases ?? []).map((d) => d.trim()).filter(Boolean);
    const summaryOn = req.summary !== false;
    const highlightOn = req.highlight !== false && summaryOn;
    const minScore = req.minScore ?? 0;

    return this.printFields().pipe(
      switchMap((printFields) => {
        let params = new HttpParams()
          .set('action', 'Query')
          .set('Text', text)
          .set('Print', req.print?.trim() || 'Fields')
          .set('PrintFields', printFields)
          .set('MaxResults', String(maxResults))
          .set('Start', '1')
          .set('TotalResults', 'True')
          .set('Predict', 'False')
          .set('ResponseFormat', 'simplejson');
        if (req.sort === 'date') {
          params = params.set('Sort', 'Date');
        }

        if (databases.length) {
          params = params.set('DatabaseMatch', databases.join(','));
        }
        if (summaryOn) {
          params = params
            .set('showsummary', 'true')
            .set('Summary', req.summaryType?.trim() || 'Context')
            .set('Characters', String(req.characters ?? environment.summaryContextLength ?? 200));
        } else {
          params = params.set('Summary', 'Off');
        }
        if (highlightOn) {
          params = params
            .set('Highlight', 'SummaryTerms')
            .set('Links', text.replace(/ /g, '+'))
            .set('HighlightTagTerm', 'true')
            .set('StartTag', "<mark class='kd-highlight'>")
            .set('EndTag', '</mark>');
        }
        if (minScore > 0) {
          params = params.set('MinScore', String(minScore));
        }
        if (req.fieldText?.trim()) {
          params = params.set('FieldText', req.fieldText.trim());
        }
        if (req.minDate?.trim()) {
          params = params.set('MinDate', req.minDate.trim());
        }
        if (req.maxDate?.trim()) {
          params = params.set('MaxDate', req.maxDate.trim());
        }
        if (token) {
          params = params.set('SecurityInfo', token);
        }

        const base = environment.contentApiUrl.replace(/\/?$/, '/');
        return this.http.get<unknown>(base, { params }).pipe(
          map((response) => this.parseResponse(response, text)),
          switchMap((parsed) => this.attachOpenUrls(parsed)),
          catchError((err) => throwError(() => this.toSearchError(err)))
        );
      })
    );
  }

  private attachOpenUrls(parsed: ContentQueryResponse): Observable<ContentQueryResponse> {
    if (!parsed.documents.length) {
      return of(parsed);
    }
    const hits: SearchResult[] = parsed.documents.map((doc) => this.toSearchResult(doc));
    return this.resultUrls.resolveHits(hits).pipe(
      map((resolved) => ({
        ...parsed,
        documents: resolved.map((hit, i) => this.fromSearchResult(hit, parsed.documents[i]))
      })),
      catchError(() => of(parsed))
    );
  }

  private parseResponse(response: unknown, queryText: string): ContentQueryResponse {
    const root = (response ?? {}) as Record<string, unknown>;
    const autn = (root['autnresponse'] ?? root) as Record<string, unknown>;
    if (!autn) {
      throw new Error('Unexpected search response.');
    }
    const status = String(autn['response'] ?? '').toUpperCase();
    if (status && status !== 'SUCCESS') {
      const data = (autn['responsedata'] ?? {}) as Record<string, unknown>;
      const errMsg =
        String(data['autn_errorstring'] ?? data['errorstring'] ?? '').trim() ||
        'Search failed.';
      throw new Error(errMsg);
    }

    const responseData = (autn['responsedata'] ?? {}) as Record<string, unknown>;
    const totalHits = this.toInt(
      responseData['totalhits'] ??
        responseData['autn:totalhits'] ??
        responseData['numhits'] ??
        responseData['autn:numhits'],
      0
    );
    let rawHits = responseData['hit'] ?? responseData['autn:hit'] ?? [];
    if (!Array.isArray(rawHits)) {
      rawHits = rawHits ? [rawHits] : [];
    }
    const documents = (rawHits as unknown[]).map((h) => this.mapHit(h));
    return { documents, totalHits, queryText };
  }

  private mapHit(raw: unknown): RecommendedDocument {
    const hit = (raw ?? {}) as Record<string, unknown>;
    const doc = this.flattenDocument(hit);
    const getField = (key: string): string => {
      const vals = doc[key] ?? doc[key.toUpperCase()] ?? doc[key.toLowerCase()];
      return vals?.length ? [...new Set(vals)].join('; ') : '';
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
      '';
    const reference =
      getField('DREREFERENCE') ||
      String(hit['reference'] ?? hit['autn:reference'] ?? '').trim();
    const database =
      String(hit['database'] ?? hit['autn:database'] ?? '').trim() || getField('DREDBNAME');
    const date =
      firstOf(DATE_CANDIDATES) || String(hit['date'] ?? hit['autn:date'] ?? '').trim();
    const summary = String(hit['summary'] ?? hit['autn:summary'] ?? '').trim();
    const score = parseFloat(String(hit['weight'] ?? hit['autn:weight'] ?? '0')) || 0;
    const idolId = String(hit['id'] ?? hit['autn:id'] ?? '').trim();

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

    return {
      reference,
      title: title || undefined,
      summary: summary || undefined,
      score,
      metadata: {
        database,
        date,
        mimeType: getField('PART_MIMETYPE'),
        author: getField('AUTHOR'),
        idolId: /^\d+$/.test(idolId) ? idolId : undefined,
        fields
      }
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
        doc[key] = [...(doc[key] ?? []), ...values];
        doc[k] = [...(doc[k] ?? []), ...values];
      }
    }
    return doc;
  }

  private toSearchResult(doc: RecommendedDocument): SearchResult {
    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    const fields = (meta['fields'] as Record<string, string> | undefined) ?? {};
    return {
      reference: doc.reference,
      title: doc.title || '(No title)',
      summary: doc.summary || '',
      database: String(meta['database'] ?? ''),
      date: String(meta['date'] ?? ''),
      mimeType: String(meta['mimeType'] ?? ''),
      author: String(meta['author'] ?? ''),
      weight: doc.score ?? 0,
      idolId: typeof meta['idolId'] === 'string' ? meta['idolId'] : undefined,
      fields
    };
  }

  private fromSearchResult(
    hit: SearchResult,
    original: RecommendedDocument
  ): RecommendedDocument {
    return {
      ...original,
      reference: hit.reference || original.reference,
      title: hit.title || original.title,
      summary: hit.summary || original.summary,
      score: hit.weight || original.score,
      metadata: {
        ...(original.metadata ?? {}),
        database: hit.database,
        date: hit.date,
        mimeType: hit.mimeType,
        author: hit.author,
        idolId: hit.idolId,
        url: hit.url,
        urlOpenIn: hit.urlOpenIn,
        urlLabel: hit.urlLabel,
        fields: hit.fields
      }
    };
  }

  private printFields(): Observable<string> {
    return this.config.getFieldsConfig().pipe(
      map((cfg) => {
        const fromConfig = (cfg.printFields ?? []).map((f) => String(f).trim()).filter(Boolean);
        return (fromConfig.length ? fromConfig : DEFAULT_PRINT_FIELDS).join(',');
      }),
      catchError(() => of(DEFAULT_PRINT_FIELDS.join(',')))
    );
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
        return new Error('Cannot reach Content. Check the proxy and engines.');
      }
      const body =
        typeof err.error === 'string'
          ? err.error
          : err.error
            ? JSON.stringify(err.error)
            : '';
      if (body.includes('AXEQUERY520') || body.toLowerCase().includes('security info')) {
        return new Error('SecurityInfo was rejected. Sign out and sign in again.');
      }
      return new Error(`Could not load recommended documents (HTTP ${err.status}).`);
    }
    return new Error('Could not load recommended documents.');
  }
}
