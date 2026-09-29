import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ResultUrlService } from '../../core/services/result-url.service';
import { ConfigService } from '../../core/services/config.service';
import { BrandingService } from '../../core/services/branding.service';
import { PreflightHealthService } from '../../core/services/preflight-health.service';
import { SettingsUiService } from '../../core/services/settings-ui.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly resultUrls = inject(ResultUrlService);
  private readonly config = inject(ConfigService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly branding = inject(BrandingService);
  readonly settingsUi = inject(SettingsUiService);
  readonly preflight = inject(PreflightHealthService);
  readonly logoUrl = this.branding.logoUrl;

  readonly appTitle = this.branding.title;

  username = '';
  password = '';
  loading = signal(false);
  error = signal<string | null>(null);

  constructor() {
    // After Settings closes, re-run pre-flight so a fixed Community URL is picked up.
    let wasOpen = this.settingsUi.open();
    effect(() => {
      const open = this.settingsUi.open();
      if (wasOpen && !open && !this.auth.isAuthenticated()) {
        void this.preflight.run(true);
      }
      wasOpen = open;
    });
  }

  ngOnInit(): void {
    if (this.auth.isAuthenticated()) {
      void this.router.navigateByUrl('/home');
      return;
    }
    void this.preflight.run();
  }

  retryPreflight(): void {
    this.error.set(null);
    void this.preflight.run(true);
  }

  openSettings(): void {
    this.settingsUi.show('application');
  }

  onSubmit(): void {
    if (!this.preflight.allowLogin()) {
      this.error.set(this.i18n.t('login.preflight.blocked'));
      return;
    }

    if (!this.username.trim() || !this.password) {
      this.error.set(this.i18n.t('login.required'));
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.auth.login(this.username.trim(), this.password).subscribe({
      next: () => {
        this.loading.set(false);
        // Warm caches while navigating to the search home (no Content Query yet)
        this.config.getDatabases().subscribe({ error: () => undefined });
        this.resultUrls.preload().subscribe({ error: () => undefined });
        void this.router.navigateByUrl('/home');
      },
      error: (err: Error) => {
        this.loading.set(false);
        this.error.set(err.message || 'Login failed. Please try again.');
      }
    });
  }
}
