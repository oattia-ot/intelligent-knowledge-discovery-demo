import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

const LOGO_KEY = 'kd_brand_logo';
/** Bundled OpenText mark used until the user uploads a replacement. */
const DEFAULT_LOGO_URL = 'assets/branding/logo.png';
const TITLE_KEY = 'kd_brand_title';
const FOOTER_PRIMARY_KEY = 'kd_brand_footer_primary';
const FOOTER_POWERED_KEY = 'kd_brand_footer_powered';
const SUBTITLE_KEY = 'kd_brand_subtitle';
const LEGACY_TITLES = new Set([
  'Enterprise Search'
]);
const LEGACY_SUBTITLES = new Set(['Internal staff · Knowledge Discovery']);

const MAX_BYTES = 512 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml', 'image/gif']);

export type LogoImportResult =
  | { ok: true }
  | { ok: false; reason: 'type' | 'size' | 'read' | 'empty' };

const DEFAULT_FOOTER_PRIMARY = 'KD Internal Knowledge Search · Internal use only · © {year}';
const DEFAULT_FOOTER_POWERED = 'Powered by OpenText Knowledge Discovery';
const DEFAULT_SUBTITLE = 'Internal staff · Knowledge Discovery';

/**
 * Logo, title, subtitle, and footer copy — editable in Settings, used across themes.
 */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly _logoUrl = signal<string | null>(this.loadLogo());
  private readonly _title = signal<string>(this.loadTitle());
  private readonly _subtitle = signal<string>(this.loadString(SUBTITLE_KEY, DEFAULT_SUBTITLE));
  private readonly _footerPrimary = signal<string>(
    this.loadString(FOOTER_PRIMARY_KEY, DEFAULT_FOOTER_PRIMARY)
  );
  private readonly _footerPowered = signal<string>(
    this.loadString(FOOTER_POWERED_KEY, DEFAULT_FOOTER_POWERED)
  );

  readonly logoUrl = this._logoUrl.asReadonly();
  readonly title = this._title.asReadonly();
  readonly subtitle = this._subtitle.asReadonly();
  readonly footerPrimary = this._footerPrimary.asReadonly();
  readonly footerPowered = this._footerPowered.asReadonly();

  /** Footer primary with `{year}` replaced. */
  readonly footerPrimaryResolved = computed(() =>
    this._footerPrimary().replace(/\{year\}/gi, String(new Date().getFullYear()))
  );

  hasLogo(): boolean {
    return !!this._logoUrl();
  }

  setTitle(value: string): void {
    const clean = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const next = clean || environment.appTitle;
    this._title.set(next);
    this.persist(TITLE_KEY, next === environment.appTitle ? null : next);
  }

  resetTitle(): void {
    this.setTitle(environment.appTitle);
  }

  setSubtitle(value: string): void {
    const next = (value ?? '').trim().slice(0, 120) || DEFAULT_SUBTITLE;
    this._subtitle.set(next);
    this.persist(SUBTITLE_KEY, next === DEFAULT_SUBTITLE ? null : next);
  }

  resetSubtitle(): void {
    this.setSubtitle(DEFAULT_SUBTITLE);
  }

  setFooterPrimary(value: string): void {
    const next = (value ?? '').trim().slice(0, 200) || DEFAULT_FOOTER_PRIMARY;
    this._footerPrimary.set(next);
    this.persist(FOOTER_PRIMARY_KEY, next === DEFAULT_FOOTER_PRIMARY ? null : next);
  }

  resetFooterPrimary(): void {
    this.setFooterPrimary(DEFAULT_FOOTER_PRIMARY);
  }

  setFooterPowered(value: string): void {
    const next = (value ?? '').trim().slice(0, 200) || DEFAULT_FOOTER_POWERED;
    this._footerPowered.set(next);
    this.persist(FOOTER_POWERED_KEY, next === DEFAULT_FOOTER_POWERED ? null : next);
  }

  resetFooterPowered(): void {
    this.setFooterPowered(DEFAULT_FOOTER_POWERED);
  }

  async importFile(file: File | null | undefined): Promise<LogoImportResult> {
    if (!file) return { ok: false, reason: 'empty' };
    const type = (file.type || '').toLowerCase();
    if (!ALLOWED.has(type)) return { ok: false, reason: 'type' };
    if (file.size > MAX_BYTES) return { ok: false, reason: 'size' };
    try {
      const dataUrl = await this.readAsDataUrl(file);
      if (!dataUrl.startsWith('data:image/')) return { ok: false, reason: 'type' };
      this._logoUrl.set(dataUrl);
      try {
        localStorage.setItem(LOGO_KEY, dataUrl);
      } catch {
        /* ignore quota */
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'read' };
    }
  }

  /** Restore a previously exported logo data-URL (or bundled path). */
  applyLogo(value: string | null | undefined): void {
    const raw = (value ?? '').trim();
    if (!raw) {
      this.clearLogo();
      return;
    }
    this._logoUrl.set(raw);
    try {
      if (raw.startsWith('data:image/')) {
        localStorage.setItem(LOGO_KEY, raw);
      } else {
        localStorage.removeItem(LOGO_KEY);
      }
    } catch {
      /* ignore quota */
    }
  }

  clearLogo(): void {
    this._logoUrl.set(DEFAULT_LOGO_URL);
    try {
      localStorage.removeItem(LOGO_KEY);
    } catch {
      /* ignore */
    }
  }

  private loadLogo(): string | null {
    try {
      const raw = localStorage.getItem(LOGO_KEY);
      if (raw && raw.startsWith('data:image/')) return raw;
    } catch {
      /* ignore */
    }
    return DEFAULT_LOGO_URL;
  }

  private loadTitle(): string {
    try {
      const raw = localStorage.getItem(TITLE_KEY);
      const clean = raw?.trim().slice(0, 80) ?? '';
      if (clean && !LEGACY_TITLES.has(clean)) return clean;
      if (clean && LEGACY_TITLES.has(clean)) {
        localStorage.removeItem(TITLE_KEY);
      }
    } catch {
      /* ignore */
    }
    return environment.appTitle;
  }

  private loadString(key: string, fallback: string): string {
    try {
      const raw = localStorage.getItem(key);
      const clean = raw?.trim() ?? '';
      if (key === SUBTITLE_KEY && LEGACY_SUBTITLES.has(clean)) {
        localStorage.removeItem(key);
        return fallback;
      }
      if (clean) return clean;
    } catch {
      /* ignore */
    }
    return fallback;
  }

  private persist(key: string, value: string | null): void {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  private readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }
}
