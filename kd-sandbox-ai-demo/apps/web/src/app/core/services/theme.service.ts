import { Injectable, computed, signal, effect } from '@angular/core';

/**
 * Built-in theme slots plus a user-designed custom theme.
 * Named presets reuse the same CSS variable architecture as light/dark.
 */
export type ThemeId =
  | 'light'
  | 'dark'
  | 'stripe'
  | 'linear'
  | 'airbnb'
  | 'vercel'
  | 'notion'
  | 'figma'
  | 'github'
  | 'apple'
  | 'slack'
  | 'custom';

export const THEME_IDS: readonly ThemeId[] = [
  'light',
  'dark',
  'stripe',
  'linear',
  'airbnb',
  'vercel',
  'notion',
  'figma',
  'github',
  'apple',
  'slack',
  'custom'
] as const;

export interface ThemeSwatches {
  primary: string;
  navy: string;
  bg: string;
  surface: string;
  accent: string;
}

export interface ThemeDefinition {
  id: ThemeId;
  nameKey: string;
  descriptionKey: string;
  inspiredBy?: string;
  custom?: boolean;
  appearance: 'light' | 'dark';
  swatches: ThemeSwatches;
  vars: Record<string, string>;
}

export function buildThemeVars(
  swatches: ThemeSwatches,
  extras?: Partial<Record<string, string>>
): Record<string, string> {
  const primary = swatches.primary;
  const navy = swatches.navy;
  const bg = swatches.bg;
  const surface = swatches.surface;
  const accent = swatches.accent;
  const isDark = luminance(bg) < 0.35;
  const text = extras?.['--kd-text'] ?? (isDark ? '#e8eef6' : '#1a1a1a');
  const muted = extras?.['--kd-text-muted'] ?? (isDark ? '#8b9cb3' : '#5c6670');
  const border = extras?.['--kd-border'] ?? (isDark ? '#2d3a4d' : '#e2d9c8');
  const primaryDark = extras?.['--kd-primary-dark'] ?? shade(primary, -0.18);
  const primaryLight = extras?.['--kd-primary-light'] ?? shade(primary, 0.28);
  const navySoft = extras?.['--kd-navy-soft'] ?? shade(navy, isDark ? 0.12 : 0.12);

  const headerBg =
    extras?.['--kd-header-bg'] ?? (isDark ? '#1a2332' : navy);
  const headerFg =
    extras?.['--kd-header-fg'] ?? (isDark ? '#e8eef6' : '#ffffff');
  const headerMuted =
    extras?.['--kd-header-muted'] ?? (isDark ? '#8b9cb3' : 'rgba(255,255,255,0.85)');
  const onPrimary =
    extras?.['--kd-on-primary'] ?? (isDark ? '#0f1419' : contrastOn(primary));

  const inverseBg =
    extras?.['--kd-inverse-bg'] ?? (isDark ? '#1a2332' : navy);
  const inverseFg =
    extras?.['--kd-inverse-fg'] ?? (isDark ? '#e8eef6' : '#ffffff');
  const inverseMuted =
    extras?.['--kd-inverse-muted'] ??
    (isDark ? '#8b9cb3' : 'rgba(255, 255, 255, 0.85)');

  const controlBg =
    extras?.['--kd-control-bg'] ?? (isDark ? '#15202b' : '#ffffff');
  const controlBgDisabled =
    extras?.['--kd-control-bg-disabled'] ?? (isDark ? '#1a2332' : '#f5f5f5');

  return {
    '--kd-primary': primary,
    '--kd-primary-dark': primaryDark,
    '--kd-primary-light': primaryLight,
    '--kd-navy': navy,
    '--kd-navy-soft': navySoft,
    '--kd-accent-blue': accent,
    '--kd-bg': bg,
    '--kd-surface': surface,
    '--kd-text': text,
    '--kd-text-muted': muted,
    '--kd-border': border,
    '--kd-header-bg': headerBg,
    '--kd-header-fg': headerFg,
    '--kd-header-muted': headerMuted,
    '--kd-on-primary': onPrimary,
    '--kd-inverse-bg': inverseBg,
    '--kd-inverse-fg': inverseFg,
    '--kd-inverse-muted': inverseMuted,
    '--kd-control-bg': controlBg,
    '--kd-control-bg-disabled': controlBgDisabled,
    '--kd-success': extras?.['--kd-success'] ?? (isDark ? '#3dd68c' : '#2e7d32'),
    '--kd-warning': extras?.['--kd-warning'] ?? (isDark ? '#f5c518' : '#b45309'),
    '--kd-danger': extras?.['--kd-danger'] ?? (isDark ? '#f07178' : '#c62828'),
    '--kd-highlight': extras?.['--kd-highlight'] ?? (isDark ? '#243044' : '#fff3cd'),
    '--kd-shadow': extras?.['--kd-shadow'] ?? (isDark
      ? '0 4px 24px rgba(0, 0, 0, 0.35)'
      : '0 4px 24px rgba(11, 44, 77, 0.08)'),
    '--kd-shadow-lg': extras?.['--kd-shadow-lg'] ?? (isDark
      ? '0 12px 40px rgba(0, 0, 0, 0.45)'
      : '0 12px 40px rgba(11, 44, 77, 0.12)'),
    ...extras
  };
}

function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0.5;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastOn(hex: string): string {
  return luminance(hex) > 0.55 ? '#111111' : '#ffffff';
}

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16)
    ];
  }
  if (h.length !== 6 || Number.isNaN(parseInt(h, 16))) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function shade(hex: string, amount: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const adj = (v: number) => {
    const n = Math.round(v + (amount >= 0 ? (255 - v) * amount : v * amount));
    return Math.max(0, Math.min(255, n));
  };
  const [r, g, b] = c.map(adj);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function preset(
  id: Exclude<ThemeId, 'custom'>,
  appearance: 'light' | 'dark',
  swatches: ThemeSwatches,
  extras?: Partial<Record<string, string>>
): ThemeDefinition {
  return {
    id,
    nameKey: `theme.${id}.name`,
    descriptionKey: `theme.${id}.desc`,
    appearance,
    swatches,
    vars: buildThemeVars(swatches, extras)
  };
}

const LIGHT: ThemeDefinition = preset(
  'light',
  'light',
  {
    primary: '#c5a572',
    navy: '#0b2c4d',
    bg: '#f7f5f1',
    surface: '#ffffff',
    accent: '#3b9eff'
  },
  {
    '--kd-primary-dark': '#a68b4b',
    '--kd-primary-light': '#e0cfa3',
    '--kd-navy-soft': '#1a3f66',
    '--kd-border': '#e2d9c8',
    '--kd-text': '#1a1a1a',
    '--kd-text-muted': '#5c6670',
    '--kd-header-bg': '#0b2c4d',
    '--kd-header-fg': '#ffffff',
    '--kd-header-muted': 'rgba(255, 255, 255, 0.88)',
    '--kd-on-primary': '#0b2c4d'
  }
);

const DARK: ThemeDefinition = preset(
  'dark',
  'dark',
  {
    primary: '#3b9eff',
    navy: '#e8eef6',
    bg: '#0f1419',
    surface: '#1e2a3a',
    accent: '#7c5cfc'
  },
  {
    '--kd-primary-dark': '#2b7fd6',
    '--kd-primary-light': '#5b9fff',
    '--kd-navy-soft': '#8b9cb3',
    '--kd-border': '#2d3a4d',
    '--kd-text': '#e8eef6',
    '--kd-text-muted': '#8b9cb3',
    '--kd-success': '#3dd68c',
    '--kd-danger': '#f07178',
    '--kd-header-bg': '#1a2332',
    '--kd-header-fg': '#e8eef6',
    '--kd-header-muted': '#8b9cb3',
    '--kd-on-primary': '#0f1419'
  }
);

const STRIPE: ThemeDefinition = preset(
  'stripe',
  'light',
  {
    primary: '#635bff',
    navy: '#0a2540',
    bg: '#f6f9fc',
    surface: '#ffffff',
    accent: '#00d4ff'
  },
  {
    '--kd-text': '#0a2540',
    '--kd-text-muted': '#425466',
    '--kd-border': '#e3e8ee',
    '--kd-header-bg': '#0a2540',
    '--kd-header-fg': '#ffffff',
    '--kd-on-primary': '#ffffff',
    '--kd-success': '#0d9488',
    '--kd-warning': '#c47d00',
    '--kd-danger': '#df1b41'
  }
);

const LINEAR: ThemeDefinition = preset(
  'linear',
  'dark',
  {
    primary: '#5e6ad2',
    navy: '#ebebef',
    bg: '#0f1011',
    surface: '#191a1d',
    accent: '#8b87ff'
  },
  {
    '--kd-text': '#ebebef',
    '--kd-text-muted': '#8a8f98',
    '--kd-border': '#2a2b2f',
    '--kd-header-bg': '#16171a',
    '--kd-header-fg': '#ebebef',
    '--kd-on-primary': '#ffffff',
    '--kd-success': '#4cb782',
    '--kd-warning': '#f2c94c',
    '--kd-danger': '#eb5757'
  }
);

const AIRBNB: ThemeDefinition = preset(
  'airbnb',
  'light',
  {
    primary: '#ff385c',
    navy: '#222222',
    bg: '#f7f7f7',
    surface: '#ffffff',
    accent: '#00a699'
  },
  {
    '--kd-text': '#222222',
    '--kd-text-muted': '#6a6a6a',
    '--kd-border': '#dddddd',
    '--kd-header-bg': '#222222',
    '--kd-header-fg': '#ffffff',
    '--kd-on-primary': '#ffffff',
    '--kd-success': '#008a05',
    '--kd-warning': '#e07912',
    '--kd-danger': '#c13515'
  }
);

const VERCEL: ThemeDefinition = preset(
  'vercel',
  'light',
  {
    primary: '#0070f3',
    navy: '#000000',
    bg: '#fafafa',
    surface: '#ffffff',
    accent: '#7928ca'
  },
  {
    '--kd-text': '#171717',
    '--kd-text-muted': '#666666',
    '--kd-border': '#eaeaea',
    '--kd-header-bg': '#000000',
    '--kd-header-fg': '#ffffff',
    '--kd-on-primary': '#ffffff',
    '--kd-success': '#0070f3',
    '--kd-warning': '#f5a623',
    '--kd-danger': '#e00'
  }
);

const NOTION: ThemeDefinition = preset(
  'notion',
  'light',
  {
    primary: '#2383e2',
    navy: '#37352f',
    bg: '#ffffff',
    surface: '#f7f6f3',
    accent: '#d9730d'
  },
  {
    '--kd-text': '#37352f',
    '--kd-text-muted': '#787774',
    '--kd-border': '#e3e2de',
    '--kd-header-bg': '#37352f',
    '--kd-header-fg': '#ffffff',
    '--kd-on-primary': '#ffffff',
    '--kd-success': '#0f7b6c',
    '--kd-warning': '#d9730d',
    '--kd-danger': '#e03e3e'
  }
);

const FIGMA: ThemeDefinition = preset(
  'figma',
  'light',
  {
    primary: '#0d99ff',
    navy: '#2c2c2c',
    bg: '#f5f5f5',
    surface: '#ffffff',
    accent: '#7b61ff'
  },
  {
    '--kd-text': '#1e1e1e',
    '--kd-text-muted': '#6b6b6b',
    '--kd-border': '#e6e6e6',
    '--kd-header-bg': '#2c2c2c',
    '--kd-header-fg': '#ffffff',
    '--kd-on-primary': '#ffffff',
    '--kd-success': '#0fa958',
    '--kd-warning': '#ffc107',
    '--kd-danger': '#f24822'
  }
);

const GITHUB: ThemeDefinition = preset(
  'github',
  'dark',
  {
    primary: '#2f81f7',
    navy: '#e6edf3',
    bg: '#0d1117',
    surface: '#161b22',
    accent: '#3fb950'
  },
  {
    '--kd-text': '#e6edf3',
    '--kd-text-muted': '#8b949e',
    '--kd-border': '#30363d',
    '--kd-header-bg': '#010409',
    '--kd-header-fg': '#e6edf3',
    '--kd-on-primary': '#ffffff',
    '--kd-success': '#3fb950',
    '--kd-warning': '#d29922',
    '--kd-danger': '#f85149'
  }
);

const APPLE: ThemeDefinition = preset(
  'apple',
  'light',
  {
    primary: '#0071e3',
    navy: '#1d1d1f',
    bg: '#f5f5f7',
    surface: '#ffffff',
    accent: '#86868b'
  },
  {
    '--kd-text': '#1d1d1f',
    '--kd-text-muted': '#6e6e73',
    '--kd-border': '#d2d2d7',
    '--kd-header-bg': '#1d1d1f',
    '--kd-header-fg': '#f5f5f7',
    '--kd-on-primary': '#ffffff',
    '--kd-success': '#248a3d',
    '--kd-warning': '#b25000',
    '--kd-danger': '#de071c'
  }
);

const SLACK: ThemeDefinition = preset(
  'slack',
  'light',
  {
    primary: '#4a154b',
    navy: '#1d1c1d',
    bg: '#f8f8f8',
    surface: '#ffffff',
    accent: '#2eb67d'
  },
  {
    '--kd-text': '#1d1c1d',
    '--kd-text-muted': '#616061',
    '--kd-border': '#dddddd',
    '--kd-header-bg': '#350d36',
    '--kd-header-fg': '#ffffff',
    '--kd-on-primary': '#ffffff',
    '--kd-success': '#2eb67d',
    '--kd-warning': '#ecb22e',
    '--kd-danger': '#e01e5a'
  }
);

const PRESETS: readonly ThemeDefinition[] = [
  LIGHT,
  DARK,
  STRIPE,
  LINEAR,
  AIRBNB,
  VERCEL,
  NOTION,
  FIGMA,
  GITHUB,
  APPLE,
  SLACK
];

const DEFAULT_CUSTOM: ThemeSwatches = {
  primary: '#7c3aed',
  navy: '#1e1b4b',
  bg: '#faf5ff',
  surface: '#ffffff',
  accent: '#c084fc'
};

const STORAGE_THEME = 'kd_ui_theme';
const STORAGE_CUSTOM = 'kd_ui_theme_custom';

const LEGACY_THEME_IDS: Record<string, ThemeId> = {
  'kd-gold': 'light',
  'aws-cloud': 'light',
  'stripe-clean': 'stripe',
  ocean: 'stripe',
  forest: 'apple',
  contrast: 'vercel',
  'stream-night': 'dark',
  'github-dim': 'github',
  midnight: 'linear',
  'netflix-night': 'dark',
  'spotify-vivid': 'slack',
  'linear-product': 'linear'
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _themeId = signal<ThemeId>(this.loadId());
  private readonly _customSwatches = signal<ThemeSwatches>(this.loadCustom());
  private appliedVarKeys = new Set<string>();

  readonly themeId = this._themeId.asReadonly();
  readonly customSwatches = this._customSwatches.asReadonly();

  readonly themes = computed<readonly ThemeDefinition[]>(() => {
    const custom: ThemeDefinition = {
      id: 'custom',
      nameKey: 'theme.custom.name',
      descriptionKey: 'theme.custom.desc',
      inspiredBy: 'your design',
      custom: true,
      appearance: luminance(this._customSwatches().bg) < 0.35 ? 'dark' : 'light',
      swatches: this._customSwatches(),
      vars: buildThemeVars(this._customSwatches())
    };
    return [...PRESETS, custom];
  });

  readonly current = computed(
    () => this.themes().find((t) => t.id === this._themeId()) ?? LIGHT
  );

  constructor() {
    effect(() => {
      this.apply(this.current());
    });
  }

  setTheme(id: ThemeId): void {
    if (!this.themes().some((t) => t.id === id)) return;
    this._themeId.set(id);
    try {
      localStorage.setItem(STORAGE_THEME, id);
    } catch {
      /* ignore */
    }
  }

  setCustomSwatches(swatches: ThemeSwatches, select = true): void {
    const clean: ThemeSwatches = {
      primary: this.normHex(swatches.primary, DEFAULT_CUSTOM.primary),
      navy: this.normHex(swatches.navy, DEFAULT_CUSTOM.navy),
      bg: this.normHex(swatches.bg, DEFAULT_CUSTOM.bg),
      surface: this.normHex(swatches.surface, DEFAULT_CUSTOM.surface),
      accent: this.normHex(swatches.accent, DEFAULT_CUSTOM.accent)
    };
    this._customSwatches.set(clean);
    try {
      localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(clean));
    } catch {
      /* ignore */
    }
    if (select) this.setTheme('custom');
    else if (this._themeId() === 'custom') this.apply(this.themes().find((t) => t.id === 'custom')!);
  }

  resetCustom(): void {
    this.setCustomSwatches(DEFAULT_CUSTOM, this._themeId() === 'custom');
  }

  private apply(theme: ThemeDefinition): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const nextKeys = new Set(Object.keys(theme.vars));
    for (const key of this.appliedVarKeys) {
      if (!nextKeys.has(key)) {
        root.style.removeProperty(key);
      }
    }
    for (const [k, v] of Object.entries(theme.vars)) {
      root.style.setProperty(k, v);
    }
    this.appliedVarKeys = nextKeys;
    root.dataset['theme'] = theme.id;
    root.dataset['themeAppearance'] = theme.appearance;
  }

  private loadId(): ThemeId {
    try {
      const raw = localStorage.getItem(STORAGE_THEME);
      if (raw && (THEME_IDS as readonly string[]).includes(raw)) {
        return raw as ThemeId;
      }
      if (raw && LEGACY_THEME_IDS[raw]) return LEGACY_THEME_IDS[raw];
    } catch {
      /* ignore */
    }
    return 'light';
  }

  private loadCustom(): ThemeSwatches {
    try {
      const raw = localStorage.getItem(STORAGE_CUSTOM);
      if (raw) {
        const p = JSON.parse(raw) as Partial<ThemeSwatches>;
        return {
          primary: this.normHex(p.primary, DEFAULT_CUSTOM.primary),
          navy: this.normHex(p.navy, DEFAULT_CUSTOM.navy),
          bg: this.normHex(p.bg, DEFAULT_CUSTOM.bg),
          surface: this.normHex(p.surface, DEFAULT_CUSTOM.surface),
          accent: this.normHex(p.accent, DEFAULT_CUSTOM.accent)
        };
      }
    } catch {
      /* ignore */
    }
    return { ...DEFAULT_CUSTOM };
  }

  private normHex(value: string | undefined, fallback: string): string {
    const v = (value ?? '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(v)) {
      const h = v.slice(1);
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
    }
    return fallback;
  }
}
