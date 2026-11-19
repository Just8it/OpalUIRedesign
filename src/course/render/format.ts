/* ━━ Course view: formatting, escaping, icons ━━━━━━━━━━━━━━━━━━
 * Pure helpers shared by the renderers. No DOM access, so the
 * renderers run under node:test.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { formatDate as formatLocalDate, formatNumber } from '../../i18n/core.ts';
import { escapeAttr, safeHref } from '../../utils.ts';

/** Escapes & " ' < >: valid for text content and quoted attributes alike, and
 *  unlike utils.escapeHtml it needs no document. */
export const esc = (text: string | undefined | null): string => escapeAttr(String(text ?? ''));
export const href = (url: string | undefined): string => safeHref(url ?? '');

/** Attributes for a link that opens in a new tab. */
export const NEW_TAB = 'target="_blank" rel="noopener noreferrer"';

export function formatDate(ms: number | undefined, includeYear = true): string {
    if (!ms || !Number.isFinite(ms)) return '';
    return formatLocalDate(ms, { day: '2-digit', month: '2-digit', year: includeYear ? 'numeric' : undefined });
}

/**
 * Escaped `text` with the [start, end) `ranges` emphasised. `offset` is
 * where `text` starts inside the string the ranges refer to, so a name
 * split for middle truncation can be highlighted piece by piece.
 */
export function highlight(text: string, ranges: readonly (readonly [number, number])[] = [], offset = 0): string {
    let out = '';
    let at = 0;
    const sorted = [...ranges].map(([s, e]) => [s - offset, e - offset] as const).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
    for (const [start, end] of sorted) {
        const s = Math.max(at, Math.min(start, text.length), 0);
        const e = Math.min(end, text.length);
        if (e <= s) continue;
        out += esc(text.slice(at, s)) + `<mark class="opal-course-hit">${esc(text.slice(s, e))}</mark>`;
        at = e;
    }
    return out + esc(text.slice(at));
}

export function plural(n: number, one: string, many: string): string {
    return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/* ── Icons ──────────────────────────────────────────────────────
 * The palette's set plus the few controls of the course view.
 * 15px (16px for row icons), stroke 2, currentColor. */
const svg = (body: string, size = 15) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICON = {
    file: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
    archive: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 11h1M10 14h1M10 17h1"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    book: svg('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
    link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    video: svg('<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m22 8-6 4 6 4z"/>'),
    open: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    external: svg('<path d="M7 17 17 7"/><path d="M8 7h9v9"/>', 13),
    refresh: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
    search: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    megaphone: svg('<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>', 13),
    chevron: svg('<path d="m6 9 6 6 6-6"/>', 15),
    sortUp: svg('<path d="m18 15-6-6-6 6"/>', 12),
    sortDown: svg('<path d="m6 9 6 6 6-6"/>', 12),
    up: svg('<path d="m18 15-6-6-6 6"/>', 14),
    down: svg('<path d="m6 9 6 6 6-6"/>', 14),
    eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 14),
    eyeOff: svg('<path d="M10.7 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-2.6 3.4"/><path d="M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/>', 14),
    more: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>', 16),
    plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>', 15),
    grip: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`,
    close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 14),
} as const;
