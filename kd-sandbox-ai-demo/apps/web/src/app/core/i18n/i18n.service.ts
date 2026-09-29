import { Injectable, computed, signal, effect } from '@angular/core';
import {
  LANGUAGES,
  LangCode,
  LangOption,
  TRANSLATIONS
} from './translations';

const STORAGE_KEY = 'kd_ui_lang';
const STORAGE_RTL = 'kd_enable_rtl_languages';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly _lang = signal<LangCode>(this.load());
  private readonly _enableRtl = signal<boolean>(this.loadRtlEnabled());

  /** Current language code (reactive). */
  readonly lang = this._lang.asReadonly();

  /** Whether RTL languages (Hebrew, Arabic) are shown in the selector. */
  readonly enableRtlLanguages = this._enableRtl.asReadonly();

  /** Current language metadata. */
  readonly current = computed(() => LANGUAGES.find((l) => l.code === this._lang()) ?? LANGUAGES[0]);

  /** Layout direction for the active language. */
  readonly dir = computed(() => this.current().dir);

  /**
   * Languages available in the UI selector.
   * Hebrew and Arabic are included only when Enable RTL Languages is on.
   */
  readonly languages = computed<readonly LangOption[]>(() => {
    const rtlOn = this._enableRtl();
    return LANGUAGES.filter((l) => !l.rtlOnly || rtlOn);
  });

  constructor() {
    effect(() => {
      const code = this._lang();
      const meta = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
      if (typeof document !== 'undefined') {
        document.documentElement.lang = code;
        document.documentElement.dir = meta.dir;
        document.body.classList.toggle('kd-rtl', meta.dir === 'rtl');
        document.body.classList.toggle('kd-ltr', meta.dir === 'ltr');
      }
    });
  }

  /** Translate a key; falls back to English, then the key itself. */
  t(key: string): string {
    const code = this._lang();
    return (
      TRANSLATIONS[code]?.[key] ??
      TRANSLATIONS.en[key] ??
      key
    );
  }

  setLanguage(code: LangCode): void {
    if (!LANGUAGES.some((l) => l.code === code)) {
      return;
    }
    // Disallow selecting RTL-only languages when the switch is off
    const opt = LANGUAGES.find((l) => l.code === code);
    if (opt?.rtlOnly && !this._enableRtl()) {
      return;
    }
    if (this._lang() === code) {
      return;
    }
    this._lang.set(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* ignore */
    }
  }

  setEnableRtlLanguages(enabled: boolean): void {
    this._enableRtl.set(enabled);
    try {
      localStorage.setItem(STORAGE_RTL, enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
    // If turning off and current language is RTL-only, fall back to English
    if (!enabled) {
      const cur = LANGUAGES.find((l) => l.code === this._lang());
      if (cur?.rtlOnly) {
        this.setLanguage('en');
      }
    }
  }

  private load(): LangCode {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && LANGUAGES.some((l) => l.code === raw)) {
        const code = raw as LangCode;
        const opt = LANGUAGES.find((l) => l.code === code);
        // If stored lang is RTL-only but RTL is disabled, use English
        if (opt?.rtlOnly && !this.loadRtlEnabled()) {
          return 'en';
        }
        return code;
      }
    } catch {
      /* ignore */
    }
    // Prefer browser language when it matches a supported code.
    // RTL-only languages (he/ar) are ignored unless the RTL checkbox is on.
    if (typeof navigator !== 'undefined') {
      const nav = (navigator.language || '').slice(0, 2).toLowerCase();
      const opt = LANGUAGES.find((l) => l.code === nav);
      if (opt && (!opt.rtlOnly || this.loadRtlEnabled())) {
        return opt.code;
      }
    }
    return 'en';
  }

  /** Default is off: no stored value, or any value other than '1', means unchecked. */
  private loadRtlEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_RTL) === '1';
    } catch {
      /* ignore */
    }
    return false;
  }
}
