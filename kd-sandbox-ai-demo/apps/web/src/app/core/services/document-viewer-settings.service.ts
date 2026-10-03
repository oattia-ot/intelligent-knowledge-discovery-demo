import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, switchMap, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AdminConfigService } from './admin-config.service';
import {
  ConfigService,
  DocumentViewerConfigFile,
  DocumentViewerMode
} from './config.service';

@Injectable({ providedIn: 'root' })
export class DocumentViewerSettingsService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);
  private readonly adminConfig = inject(AdminConfigService);

  private readonly configuredViewer =
    signal<DocumentViewerConfigFile['documentViewer'] | null>(null);
  /** In-memory admin draft; not written until Save to server. */
  private readonly overrideMode = signal<DocumentViewerMode | null>(null);
  private readonly overrideSnippetRedaction = signal<boolean | null>(null);
  private readonly universalApiUrlOverride = signal<string | null>(null);
  private readonly redactionApiUrlOverride = signal<string | null>(null);

  readonly ready = computed(() => this.configuredViewer() !== null);
  readonly mode = computed(
    () =>
      this.overrideMode() ??
      this.configuredViewer()?.mode ??
      'universal'
  );
  readonly configuredMode = computed(
    () => this.configuredViewer()?.mode ?? null
  );
  readonly snippetRedactionEnabled = computed(
    () =>
      this.overrideSnippetRedaction() ??
      this.configuredViewer()?.snippetRedactionEnabled ??
      false
  );
  readonly configuredSnippetRedactionEnabled = computed(
    () => this.configuredViewer()?.snippetRedactionEnabled ?? null
  );
  readonly universalApiUrl = computed(
    () =>
      this.universalApiUrlOverride() ??
      this.configuredViewer()?.universalApiUrl ??
      environment.viewApiUrl
  );
  readonly redactionApiUrl = computed(
    () =>
      this.redactionApiUrlOverride() ??
      this.configuredViewer()?.redactionApiUrl ??
      ''
  );
  readonly configuredUniversalApiUrl = computed(
    () => this.configuredViewer()?.universalApiUrl ?? null
  );
  readonly configuredRedactionApiUrl = computed(
    () => this.configuredViewer()?.redactionApiUrl ?? null
  );
  readonly redactionEndpoint = computed(() => {
    const base = this.redactionApiUrl().replace(/\/+$/, '');
    return base ? `${base}/api/v1/health_check` : '';
  });
  readonly snippetEndpoint = computed(() => {
    const base = this.redactionApiUrl().replace(/\/+$/, '');
    return base ? `${base}/api/v1/redactions/snippet` : '';
  });
  readonly universalEndpoint = computed(
    () => `${this.universalApiUrl().replace(/\/?$/, '/')}?action=GetStatus`
  );
  readonly dirty = computed(() => {
    const cfg = this.configuredViewer();
    if (!cfg) {
      return false;
    }
    return (
      this.mode() !== cfg.mode ||
      this.snippetRedactionEnabled() !== cfg.snippetRedactionEnabled ||
      this.normalizeUrl(this.universalApiUrl()) !==
        this.normalizeUrl(cfg.universalApiUrl) ||
      this.normalizeUrl(this.redactionApiUrl()) !==
        this.normalizeUrl(cfg.redactionApiUrl)
    );
  });

  constructor() {
    this.resolveViewer().subscribe({ error: () => undefined });
  }

  resolveViewer(): Observable<DocumentViewerConfigFile['documentViewer']> {
    return this.config.getDocumentViewerConfig().pipe(
      map((config) => this.validate(config)),
      tap((viewer) => this.configuredViewer.set(viewer)),
      map((viewer) => ({
        ...viewer,
        mode: this.overrideMode() ?? viewer.mode,
        snippetRedactionEnabled:
          this.overrideSnippetRedaction() ?? viewer.snippetRedactionEnabled,
        universalApiUrl:
          this.universalApiUrlOverride() ?? viewer.universalApiUrl,
        redactionApiUrl:
          this.redactionApiUrlOverride() ?? viewer.redactionApiUrl
      }))
    );
  }

  setMode(mode: DocumentViewerMode): void {
    if (mode !== 'universal' && mode !== 'redaction') {
      return;
    }
    this.overrideMode.set(mode);
  }

  setSnippetRedactionEnabled(enabled: boolean): void {
    this.overrideSnippetRedaction.set(enabled);
  }

  setUniversalApiUrl(value: string): void {
    const endpoint = this.normalizeUrl(value);
    if (!endpoint) {
      return;
    }
    this.universalApiUrlOverride.set(endpoint);
  }

  setRedactionApiUrl(value: string): void {
    const endpoint = this.normalizeUrl(value);
    if (!endpoint) {
      return;
    }
    this.redactionApiUrlOverride.set(endpoint);
  }

  currentConfig(): DocumentViewerConfigFile {
    return {
      $schema_comment:
        'Document preview provider. Set mode to universal or redaction.',
      documentViewer: {
        mode: this.mode(),
        universalApiUrl: this.normalizeUrl(this.universalApiUrl()),
        redactionApiUrl: this.normalizeUrl(this.redactionApiUrl()),
        snippetRedactionEnabled: this.snippetRedactionEnabled()
      }
    };
  }

  /** Write document-viewer.json on the server (KDUIAdmin, admin-config API). */
  saveToServer(): Observable<DocumentViewerConfigFile['documentViewer']> {
    const file = this.currentConfig();
    return this.adminConfig.saveDocumentViewer(file).pipe(
      map((saved) => this.validate(saved)),
      tap((viewer) => this.applyServerConfig(viewer)),
      switchMap((viewer) =>
        this.config.refreshDocumentViewerConfig({ documentViewer: viewer }).pipe(
          map(() => viewer)
        )
      )
    );
  }

  /** Re-read the JSON file from the admin-config API (disk), not assets cache. */
  reloadFromServer(): Observable<DocumentViewerConfigFile['documentViewer']> {
    return this.adminConfig.loadDocumentViewer().pipe(
      map((saved) => this.validate(saved)),
      tap((viewer) => this.applyServerConfig(viewer)),
      switchMap((viewer) =>
        this.config.refreshDocumentViewerConfig({ documentViewer: viewer }).pipe(
          map(() => viewer)
        )
      )
    );
  }

  revertDraft(): void {
    this.overrideMode.set(null);
    this.overrideSnippetRedaction.set(null);
    this.universalApiUrlOverride.set(null);
    this.redactionApiUrlOverride.set(null);
  }

  testUniversalEndpoint(): Observable<string> {
    const params = new HttpParams().set('action', 'GetStatus');
    return this.resolveViewer().pipe(
      switchMap((viewer) =>
        this.http.get(viewer.universalApiUrl, {
          params,
          responseType: 'text'
        })
      ),
      map((response) => {
        if (!/<response>\s*SUCCESS\s*<\/response>/i.test(response)) {
          throw new Error(
            'Universal Viewing GetStatus did not return SUCCESS.'
          );
        }
        return 'Universal Viewing responded with status: SUCCESS.';
      })
    );
  }

  testRedactionEndpoint(): Observable<string> {
    return this.resolveViewer().pipe(
      switchMap((viewer) => {
        const base = viewer.redactionApiUrl.replace(/\/+$/, '');
        return this.http.get<{ status: string }>(
          `${base}/api/v1/health_check`
        );
      }),
      map((response) => {
        if (response.status !== 'healthy') {
          throw new Error(
            `Redaction health check returned status: ${
              response.status || 'missing'
            }.`
          );
        }
        return 'Role-based redaction responded with status: healthy.';
      })
    );
  }

  private applyServerConfig(
    viewer: DocumentViewerConfigFile['documentViewer']
  ): void {
    this.configuredViewer.set(viewer);
    this.revertDraft();
  }

  private validate(
    config: DocumentViewerConfigFile
  ): DocumentViewerConfigFile['documentViewer'] {
    const viewer = config?.documentViewer;
    if (!viewer || !['universal', 'redaction'].includes(viewer.mode)) {
      throw new Error(
        'document-viewer.json must set documentViewer.mode to universal or redaction.'
      );
    }
    if (!viewer.redactionApiUrl?.trim()) {
      throw new Error(
        'document-viewer.json must set documentViewer.redactionApiUrl.'
      );
    }
    if (!viewer.universalApiUrl?.trim()) {
      throw new Error(
        'document-viewer.json must set documentViewer.universalApiUrl.'
      );
    }
    if (typeof viewer.snippetRedactionEnabled !== 'boolean') {
      throw new Error(
        'document-viewer.json must set documentViewer.snippetRedactionEnabled.'
      );
    }
    return {
      mode: viewer.mode,
      universalApiUrl: this.normalizeUrl(viewer.universalApiUrl),
      redactionApiUrl: this.normalizeUrl(viewer.redactionApiUrl),
      snippetRedactionEnabled: viewer.snippetRedactionEnabled
    };
  }

  private normalizeUrl(value: string): string {
    return (value ?? '').trim().replace(/\/+$/, '');
  }
}
