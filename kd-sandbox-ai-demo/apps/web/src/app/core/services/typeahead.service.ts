import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AppSettingsService } from './app-settings.service';
import { AuthService } from './auth.service';

const AUTN_NS = 'http://schemas.autonomy.com/aci/';

export interface TypeaheadSuggestion {
  /**
   * Display + search text (Title Case).
   * QMS Index expansions are usually ALL CAPS; we normalise for the UI.
   */
  text: string;
  /** Original expansion from QMS (before casing). */
  raw: string;
  /** Optional QMS score (higher = more frequent / relevant). */
  score: number;
}

/**
 * QMS index TypeAhead for the search box.
 *
 *   GET /qms/?action=TypeAhead&Mode=Index&MaxResults=5&Text=…&SecurityInfo=…
 *
 * Response (XML):
 *   <autn:expansion score="35">WAIKATO</autn:expansion>
 */
@Injectable({ providedIn: 'root' })
export class TypeaheadService {
  private readonly http = inject(HttpClient);
  private readonly appSettings = inject(AppSettingsService);
  private readonly auth = inject(AuthService);

  /** Minimum characters before calling QMS (avoids noisy single-letter traffic). */
  readonly minChars = 2;
  /** Cap suggestions so the dropdown never needs a scrollbar. */
  readonly defaultMaxResults = 5;

  /**
   * Fetch index expansions for the typed prefix.
   * Failures return [] — typeahead must never block search.
   */
  suggest(text: string, maxResults = this.defaultMaxResults): Observable<TypeaheadSuggestion[]> {
    const q = (text ?? '').trim();
    if (q.length < this.minChars || q === '*') {
      return of([]);
    }

    const base = this.appSettings.requestUrl('qmsApiUrl').replace(/\/?$/, '/');
    let params = new HttpParams()
      .set('action', 'TypeAhead')
      .set('Mode', 'Index')
      .set('MaxResults', String(Math.max(1, Math.min(maxResults, this.defaultMaxResults))))
      .set('Text', q);

    const token = this.auth.getSecurityInfo();
    if (token) {
      // HttpParams encodes once (required for + / = in SecurityInfo)
      params = params.set('SecurityInfo', token);
    }

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((xml) => this.parseTypeAheadXml(xml)),
      catchError(() => of([]))
    );
  }

  private parseTypeAheadXml(xmlText: string): TypeaheadSuggestion[] {
    if (!xmlText?.trim()) {
      return [];
    }

    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return [];
    }

    const responseEl = doc.getElementsByTagName('response')[0];
    const response = (responseEl?.textContent || '').trim().toUpperCase();
    if (response && response !== 'SUCCESS') {
      return [];
    }

    const expansions = this.collectExpansionElements(doc);
    const out: TypeaheadSuggestion[] = [];
    const seen = new Set<string>();

    for (const el of expansions) {
      const raw = (el.textContent || '').trim();
      if (!raw) {
        continue;
      }
      const key = raw.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const scoreRaw = el.getAttribute('score');
      const score = scoreRaw != null && scoreRaw !== '' ? Number(scoreRaw) : 0;
      out.push({
        raw,
        text: TypeaheadService.toDisplayCase(raw),
        score: Number.isFinite(score) ? score : 0
      });
    }

    // Hard cap so the pane never scrolls (UI shows up to defaultMaxResults)
    return out.slice(0, this.defaultMaxResults);
  }

  /**
   * Turn QMS ALL CAPS (or mixed) expansions into Title Case for the UI.
   * e.g. "WAIKATO REGIONAL COUNCIL" → "Waikato Regional Council"
   * Words split on spaces, hyphens, underscores, and slashes.
   */
  static toDisplayCase(raw: string): string {
    const s = (raw ?? '').trim();
    if (!s) {
      return '';
    }
    // Already looks mixed-case (not all-upper) — keep as-is
    if (s !== s.toUpperCase() && s !== s.toLowerCase()) {
      return s;
    }
    return s
      .toLowerCase()
      .replace(/(^|[\s\-_\/])(\S)/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
  }

  private collectExpansionElements(doc: Document): Element[] {
    const byNs = Array.from(doc.getElementsByTagNameNS(AUTN_NS, 'expansion'));
    if (byNs.length) {
      return byNs;
    }
    // Some engines omit or vary the namespace prefix
    return Array.from(doc.getElementsByTagName('autn:expansion')).concat(
      Array.from(doc.getElementsByTagName('expansion'))
    );
  }
}
