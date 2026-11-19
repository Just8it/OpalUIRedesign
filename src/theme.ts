import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
/* ━━ Theme Engine ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Manages theme presets (dark / light / OLED), accent color,
 * and derived CSS custom properties.  Persists to storage.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ── Types ─────────────────────────────────────────────────── */

export type ThemeMode = 'dark' | 'light' | 'oled';

export interface ThemeConfig {
    mode: ThemeMode;
    accent: string; // hex, e.g. "#2f6fe4"
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
    // Neutral greys, no colour cast: the accent and the course colours are the
    // only hue on screen. Muted text is >= 4.5:1 on every surface of its mode.
    dark: {
        bg:               '#141416',
        surface:          '#1c1c1f',
        'surface-2':      '#26262a',
        'surface-3':      '#313136',
        text:             '#f2f2f3',
        'text-muted':     '#a0a0a8',
        border:           '#2c2c31',
        divider:          'rgba(255,255,255,0.08)',
        'glass-border':   'rgba(255,255,255,0.12)',
        'glass-highlight':'rgba(255,255,255,0.20)',
        overlay:          'rgba(0,0,0,0.55)',
        shadow:           'rgba(0,0,0,0.45)',
        'on-accent':      '#ffffff',
        success:          '#4ac28a',
        warning:          '#e3b341',
        danger:           '#f07c75',
    },
    light: {
        bg:               '#f4f4f5',
        surface:          '#ffffff',
        'surface-2':      '#f4f4f5',
        'surface-3':      '#e8e8ea',
        text:             '#1c1c1e',
        'text-muted':     '#5f5f66',
        border:           '#dcdce0',
        divider:          'rgba(0,0,0,0.08)',
        'glass-border':   'rgba(0,0,0,0.12)',
        'glass-highlight':'rgba(0,0,0,0.20)',
        overlay:          'rgba(0,0,0,0.30)',
        shadow:           'rgba(0,0,0,0.14)',
        'on-accent':      '#ffffff',
        success:          '#187a4d',
        warning:          '#8f5a00',
        danger:           '#c0392f',
    },
    oled: {
        bg:               '#000000',
        surface:          '#0e0e10',
        'surface-2':      '#18181b',
        'surface-3':      '#232327',
        text:             '#f2f2f3',
        'text-muted':     '#9a9aa2',
        border:           '#232327',
        divider:          'rgba(255,255,255,0.10)',
        'glass-border':   'rgba(255,255,255,0.14)',
        'glass-highlight':'rgba(255,255,255,0.22)',
        overlay:          'rgba(0,0,0,0.70)',
        shadow:           'rgba(0,0,0,0.60)',
        'on-accent':      '#ffffff',
        success:          '#4ac28a',
        warning:          '#e3b341',
        danger:           '#f07c75',
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

function toHex([r, g, b]: [number, number, number]): string {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** WCAG relative luminance of an sRGB colour. */
function luminance([r, g, b]: [number, number, number]): number {
    const lin = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The accent is picked freely by the user, so the tokens that put text on it
 * or use it as text are derived for contrast instead of assumed:
 *  - on-accent: black or white, whichever reads better on the accent fill
 *  - accent-text: the accent nudged towards the text colour until it reaches
 *    4.5:1 on all four opaque surfaces, for links and accent-coloured labels
 */
export function deriveAccentTokens(hex: string, base: BasePalette) {
    const rgb = hexToRgb(hex);
    const [r, g, b] = rgb;
    const white: [number, number, number] = [255, 255, 255];
    const black: [number, number, number] = [0, 0, 0];
    const surfaces = [base.bg, base.surface, base['surface-2'], base['surface-3']].map(hexToRgb);
    // Mixing towards neutral white/black preserves the accent's sRGB hue.
    const towards = luminance(hexToRgb(base.bg)) > 0.5 ? black : white;
    let accentText = rgb;
    for (let step = 0; step <= 1000; step++) {
        accentText = hexToRgb(toHex(mix(rgb, towards, step / 1000)));
        if (surfaces.every(surface => contrast(accentText, surface) >= 4.5)) break;
    }
    return {
        accent:        hex,
        'accent-soft': `rgba(${r},${g},${b},0.14)`,
        'border-accent': `rgba(${r},${g},${b},0.35)`,
        'accent-text': toHex(accentText),
        'on-accent':   contrast(rgb, white) >= contrast(rgb, black) ? '#ffffff' : '#000000',
    };
}

/* ── Apply / Load / Save ───────────────────────────────────── */


// Default accent: a plain blue, 4.65:1 under white text.


/** Apply a full theme to the document. */
export function applyTheme(config: ThemeConfig): void {
    const root = document.documentElement.style;
    const base = PRESETS[config.mode];

    // Lets native form controls (date and time pickers, selects, scrollbars)
    // inside the extension's own roots follow the theme. Read in input.css.
    root.setProperty('--opal-color-scheme', config.mode === 'light' ? 'light' : 'dark');

    // Base palette tokens
    for (const [key, value] of Object.entries(base)) {
        root.setProperty(`--color-opal-${key}`, value);
    }

    // Accent-derived tokens
    const accent = deriveAccentTokens(config.accent, base);
    for (const [key, value] of Object.entries(accent)) {
        root.setProperty(`--color-opal-${key}`, value);
    }
}

/** Load saved theme (or default). */
export function loadTheme(): Promise<ThemeConfig> { return store.get(keys.theme); }
export function saveTheme(config: ThemeConfig): Promise<void> { return store.set(keys.theme, config); }
