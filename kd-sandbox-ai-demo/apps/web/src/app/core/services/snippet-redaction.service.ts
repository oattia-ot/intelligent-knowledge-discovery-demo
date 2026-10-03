import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { RecommendedDocument } from '../models/recommendation';
import { SearchResult } from '../models/search';
import { AuthService } from './auth.service';
import { DocumentViewerSettingsService } from './document-viewer-settings.service';

interface SnippetRedactionResponse {
  status: string;
  redactedText: string;
}

@Injectable({ providedIn: 'root' })
export class SnippetRedactionService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly viewerSettings = inject(DocumentViewerSettingsService);

  redactSearchResults(hits: SearchResult[]): Observable<SearchResult[]> {
    if (!hits.length) {
      return of(hits);
    }
    return this.viewerSettings.resolveViewer().pipe(
      switchMap((viewer) => {
        if (!viewer.snippetRedactionEnabled) {
          return of(hits);
        }
        return this.redactTexts(
          hits.map((hit) => hit.summary),
          viewer.redactionApiUrl
        ).pipe(
          map((summaries) =>
            hits.map((hit, index) => ({
              ...hit,
              summary: summaries[index]
            }))
          )
        );
      })
    );
  }

  redactRecommendations(
    documents: RecommendedDocument[]
  ): Observable<RecommendedDocument[]> {
    if (!documents.length) {
      return of(documents);
    }
    return this.viewerSettings.resolveViewer().pipe(
      switchMap((viewer) => {
        if (!viewer.snippetRedactionEnabled) {
          return of(documents);
        }
        return this.redactTexts(
          documents.map((document) => document.summary ?? ''),
          viewer.redactionApiUrl
        ).pipe(
          map((summaries) =>
            documents.map((document, index) => ({
              ...document,
              summary: summaries[index]
            }))
          )
        );
      })
    );
  }

  private redactTexts(
    texts: string[],
    redactionApiUrl: string
  ): Observable<string[]> {
    const eligible = texts
      .map((text, index) => ({ index, text }))
      .filter(({ text }) => text.trim());
    if (!eligible.length) {
      return of(texts);
    }

    let boundary = '\n9f2a7c4e81d643b5a09e7f1c28d536ab\n';
    while (eligible.some(({ text }) => text.includes(boundary))) {
      boundary = boundary.replace(/\n$/, '0\n');
    }

    return this.redactText(
      eligible.map(({ text }) => text).join(boundary),
      redactionApiUrl
    ).pipe(
      map((redactedText) => {
        const redacted = redactedText.split(boundary);
        if (redacted.length !== eligible.length) {
          throw new Error(
            'Snippet redaction returned an invalid batched response.'
          );
        }
        const results = [...texts];
        eligible.forEach(({ index }, position) => {
          results[index] = redacted[position];
        });
        return results;
      })
    );
  }

  private redactText(text: string, redactionApiUrl: string): Observable<string> {
    if (!text.trim()) {
      return of(text);
    }
    const username = this.auth.getUser()?.username?.trim();
    if (!username) {
      return throwError(
        () => new Error('A signed-in user is required for snippet redaction.')
      );
    }
    const base = redactionApiUrl.replace(/\/+$/, '');
    return this.http
      .post<SnippetRedactionResponse>(
        `${base}/api/v1/redactions/snippet`,
        { username, text }
      )
      .pipe(
        map((response) => {
          if (
            response.status !== 'success' ||
            typeof response.redactedText !== 'string'
          ) {
            throw new Error('Snippet redaction returned an invalid response.');
          }
          return response.redactedText;
        }),
        // No RedactionView service on this demo host — keep original snippets.
        catchError((err) => {
          console.warn('[KD] Snippet redaction unavailable; showing original text.', err);
          return of(text);
        })
      );
  }
}
