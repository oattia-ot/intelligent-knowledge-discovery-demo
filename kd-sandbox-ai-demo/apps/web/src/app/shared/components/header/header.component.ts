import { Component, OnInit, computed, inject, ViewChild, ElementRef } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { ChatSessionService } from '../../../core/services/chat-session.service';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsUiService } from '../../../core/services/settings-ui.service';
import { BrandingService } from '../../../core/services/branding.service';
import { ConceptSearchSettingsService } from '../../../core/services/concept-search-settings.service';
import { RecommendationsService } from '../../../core/services/recommendations.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { NifiAiService } from '../../../core/services/nifi-ai.service';

const RETURN_KEY = 'kd_chat_return_url';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly chatSession = inject(ChatSessionService);
  private readonly settingsUi = inject(SettingsUiService);
  private readonly branding = inject(BrandingService);
  private readonly conceptSettings = inject(ConceptSearchSettingsService);
  private readonly recommendations = inject(RecommendationsService);
  private readonly nifiAi = inject(NifiAiService);

  /** Shown only when kd-nifi-ai-mcp (local or external) was deployed. */
  readonly nifiAiEnabled = this.nifiAi.enabled;
  readonly nifiAiOpen = this.nifiAi.overlayOpen;

  readonly isAdmin = computed(() => this.auth.hasAdminRole());

  readonly logoUrl = this.branding.logoUrl;
  readonly displayTitle = this.branding.title;
  readonly subtitle = this.branding.subtitle;

  /** True while the active route is chatbot mode (`/chat`). */
  readonly chatMode = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.isChatUrl(this.router.url)),
      startWith(this.isChatUrl(this.router.url))
    ),
    { initialValue: this.isChatUrl(this.router.url) }
  );

  editingTitle = false;

  @ViewChild('titleInput') titleInput?: ElementRef<HTMLInputElement>;

  get username(): string | null {
    return this.auth.getUser()?.username ?? null;
  }

  get isAuthenticated(): boolean {
    return this.auth.isAuthenticated();
  }

  recommendationsEnabled(): boolean {
    return this.conceptSettings.recommendationsEnabled();
  }

  expertsEnabled(): boolean {
    return this.conceptSettings.expertsEnabled();
  }

  ngOnInit(): void {
    if (this.auth.isAuthenticated()) {
      this.auth.ensureRoles().subscribe({ error: () => undefined });
    }
  }

  /**
   * First click → chatbot mode (`/chat`).
   * Second click (while already in chat) → return to previous default view.
   */
  toggleChatMode(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    if (this.isChatUrl(this.router.url)) {
      const back = this.consumeReturnUrl();
      void this.router.navigateByUrl(back);
      return;
    }

    this.storeReturnUrl(this.router.url);
    // Prefer last search URL when leaving a non-search screen without history
    const databases = this.chatSession.lastDatabases();
    this.chatSession.queueNew(databases.length ? databases : undefined);
    void this.router.navigateByUrl('/chat');
  }

  startTitleEdit(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.editingTitle = true;
    setTimeout(() => {
      const el = this.titleInput?.nativeElement;
      if (el) {
        el.focus();
        el.select();
      }
    });
  }

  commitTitle(value: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.branding.setTitle(value);
    this.editingTitle = false;
  }

  cancelTitleEdit(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.editingTitle = false;
  }

  openNifiAi(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.nifiAi.toggleOverlay();
  }

  openSettings(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    // Before login, jump to Application Configuration so Community can be fixed.
    this.settingsUi.show(this.isAuthenticated ? 'business' : 'application');
  }

  logout(): void {
    this.chatSession.clearAll();
    this.recommendations.clearCache();
    try {
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      /* ignore */
    }
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  private isChatUrl(url: string): boolean {
    const path = (url || '').split('?')[0].split('#')[0];
    return path === '/chat' || path.startsWith('/chat/');
  }

  private storeReturnUrl(url: string): void {
    const path = (url || '').split('?')[0];
    // Never store login or chat as the return target
    let safe = path && path !== '/chat' && path !== '/login' && path !== '/' ? url : '/home';
    if (safe.startsWith('/chat')) {
      safe = this.chatSession.lastResultsUrl() || '/home';
    }
    try {
      sessionStorage.setItem(RETURN_KEY, safe);
    } catch {
      /* ignore */
    }
    this.chatSession.returnUrl.set(safe.startsWith('/') ? safe : '/home');
  }

  private consumeReturnUrl(): string {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(RETURN_KEY);
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      /* ignore */
    }
    const fromSession = this.chatSession.returnUrl();
    this.chatSession.returnUrl.set(null);
    const candidate =
      stored ||
      fromSession ||
      this.chatSession.lastResultsUrl() ||
      '/home';
    if (!candidate.startsWith('/') || candidate.startsWith('/chat') || candidate === '/login') {
      return '/home';
    }
    return candidate;
  }
}
