import { Location } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DocumentViewerMode } from '../../core/services/config.service';
import { DocumentViewerSettingsService } from '../../core/services/document-viewer-settings.service';
import { SearchInitService } from '../../core/services/search-init.service';

type AdminSectionId = 'document-viewer';

interface AdminSection {
  id: AdminSectionId;
  title: string;
  hint: string;
  keywords: string;
}

interface ViewerEndpointTest {
  state: 'idle' | 'testing' | 'success' | 'error';
  message: string;
}

interface SaveState {
  state: 'idle' | 'saving' | 'success' | 'error';
  message: string;
}

const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: 'document-viewer',
    title: 'Document viewer',
    hint: 'Choose and test Universal Viewing or role-based redaction. Save writes document-viewer.json for every user.',
    keywords:
      'document viewer universal view role based redaction endpoint health test preview snippet json config persist'
  }
];

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly searchInit = inject(SearchInitService);
  private readonly viewerSettings = inject(DocumentViewerSettingsService);

  readonly adminRole = this.auth.adminRoleName();
  readonly viewerMode = this.viewerSettings.mode;
  readonly viewerConfigReady = this.viewerSettings.ready;
  readonly configuredViewerMode = this.viewerSettings.configuredMode;
  readonly snippetRedactionEnabled = this.viewerSettings.snippetRedactionEnabled;
  readonly configuredSnippetRedactionEnabled =
    this.viewerSettings.configuredSnippetRedactionEnabled;
  readonly universalViewerEndpoint = this.viewerSettings.universalEndpoint;
  readonly redactionViewerEndpoint = this.viewerSettings.redactionEndpoint;
  readonly universalApiUrl = this.viewerSettings.universalApiUrl;
  readonly redactionApiUrl = this.viewerSettings.redactionApiUrl;
  readonly snippetRedactionEndpoint = this.viewerSettings.snippetEndpoint;
  readonly dirty = this.viewerSettings.dirty;
  readonly universalTest = signal<ViewerEndpointTest>({ state: 'idle', message: '' });
  readonly redactionTest = signal<ViewerEndpointTest>({ state: 'idle', message: '' });
  readonly saveStatus = signal<SaveState>({ state: 'idle', message: '' });

  query = '';
  readonly filter = signal('');
  readonly backLabel = signal('← Back to search home');
  readonly backHref = signal('/home');

  readonly visibleSections = computed(() => {
    const words = this.filter()
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return ADMIN_SECTIONS.filter((section) => {
      if (!words.length) {
        return true;
      }
      const hay = `${section.title} ${section.hint} ${section.keywords}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    });
  });

  private useHistoryBack = false;
  private routeSub?: Subscription;
  private universalTestSub?: Subscription;
  private redactionTestSub?: Subscription;
  private saveSub?: Subscription;
  private skipUrlWrite = false;

  ngOnInit(): void {
    this.captureBackTarget();
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const q = (params.get('q') || '').trim();
      if (q === this.filter().trim()) {
        return;
      }
      this.skipUrlWrite = true;
      this.query = q;
      this.filter.set(q);
      this.skipUrlWrite = false;
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.universalTestSub?.unsubscribe();
    this.redactionTestSub?.unsubscribe();
    this.saveSub?.unsubscribe();
  }

  onFilterChange(value: string): void {
    this.query = value;
    this.filter.set(value);
    if (this.skipUrlWrite) {
      return;
    }
    const q = value.trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: q || null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  sectionVisible(id: AdminSectionId): boolean {
    return this.visibleSections().some((s) => s.id === id);
  }

  goBack(event?: Event): void {
    event?.preventDefault();
    if (this.useHistoryBack) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl(this.backHref());
  }

  setViewerMode(mode: DocumentViewerMode, event?: Event): void {
    event?.preventDefault();
    this.viewerSettings.setMode(mode);
    this.saveStatus.set({ state: 'idle', message: '' });
  }

  setSnippetRedactionEnabled(enabled: boolean, event?: Event): void {
    event?.preventDefault();
    this.viewerSettings.setSnippetRedactionEnabled(enabled);
    this.saveStatus.set({ state: 'idle', message: '' });
  }

  setUniversalViewerEndpoint(value: string): void {
    this.viewerSettings.setUniversalApiUrl(value);
    this.universalTest.set({ state: 'idle', message: '' });
    this.saveStatus.set({ state: 'idle', message: '' });
  }

  setRedactionViewerEndpoint(value: string): void {
    this.viewerSettings.setRedactionApiUrl(value);
    this.redactionTest.set({ state: 'idle', message: '' });
    this.saveStatus.set({ state: 'idle', message: '' });
  }

  revertDraft(event?: Event): void {
    event?.preventDefault();
    this.viewerSettings.revertDraft();
    this.saveStatus.set({ state: 'idle', message: '' });
  }

  saveToServer(event?: Event): void {
    event?.preventDefault();
    this.saveSub?.unsubscribe();
    this.saveStatus.set({ state: 'saving', message: 'Saving document-viewer.json…' });
    this.saveSub = this.viewerSettings.saveToServer().subscribe({
      next: () =>
        this.saveStatus.set({
          state: 'success',
          message:
            'Saved document-viewer.json on the server. Other users pick this up after they reload.'
        }),
      error: (error: Error) =>
        this.saveStatus.set({
          state: 'error',
          message: error.message || 'Could not save document-viewer.json.'
        })
    });
  }

  reloadFromServer(event?: Event): void {
    event?.preventDefault();
    this.saveSub?.unsubscribe();
    this.saveStatus.set({ state: 'saving', message: 'Reloading from server…' });
    this.saveSub = this.viewerSettings.reloadFromServer().subscribe({
      next: () =>
        this.saveStatus.set({
          state: 'success',
          message: 'Reloaded document-viewer.json from the server.'
        }),
      error: (error: Error) =>
        this.saveStatus.set({
          state: 'error',
          message: error.message || 'Could not reload document-viewer.json.'
        })
    });
  }

  testUniversalViewer(event?: Event): void {
    event?.preventDefault();
    this.universalTestSub?.unsubscribe();
    this.universalTest.set({ state: 'testing', message: 'Testing endpoint…' });
    this.universalTestSub = this.viewerSettings.testUniversalEndpoint().subscribe({
      next: (message) => this.universalTest.set({ state: 'success', message }),
      error: (error: Error) =>
        this.universalTest.set({
          state: 'error',
          message: error.message || 'Universal Viewing endpoint test failed.'
        })
    });
  }

  testRedactionViewer(event?: Event): void {
    event?.preventDefault();
    this.redactionTestSub?.unsubscribe();
    this.redactionTest.set({ state: 'testing', message: 'Testing endpoint…' });
    this.redactionTestSub = this.viewerSettings.testRedactionEndpoint().subscribe({
      next: (message) => this.redactionTest.set({ state: 'success', message }),
      error: (error: Error) =>
        this.redactionTest.set({
          state: 'error',
          message: error.message || 'Role-based redaction endpoint test failed.'
        })
    });
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

    if (
      path === '/home' ||
      path === '/chat' ||
      path === '/experts' ||
      path === '/recommendations' ||
      path === '/settings' ||
      path === '/settings/profiles'
    ) {
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
}
