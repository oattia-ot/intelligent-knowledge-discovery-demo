import { Location } from '@angular/common';
import { Component, HostListener, Input, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { RecommendedDocument } from '../../core/models/recommendation';
import { SearchResult } from '../../core/models/search';
import { ConfigService, DatabaseConfig } from '../../core/services/config.service';
import { ConceptSearchSettingsService } from '../../core/services/concept-search-settings.service';
import { ExpertiseService } from '../../core/services/expertise.service';
import { RecommendationsService } from '../../core/services/recommendations.service';
import { ResultUrlService } from '../../core/services/result-url.service';
import { SearchInitService } from '../../core/services/search-init.service';
import { ViewService } from '../../core/services/view.service';
import { DocumentViewerSettingsService } from '../../core/services/document-viewer-settings.service';
import { databaseDisplayName } from '../../core/utils/database-label';
import { WaitIndicatorComponent } from '../../shared/components/wait-indicator/wait-indicator.component';

/**
 * My Recommendations panel/page.
 * Loads the signed-in Community profile, queries Content with weighted terms.
 */
@Component({
  selector: 'app-my-recommendations',
  standalone: true,
  imports: [WaitIndicatorComponent],
  templateUrl: './my-recommendations.component.html',
  styleUrl: './my-recommendations.component.scss'
})
export class MyRecommendationsComponent implements OnInit, OnDestroy {
  /** `page` = full route; `panel` = compact block on home. */
  @Input() variant: 'page' | 'panel' = 'page';

  private readonly recs = inject(RecommendationsService);
  private readonly config = inject(ConfigService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly viewService = inject(ViewService);
  private readonly viewerSettings = inject(DocumentViewerSettingsService);
  private readonly resultUrls = inject(ResultUrlService);
  private readonly expertise = inject(ExpertiseService);
  private readonly conceptSettings = inject(ConceptSearchSettingsService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly searchInit = inject(SearchInitService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly documents = signal<RecommendedDocument[]>([]);
  readonly noProfileTerms = signal(false);

  readonly previewDoc = signal<RecommendedDocument | null>(null);
  readonly previewUrl = signal<SafeResourceUrl | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly backLabel = signal('← Back to search home');
  readonly backHref = signal('/home');

  private databases: DatabaseConfig[] = [];
  private loadSub?: Subscription;
  private previewSub?: Subscription;
  private profileSub?: Subscription;
  private previewBlobUrl: string | null = null;
  private useHistoryBack = false;

  ngOnInit(): void {
    if (this.variant === 'page') {
      this.captureBackTarget();
    }
    this.config.getDatabases().subscribe({
      next: (file) => {
        this.databases = file.databases ?? [];
      },
      error: () => undefined
    });
    this.resultUrls.preload().subscribe({ error: () => undefined });
    this.load();
  }

  ngOnDestroy(): void {
    this.loadSub?.unsubscribe();
    this.previewSub?.unsubscribe();
    this.profileSub?.unsubscribe();
    this.revokePreviewBlob();
  }

  load(forceRefresh = false): void {
    this.loadSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.loadSub = this.recs.getRecommendations(forceRefresh).subscribe({
      next: (result) => {
        this.documents.set(result.documents);
        this.noProfileTerms.set(result.noProfileTerms);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.documents.set([]);
        this.noProfileTerms.set(false);
        this.error.set(err?.message || 'Could not load recommendations.');
        this.loading.set(false);
      }
    });
  }

  retry(): void {
    this.recs.clearCache();
    this.load(true);
  }

  goBack(event?: Event): void {
    event?.preventDefault();
    if (this.useHistoryBack) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl(this.backHref());
  }

  private captureBackTarget(): void {
    const nav = this.router.lastSuccessfulNavigation();
    const prev = nav?.previousNavigation;
    const tree = prev?.finalUrl ?? prev?.extractedUrl;
    const previousUrl = tree ? this.router.serializeUrl(tree) : '';
    const path = this.pathOnly(previousUrl);

    if (this.searchInit.isSearchUrl(previousUrl)) {
      this.useHistoryBack = true;
      this.backHref.set(previousUrl);
      this.backLabel.set('← Back to search results');
      return;
    }
    if (path === '/home' || path === '/chat' || path === '/experts') {
      this.useHistoryBack = true;
      this.backHref.set(previousUrl || path);
      this.backLabel.set(path === '/home' ? '← Back to search home' : '← Back');
      return;
    }

    const lastSearch = this.searchInit.lastSearchUrl();
    if (lastSearch) {
      this.useHistoryBack = false;
      this.backHref.set(lastSearch);
      this.backLabel.set('← Back to search results');
      return;
    }

    this.useHistoryBack = false;
    this.backHref.set('/home');
    this.backLabel.set('← Back to search home');
  }

  private pathOnly(url: string): string {
    const path = (url ?? '').split('?')[0].split('#')[0].replace(/\/+$/, '');
    return path || '/';
  }

  displayTitle(doc: RecommendedDocument): string {
    return (doc.title || '').trim() || '(No title)';
  }

  displaySummary(doc: RecommendedDocument): string {
    return (doc.summary || '').trim();
  }

  summaryHtml(doc: RecommendedDocument): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.displaySummary(doc));
  }

  metaString(doc: RecommendedDocument, key: string): string {
    const raw = doc.metadata?.[key];
    return raw == null ? '' : String(raw).trim();
  }

  databaseLabel(doc: RecommendedDocument): string {
    return databaseDisplayName(this.metaString(doc, 'database'), this.databases);
  }

  openUrl(doc: RecommendedDocument): string {
    return this.metaString(doc, 'url');
  }

  openPreview(doc: RecommendedDocument, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.previewSub?.unsubscribe();
    this.revokePreviewBlob();
    this.previewDoc.set(doc);
    this.previewUrl.set(null);
    this.previewError.set(null);

    if (!doc.reference) {
      this.previewLoading.set(false);
      this.previewError.set('This result has no document reference to preview.');
      return;
    }

    this.previewLoading.set(true);
    const idolId = this.metaString(doc, 'idolId');
    if (this.conceptSettings.expertsEnabled()) {
      this.profileSub?.unsubscribe();
      this.profileSub = this.expertise.profileFromDocument(idolId).subscribe({
        error: () => undefined
      });
    }

    const hit = this.toSearchResult(doc);
    this.previewSub = this.resultUrls.resolveHits([hit]).subscribe({
      next: ([resolved]) => {
        if (
          this.viewerSettings.mode() !== 'redaction' &&
          this.resultUrls.usesResultUrlPreview(resolved) &&
          resolved.url
        ) {
          if (this.resultUrls.shouldIframeUrl(resolved)) {
            this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(resolved.url));
          } else {
            window.open(resolved.url, '_blank', 'noopener,noreferrer');
            this.closePreview();
            return;
          }
          this.previewLoading.set(false);
          return;
        }
        this.previewSub = this.viewService.getPreviewBlobUrl(resolved.reference).subscribe({
          next: ({ blobUrl }) => {
            this.previewBlobUrl = blobUrl;
            this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl));
            this.previewLoading.set(false);
          },
          error: (err: Error) => {
            this.previewLoading.set(false);
            this.previewError.set(err?.message || 'Failed to load document preview.');
          }
        });
      },
      error: () => {
        this.previewSub = this.viewService.getPreviewBlobUrl(doc.reference).subscribe({
          next: ({ blobUrl }) => {
            this.previewBlobUrl = blobUrl;
            this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl));
            this.previewLoading.set(false);
          },
          error: (err: Error) => {
            this.previewLoading.set(false);
            this.previewError.set(err?.message || 'Failed to load document preview.');
          }
        });
      }
    });
  }

  closePreview(): void {
    this.previewSub?.unsubscribe();
    this.revokePreviewBlob();
    this.previewDoc.set(null);
    this.previewUrl.set(null);
    this.previewError.set(null);
    this.previewLoading.set(false);
  }

  private revokePreviewBlob(): void {
    if (this.previewBlobUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.previewBlobUrl);
    }
    this.previewBlobUrl = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.previewDoc()) {
      this.closePreview();
    }
  }

  openSource(doc: RecommendedDocument, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const url = this.openUrl(doc);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (doc.reference) {
      this.viewService.openInNewTab(doc.reference);
    }
  }

  downloadOriginal(doc: RecommendedDocument, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (doc.reference) {
      this.viewService.openDownload(doc.reference);
    }
  }

  private toSearchResult(doc: RecommendedDocument): SearchResult {
    const fields = (doc.metadata?.['fields'] as Record<string, string> | undefined) ?? {};
    return {
      reference: doc.reference,
      title: this.displayTitle(doc),
      summary: this.displaySummary(doc),
      database: this.metaString(doc, 'database'),
      date: this.metaString(doc, 'date'),
      mimeType: this.metaString(doc, 'mimeType'),
      author: this.metaString(doc, 'author'),
      weight: doc.score ?? 0,
      idolId: this.metaString(doc, 'idolId') || undefined,
      fields,
      url: this.openUrl(doc) || null
    };
  }
}
