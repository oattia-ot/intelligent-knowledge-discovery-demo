import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, of, shareReplay, switchMap } from 'rxjs';
import { AnswerConfigFile } from '../models/answer-config';
import { ParametricFiltersFile } from '../models/parametric';
import { RecommendationsConfigFile } from '../models/recommendation';
import { cacheBustedAsset } from '../utils/asset-url';
import { IdolDatabasesService } from './idol-databases.service';
import { UpstreamHostAdminService } from './upstream-host-admin.service';

export interface DatabaseConfig {
  id: string;
  databaseMatch: string;
  label: string;
  description?: string;
  defaultSelected?: boolean;
  titleFields?: string[];
  referenceStrategy?: string;
  notes?: string;
  documents?: string;
}

export interface DatabasesFile {
  defaultScope: string;
  databases: DatabaseConfig[];
}

export interface FieldsConfigFile {
  printMode?: string;
  printFields?: string[];
  pagination?: {
    /** MaxResults per page for Content Query (search results page). */
    pageSize?: number;
  };
  summary?: {
    enabled?: boolean;
    type?: string;
    characters?: number;
  };
  [key: string]: unknown;
}

export interface ExpertiseDisplayField {
  name: string;
  label: string;
  type?: 'text' | 'tel' | 'unix';
}

export interface ExpertiseConfigFile {
  enabled?: boolean;
  displayFields?: ExpertiseDisplayField[];
}

export type DocumentViewerMode = 'universal' | 'redaction';

export interface DocumentViewerConfigFile {
  $schema_comment?: string;
  documentViewer: {
    mode: DocumentViewerMode;
    universalApiUrl: string;
    redactionApiUrl: string;
    snippetRedactionEnabled: boolean;
  };
}

export interface AdminConfigFile {
  adminRole?: string;
  configApiUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  private readonly idolDatabases = inject(IdolDatabasesService);
  private readonly admin = inject(UpstreamHostAdminService);

  private databases$?: Observable<DatabasesFile>;
  private parametric$?: Observable<ParametricFiltersFile>;
  private fields$?: Observable<FieldsConfigFile>;
  private answer$?: Observable<AnswerConfigFile>;
  private expertise$?: Observable<ExpertiseConfigFile>;
  private recommendations$?: Observable<RecommendationsConfigFile>;
  private documentViewer$?: Observable<DocumentViewerConfigFile>;
  private admin$?: Observable<AdminConfigFile>;

  /**
   * Search / chat catalog.
   * Live Content GetStatus wins: every active IDOL database is listed.
   * databases.json only supplies labels / title fields for known names.
   */
  getDatabases(force = false): Observable<DatabasesFile> {
    if (force) {
      this.databases$ = undefined;
    }
    if (!this.databases$) {
      this.databases$ = this.http.get<DatabasesFile>('assets/config/databases.json').pipe(
        catchError(() => of({ defaultScope: 'all', databases: [] as DatabaseConfig[] })),
        switchMap((file) => from(this.mergeLiveDatabases(file))),
        shareReplay(1)
      );
    }
    return this.databases$;
  }

  /** Drop the cached catalog (call after creating a database). */
  refreshDatabases(): Observable<DatabasesFile> {
    return this.getDatabases(true);
  }

  private async mergeLiveDatabases(file: DatabasesFile): Promise<DatabasesFile> {
    const fallback = {
      defaultScope: file?.defaultScope || 'all',
      databases: Array.isArray(file?.databases) ? file.databases : []
    };
    const live = await this.idolDatabases.listDatabases(true);
    if (!live.ok || !live.databases.length) {
      return fallback;
    }
    const known = new Map(
      fallback.databases.map((row) => [row.databaseMatch.toLowerCase(), row] as const)
    );
    const databases: DatabaseConfig[] = live.databases.map((row) => {
      const preset =
        known.get(row.name.toLowerCase()) ||
        fallback.databases.find((item) => item.id.toLowerCase() === row.name.toLowerCase());
      const docs = row.documents?.trim();
      return {
        id: preset?.id || row.name,
        databaseMatch: preset?.databaseMatch || row.name,
        label: preset?.label || row.name,
        description:
          preset?.description ||
          (docs ? `${row.name} — ${docs} documents` : `${row.name} (Content)`),
        defaultSelected: preset?.defaultSelected !== false,
        titleFields: preset?.titleFields?.length
          ? preset.titleFields
          : ['DRETITLE', 'TITLE', 'NAME'],
        referenceStrategy: preset?.referenceStrategy || 'drereference',
        notes: preset?.notes,
        documents: docs
      };
    });
    return { defaultScope: 'all', databases };
  }

  getParametricFilters(): Observable<ParametricFiltersFile> {
    if (!this.parametric$) {
      this.parametric$ = this.http
        .get<ParametricFiltersFile>('assets/config/parametric-filters.json')
        .pipe(shareReplay(1));
    }
    return this.parametric$;
  }

  getFieldsConfig(): Observable<FieldsConfigFile> {
    if (!this.fields$) {
      this.fields$ = this.http
        .get<FieldsConfigFile>('assets/config/fields.json')
        .pipe(shareReplay(1));
    }
    return this.fields$;
  }

  /** AnswerServer NLQA detection lists (interrogatives, imperatives, …). */
  getAnswerConfig(): Observable<AnswerConfigFile> {
    if (!this.answer$) {
      this.answer$ = this.http
        .get<AnswerConfigFile>('assets/config/answer.json')
        .pipe(shareReplay(1));
    }
    return this.answer$;
  }

  getExpertiseConfig(): Observable<ExpertiseConfigFile> {
    if (!this.expertise$) {
      this.expertise$ = this.http
        .get<ExpertiseConfigFile>(cacheBustedAsset('assets/config/expertise.json'))
        .pipe(shareReplay(1));
    }
    return this.expertise$;
  }

  getRecommendationsConfig(): Observable<RecommendationsConfigFile> {
    if (!this.recommendations$) {
      this.recommendations$ = this.http
        .get<RecommendationsConfigFile>(cacheBustedAsset('assets/config/recommendations.json'))
        .pipe(shareReplay(1));
    }
    return this.recommendations$;
  }

  getDocumentViewerConfig(): Observable<DocumentViewerConfigFile> {
    if (!this.documentViewer$) {
      this.documentViewer$ = this.http
        .get<DocumentViewerConfigFile>(cacheBustedAsset('assets/config/document-viewer.json'))
        .pipe(shareReplay(1));
    }
    return this.documentViewer$;
  }

  refreshDocumentViewerConfig(
    next?: DocumentViewerConfigFile
  ): Observable<DocumentViewerConfigFile> {
    if (next) {
      this.documentViewer$ = of(next).pipe(shareReplay(1));
      return this.documentViewer$;
    }
    this.documentViewer$ = this.http
      .get<DocumentViewerConfigFile>(`assets/config/document-viewer.json?v=${Date.now()}`)
      .pipe(shareReplay(1));
    return this.documentViewer$;
  }

  getAdminConfig(): Observable<AdminConfigFile> {
    if (!this.admin$) {
      this.admin$ = this.http
        .get<AdminConfigFile>(cacheBustedAsset('assets/config/admin.json'))
        .pipe(shareReplay(1));
    }
    return this.admin$;
  }
}
