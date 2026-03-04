/* ━━ Theme Engine ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Manages theme presets (dark / light / OLED), accent color,
 * and derived CSS custom properties.  Persists to chrome.storage.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ── Types ─────────────────────────────────────────────────── */

export type ThemeMode = 'dark' | 'light' | 'oled';

export interface ThemeConfig {
    mode: ThemeMode;
    accent: string; // hex, e.g. "#6264f4"
}

/** Base palette for a given mode (everything except accent-derived tokens). */
interface BasePalette {
    bg: string;
    surface: string;
    'surface-2': string;
    'surface-3': string;
    text: string;
    'text-muted': string;
    border: string;
    divider: string;
    'glass-border': string;
    'glass-highlight': string;
    overlay: string;
    shadow: string;
    'on-accent': string;
    success: string;
    warning: string;
    danger: string;
}

/* ── Presets ────────────────────────────────────────────────── */

const PRESETS: Record<ThemeMode, BasePalette> = {
    dark: {
        bg:               '#0b0d14',
        surface:          '#13161f',
        'surface-2':      '#1a1e2e',
        'surface-3':      '#222738',
        text:             '#e4e7f0',
        'text-muted':     '#6b7194',
        border:           '#1e2235',
        divider:          'rgba(255,255,255,0.06)',
        'glass-border':   'rgba(255,255,255,0.10)',
        'glass-highlight':'rgba(255,255,255,0.15)',
        overlay:          'rgba(0,0,0,0.60)',
        shadow:           'rgba(0,0,0,0.70)',
        'on-accent':      '#ffffff',
        success:          '#34d399',
        warning:          '#fbbf24',
        danger:           '#f87171',
    },
    light: {
        bg:               '#f0f1f5',
        surface:          '#ffffff',
        'surface-2':      '#f5f6f9',
        'surface-3':      '#eaecf2',
        text:             '#1a1d2e',
        'text-muted':     '#6b7194',
        border:           '#dfe1e8',
        divider:          'rgba(0,0,0,0.06)',
        'glass-border':   'rgba(0,0,0,0.08)',
        'glass-highlight':'rgba(0,0,0,0.12)',
        overlay:          'rgba(0,0,0,0.35)',
        shadow:           'rgba(0,0,0,0.12)',
        'on-accent':      '#ffffff',
        success:          '#059669',
        warning:          '#d97706',
        danger:           '#dc2626',
    },
    oled: {
        bg:               '#000000',
        surface:          '#0a0a0c',
        'surface-2':      '#111115',
        'surface-3':      '#1a1a20',
        text:             '#f0f0f5',
        'text-muted':     '#555570',
        border:           '#1a1a20',
        divider:          'rgba(255,255,255,0.08)',
        'glass-border':   'rgba(255,255,255,0.14)',
        'glass-highlight':'rgba(255,255,255,0.20)',
        overlay:          'rgba(0,0,0,0.75)',
        shadow:           'rgba(0,0,0,0.85)',
        'on-accent':      '#ffffff',
        success:          '#34d399',
        warning:          '#fbbf24',
        danger:           '#f87171',
    },
};

export { PRESETS };

/* ── Accent derivation ─────────────────────────────────────── */

/** Parse "#rrggbb" → [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
    ];
}

function deriveAccentTokens(hex: string) {
    const [r, g, b] = hexToRgb(hex);
    return {
        accent:        hex,
        'accent-soft': `rgba(${r},${g},${b},0.12)`,
        'border-accent': `rgba(${r},${g},${b},0.18)`,
    };
}

/* ── Apply / Load / Save ───────────────────────────────────── */

const STORAGE_KEY = 'opalTheme_v1';
const DEFAULT_CONFIG: ThemeConfig = { mode: 'dark', accent: '#6264f4' };

/** Apply a full theme to the document. */
export function applyTheme(config: ThemeConfig): void {
    const root = document.documentElement.style;
    const base = PRESETS[config.mode];

    // Base palette tokens
    for (const [key, value] of Object.entries(base)) {
        root.setProperty(`--color-opal-${key}`, value);
    }

    // Accent-derived tokens
    const accent = deriveAccentTokens(config.accent);
    for (const [key, value] of Object.entries(accent)) {
        root.setProperty(`--color-opal-${key}`, value);
    }
}

/** Load saved theme (or default). */
export function loadTheme(): Promise<ThemeConfig> {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([STORAGE_KEY], (result) => {
                resolve((result[STORAGE_KEY] as ThemeConfig) || DEFAULT_CONFIG);
            });
        } else {
            resolve(DEFAULT_CONFIG);
        }
    });
}

/** Persist theme config. */
export function saveTheme(config: ThemeConfig): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [STORAGE_KEY]: config }, resolve);
        } else {
            resolve();
        }
    });
}
