import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  CommunityProfile,
  DEFAULT_RECOMMENDATION_PARAMS,
  RecommendedDocument,
  RecommendationsConfigFile
} from '../models/recommendation';
import {
  buildWeightedQuery,
  dedupeByReference,
  selectTopTerms
} from '../utils/recommendation-query';
import { AuthService } from './auth.service';
import { CommunityProfileService } from './community-profile.service';
import { ConfigService } from './config.service';
import { ContentSearchService } from './content-search.service';
import { SnippetRedactionService } from './snippet-redaction.service';

export interface RecommendationsResult {
  documents: RecommendedDocument[];
  /** True when Community returned no usable profile terms. */
  noProfileTerms: boolean;
}

/**
 * Find-style recommendations: Community profile terms → weighted Content Query
 * → dedupe by reference. No middle tier; QMS is not on this path.
 */
@Injectable({ providedIn: 'root' })
export class RecommendationsService {
  private readonly profiles = inject(CommunityProfileService);
  private readonly content = inject(ContentSearchService);
  private readonly config = inject(ConfigService);
  private readonly auth = inject(AuthService);
  private readonly snippetRedaction = inject(SnippetRedactionService);

  private cacheUser = '';
  private cacheValue: RecommendationsResult | null = null;
  private inFlight: Observable<RecommendationsResult> | null = null;

  getRecommendations(forceRefresh = false): Observable<RecommendationsResult> {
    const user = this.auth.getUser()?.username?.trim() ?? '';
    if (!forceRefresh && this.cacheValue && this.cacheUser === user) {
      return this.applySnippetRedaction(this.cacheValue);
    }
    if (!forceRefresh && this.inFlight) {
      return this.inFlight.pipe(
        switchMap((result) => this.applySnippetRedaction(result))
      );
    }

    this.cacheUser = user;
    this.inFlight = this.load().pipe(
      map((result) => {
        this.cacheValue = result;
        this.inFlight = null;
        return result;
      }),
      catchError((err) => {
        this.inFlight = null;
        return throwError(() => err);
      })
    );
    return this.inFlight.pipe(
      switchMap((result) => this.applySnippetRedaction(result))
    );
  }

  clearCache(): void {
    this.cacheUser = '';
    this.cacheValue = null;
    this.inFlight = null;
  }

  private load(): Observable<RecommendationsResult> {
    return this.settings().pipe(
      switchMap(({ cfg, databases }) =>
        this.profiles.getCurrentUserProfiles(cfg.namedArea).pipe(
          switchMap((allProfiles) => {
            const maxProfiles = cfg.maxProfiles ?? DEFAULT_RECOMMENDATION_PARAMS.maxProfiles;
            const maxTerms = cfg.maxTerms ?? DEFAULT_RECOMMENDATION_PARAMS.maxTerms;
            const selected = allProfiles
              .filter((p) => selectTopTerms(p.terms, maxTerms).length > 0)
              .slice(0, Math.max(1, maxProfiles));

            if (!selected.length) {
              return of({ documents: [] as RecommendedDocument[], noProfileTerms: true });
            }

            const requests = selected.map((profile) =>
              this.queryProfile(profile, cfg, databases, maxTerms)
            );

            return forkJoin(requests).pipe(
              map((groups) => {
                const failed = groups.filter((g) => !g.ok);
                const docs = groups.filter((g) => g.ok).flatMap((g) => g.docs);
                if (failed.length === groups.length) {
                  throw failed[0]?.error ?? new Error('Could not load recommended documents.');
                }
                return dedupeByReference(docs);
              }),
              map((documents) => ({ documents, noProfileTerms: false }))
            );
          })
        )
      )
    );
  }

  private applySnippetRedaction(
    result: RecommendationsResult
  ): Observable<RecommendationsResult> {
    return this.snippetRedaction.redactRecommendations(result.documents).pipe(
      map((documents) => ({ ...result, documents })),
      catchError(() => of(result))
    );
  }

  private queryProfile(
    profile: CommunityProfile,
    cfg: RecommendationsConfigFile,
    databases: string[],
    maxTerms: number
  ): Observable<{ ok: true; docs: RecommendedDocument[] } | { ok: false; error: Error }> {
    const terms = selectTopTerms(profile.terms, maxTerms);
    const text = buildWeightedQuery(terms);
    if (!text) {
      return of({ ok: true, docs: [] });
    }

    const maxResults =
      cfg.maxResultsPerProfile ?? DEFAULT_RECOMMENDATION_PARAMS.maxResultsPerProfile;

    return this.content
      .query({
        text,
        maxResults,
        sort: 'relevance',
        print: 'Fields',
        highlight: cfg.highlight ?? DEFAULT_RECOMMENDATION_PARAMS.highlight,
        summary: cfg.summary ?? DEFAULT_RECOMMENDATION_PARAMS.summary,
        summaryType: cfg.summaryType ?? DEFAULT_RECOMMENDATION_PARAMS.summaryType,
        characters: cfg.characters ?? DEFAULT_RECOMMENDATION_PARAMS.characters,
        minScore: cfg.minScore ?? DEFAULT_RECOMMENDATION_PARAMS.minScore,
        databases,
        fieldText: cfg.fieldText,
        minDate: cfg.minDate,
        maxDate: cfg.maxDate
      })
      .pipe(
        map((res) => ({ ok: true as const, docs: res.documents })),
        catchError((err: unknown) =>
          of({
            ok: false as const,
            error: err instanceof Error ? err : new Error('Could not load recommended documents.')
          })
        )
      );
  }

  private settings(): Observable<{ cfg: RecommendationsConfigFile; databases: string[] }> {
    return this.config.getRecommendationsConfig().pipe(
      catchError(() => of({} as RecommendationsConfigFile)),
      switchMap((cfg) => {
        const configured = (cfg.databases ?? []).map((d) => d.trim()).filter(Boolean);
        if (configured.length) {
          this.rememberUser();
          return of({ cfg, databases: configured });
        }
        return this.config.getDatabases().pipe(
          map((file) => {
            this.rememberUser();
            const databases = (file.databases ?? [])
              .filter((d) => d.defaultSelected !== false)
              .map((d) => d.databaseMatch)
              .filter(Boolean);
            return { cfg, databases };
          }),
          catchError(() => {
            this.rememberUser();
            return of({ cfg, databases: configured });
          })
        );
      })
    );
  }

  private rememberUser(): void {
    this.cacheUser = this.auth.getUser()?.username?.trim() ?? '';
  }
}
