/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Command Center (Ctrl+K)
   Fuzzy search overlay for courses, files, and folders.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { CourseItem } from './types';
import { searchNodes } from './core/search-engine';
import type { SearchResult } from './core/search-engine';
import { db } from './core/index-db';
import { loadCatalogSettings, isCatalogStale, indexCourseCatalog } from './indexer';

/* ── Module state ─────────────────────────────────────────────── */

/** Reference to main.ts's favoriteCourses map (passed in via bindCommandCenter). */
let _favorites: Map<string, CourseItem> = new Map();

/* ── Search History ───────────────────────────────────────────── */

const HISTORY_KEY = 'opalCmdHistory';
const HISTORY_MAX = 10;

async function loadHistory(): Promise<string[]> {
    return new Promise(resolve => {
        chrome.storage.local.get(HISTORY_KEY, result => {
            resolve(Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : []);
        });
    });
}

async function saveToHistory(query: string): Promise<void> {
    if (!query) return;
    const hist = await loadHistory();
    // Deduplicate (case-insensitive), prepend, trim to max
    const deduped = hist.filter(q => q.toLowerCase() !== query.toLowerCase());
    const updated = [query, ...deduped].slice(0, HISTORY_MAX);
    return new Promise<void>(resolve => chrome.storage.local.set({ [HISTORY_KEY]: updated }, resolve));
}

function renderHistoryItems(hist: string[], resultsEl: HTMLElement, input: HTMLInputElement): void {
    const clockIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    resultsEl.innerHTML = hist.slice(0, 5).map(q => `
        <div class="opal-cmd-history-item" data-query="${q.replace(/"/g, '&quot;')}"
             style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;
                    text-decoration:none;transition:background 0.1s;">
            <span style="color:var(--color-opal-text-muted);flex-shrink:0;">${clockIcon}</span>
            <span style="flex:1;font-size:0.875rem;color:var(--color-opal-text);
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${q}</span>
            <span style="font-size:10px;color:var(--color-opal-text-muted);flex-shrink:0;">↵</span>
        </div>`).join('');

    resultsEl.querySelectorAll<HTMLElement>('.opal-cmd-history-item').forEach(row => {
        row.addEventListener('mouseover', () => { row.style.background = 'var(--color-opal-divider)'; });
        row.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
        row.addEventListener('click', () => {
            const q = row.dataset.query ?? '';
            input.value = q;
            input.dispatchEvent(new Event('input'));
        });
    });
}

/* ── Helpers ──────────────────────────────────────────────────── */

/** Derive active course ID from the page breadcrumb (empty on home). */
function getActiveCourseId(): string {
    const isHome = (
        location.pathname.startsWith('/opal/home') ||
        location.pathname === '/opal/' ||
        location.pathname === '/opal'
    );
    if (isHome) return '';
    const firstCrumb = document.querySelector<HTMLAnchorElement>(
        '.o_breadcrumb a, nav.breadcrumb a, [class*="breadcrumb"] a'
    );
    if (firstCrumb) {
        try {
            const u = new URL(firstCrumb.href);
            return (u.pathname + u.search).replace(/\/$/, '');
        } catch { return ''; }
    }
    return '';
}

const TYPE_ICON: Record<string, string> = {
    course: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    file: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    folder: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    action: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
};
const TYPE_COLOR: Record<string, string> = {
    course: 'var(--color-opal-accent)',
    file: 'var(--color-opal-warning)',
    folder: 'var(--color-opal-success)',
    action: 'var(--color-opal-text-muted)',
};

function renderCmdResults(results: SearchResult[], courseId: string, selectedIdx: number): string {
    if (results.length === 0) {
        return `<div style="padding:2rem 1rem;text-align:center;font-size:0.875rem;color:var(--color-opal-text-muted);">Keine Ergebnisse gefunden.</div>`;
    }
    return results.map((r, i) => {
        const n = r.node;
        const isSelected = i === selectedIdx;
        const isContextual = !!courseId && n.courseId === courseId;
        const color = TYPE_COLOR[n.type] ?? TYPE_COLOR.action;
        const ext = n.fileExtension ? ` · .${n.fileExtension.toUpperCase()}` : '';
        const bg = isSelected ? 'var(--color-opal-divider)' : 'transparent';
        return `<a class="opal-cmd-result" href="${n.url}" data-url="${n.url}" data-idx="${i}"
                   style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                          cursor:pointer;text-decoration:none;background:${bg};transition:background 0.1s;">
              <span style="color:${color};flex-shrink:0;">${TYPE_ICON[n.type] ?? TYPE_ICON.action}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.875rem;font-weight:500;color:var(--color-opal-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n.title}</div>
                <div style="font-size:0.6875rem;color:var(--color-opal-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n.type}${ext}</div>
              </div>
              ${isContextual ? `<span style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-opal-accent);background:var(--color-opal-accent-soft);padding:2px 6px;border-radius:4px;flex-shrink:0;">Aktuell</span>` : ''}
              <svg style="flex-shrink:0;color:var(--color-opal-text-muted);opacity:0.4;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </a>`;
    }).join('');
}

/* ── Public API ───────────────────────────────────────────────── */

export function openCommandCenter(): void {
    try {
        _openCommandCenter();
    } catch (err) {
        console.error('[OPAL] Command Center error:', err);
    }
}

function _openCommandCenter(): void {
    if (document.getElementById('opal-cmd-overlay')) return;
    const courseId = getActiveCourseId();

    // Auto-refresh catalog in background if enabled and stale (>30 days)
    loadCatalogSettings().then(async s => {
        if (s.enabled && await isCatalogStale()) {
            console.log('[OPAL] Catalog stale — auto-refreshing in background');
            indexCourseCatalog().catch(console.warn);
        }
    }).catch(() => { });

    const overlay = document.createElement('div');
    overlay.id = 'opal-cmd-overlay';
    // Use setProperty with 'important' priority so OPAL's !important CSS rules cannot override us
    const s = overlay.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('top', '0', 'important');
    s.setProperty('right', '0', 'important');
    s.setProperty('bottom', '0', 'important');
    s.setProperty('left', '0', 'important');
    s.setProperty('z-index', '2147483647', 'important');
    s.setProperty('display', 'flex', 'important');
    s.setProperty('visibility', 'visible', 'important');
    s.setProperty('opacity', '1', 'important');
    s.setProperty('pointer-events', 'all', 'important');
    s.setProperty('align-items', 'flex-start', 'important');
    s.setProperty('justify-content', 'center', 'important');
    s.setProperty('padding-top', '12vh', 'important');
    s.setProperty('background', 'var(--color-opal-overlay)', 'important');
    s.setProperty('backdrop-filter', 'blur(4px)', 'important');
    overlay.innerHTML = `
        <div id="opal-cmd-panel" style="width:100%;max-width:580px;margin:0 1rem;
             background:var(--color-opal-surface);border:1px solid var(--color-opal-glass-border);
             border-radius:16px;overflow:hidden;box-shadow:0 32px 80px var(--color-opal-shadow);">
          <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;
                      border-bottom:1px solid var(--color-opal-divider);">
            <svg style="color:var(--color-opal-text-muted);flex-shrink:0;" width="16" height="16" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input id="opal-cmd-input" type="text" autocomplete="off" spellcheck="false"
                   placeholder="Kurse, Dateien, Ordner suchen… (/c Kurse · /f Dateien)"
                   style="flex:1;background:transparent;border:none;outline:none;
                          color:var(--color-opal-text);font-size:0.9375rem;min-width:0;font-family:inherit;">
            <kbd style="font-size:10px;padding:2px 6px;border-radius:5px;
                        background:var(--color-opal-divider);border:1px solid var(--color-opal-divider);
                        color:var(--color-opal-text-muted);font-family:monospace;flex-shrink:0;">Esc</kbd>
          </div>
          <div id="opal-cmd-results" style="max-height:380px;overflow-y:auto;padding:6px 0;"></div>
          <div style="display:flex;justify-content:space-between;padding:8px 16px;
                      border-top:1px solid var(--color-opal-divider);">
            <span style="font-size:10px;color:var(--color-opal-text-muted);">/c Kurse &nbsp;·&nbsp; /f Dateien</span>
            <span style="font-size:10px;color:var(--color-opal-text-muted);">↑↓ navigieren &nbsp;·&nbsp; ↵ öffnen &nbsp;·&nbsp; Esc schließen</span>
          </div>
        </div>`;

    document.body.appendChild(overlay);

    const input = document.getElementById('opal-cmd-input') as HTMLInputElement;
    const resultsEl = document.getElementById('opal-cmd-results')!;
    let results: SearchResult[] = [];
    let selectedIdx = 0;
    let debounce: number | undefined;

    const close = () => overlay.remove();

    const rerender = () => {
        resultsEl.innerHTML = renderCmdResults(results, courseId, selectedIdx);
    };

    const navigate = (delta: number) => {
        selectedIdx = Math.max(0, Math.min(results.length - 1, selectedIdx + delta));
        rerender();
        resultsEl.querySelectorAll<HTMLElement>('.opal-cmd-result')[selectedIdx]
            ?.scrollIntoView({ block: 'nearest' });
    };

    const openSelected = async () => {
        const result = results[selectedIdx];
        if (!result) return;
        const { node } = result;

        // Save the query to history before navigating
        const currentQuery = input.value.trim();
        if (currentQuery && node.type !== 'action') {
            await saveToHistory(currentQuery);
        }

        close();

        // For files: navigate to parent folder and highlight the file row
        if (node.type === 'file' && node.parentId) {
            const parent = await db.nodes.get(node.parentId);
            if (parent?.url) {
                chrome.storage.local.set({ opalHighlightFile: { title: node.title, url: node.url } });
                location.href = parent.url;
                return;
            }
        }
        // Default: direct navigation
        location.href = node.url;
    };

    // Show history immediately on open (async, non-blocking)
    loadHistory().then(hist => {
        if (hist.length > 0 && !input.value.trim()) {
            renderHistoryItems(hist, resultsEl, input);
        }
    });

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        selectedIdx = 0;
        debounce = window.setTimeout(async () => {
            const q = input.value.trim();
            if (!q) {
                // Cleared back to empty — re-show history
                const hist = await loadHistory();
                if (hist.length > 0) renderHistoryItems(hist, resultsEl, input);
                else resultsEl.innerHTML = '';
                results = [];
                return;
            }

            // If the user is typing a prefix command (starts with / but isn't /c or /f yet),
            // clear results and wait until the prefix is complete
            if (q.startsWith('/') && !q.startsWith('/c ') && !q.startsWith('/f ')) {
                results = [];
                resultsEl.innerHTML = '';
                return;
            }

            // Detect prefix mode
            const isCoursesOnly = q.startsWith('/c ');
            const isFilesOnly = q.startsWith('/f ');
            const displayQ = isCoursesOnly ? q.slice(3).trim()
                : isFilesOnly ? q.slice(3).trim()
                    : q;

            // Fetch extra results so we have enough after grouping
            const raw = await searchNodes(q, courseId, 30);

            // ── Substring-match favorites that Orama may have missed ──
            // e.g. "mathe" should find "Spezielle Kapitel der Mathematik…"
            // Only relevant when NOT in /f (files-only) mode
            const qLower = (displayQ || q).toLowerCase();
            const rawIds = new Set(raw.map(r => {
                try { return new URL(r.node.url, location.origin).pathname.replace(/\/$/, ''); }
                catch { return ''; }
            }));
            const extraFavs: SearchResult[] = [];
            if (!isFilesOnly) {
                for (const [path, course] of _favorites) {
                    if (rawIds.has(path)) continue; // already in Orama results
                    if (course.title.toLowerCase().includes(qLower)) {
                        extraFavs.push({
                            node: {
                                id: path,
                                title: course.title,
                                url: course.href,
                                type: 'course',
                                courseId: path,
                                parentId: null,
                                lastVisited: Date.now(),
                                visitCount: 0,
                                source: 'user',
                            },
                            score: 999,
                        });
                    }
                }
            }

            // ── Synthetic "Suche" action ──────────────────────────────
            const searchAction: SearchResult = {
                node: {
                    id: '__opal-search-action__',
                    title: `Suche "${displayQ || q}"`,
                    url: `/opal/auth/search/finder?search_input=${encodeURIComponent(displayQ || q)}&search_button=`,
                    type: 'action',
                    courseId: '',
                    parentId: null,
                    lastVisited: 0,
                    visitCount: 0,
                },
                score: 0,
            };

            if (isCoursesOnly) {
                // /c mode: favorites first → search action → catalog/other courses
                const favCourses: SearchResult[] = [...extraFavs];
                const otherCourses: SearchResult[] = [];
                for (const r of raw) {
                    let isFav = false;
                    try {
                        const p = new URL(r.node.url, location.origin).pathname.replace(/\/$/, '');
                        isFav = _favorites.has(p);
                    } catch { }
                    if (isFav) favCourses.push(r);
                    else otherCourses.push(r);
                }
                results = [...favCourses, searchAction, ...otherCourses].slice(0, 8);

            } else if (isFilesOnly) {
                // /f mode: just files from Orama (already filtered by searchNodes)
                results = raw.slice(0, 8);

            } else {
                // Default mode: only user-visited items (no catalog), favorites on top
                const favCourses: SearchResult[] = [...extraFavs];
                const otherUserNodes: SearchResult[] = [];
                for (const r of raw) {
                    if (r.node.source === 'catalog') continue; // skip catalog in default mode
                    if (r.node.type === 'action') continue;    // skip old actions
                    let isFav = false;
                    try {
                        const p = new URL(r.node.url, location.origin).pathname.replace(/\/$/, '');
                        isFav = _favorites.has(p);
                    } catch { }
                    if (isFav) favCourses.push(r);
                    else otherUserNodes.push(r);
                }
                results = [...favCourses, searchAction, ...otherUserNodes].slice(0, 8);
            }

            rerender();
        }, 120);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); navigate(+1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); navigate(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); openSelected(); }
    });

    // Close on backdrop click; navigate on result click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { close(); return; }
        const item = (e.target as HTMLElement).closest<HTMLElement>('.opal-cmd-result');
        if (item) {
            e.preventDefault();
            // Find the matching result to use the same file-navigation logic
            const idx = Array.from(resultsEl.querySelectorAll('.opal-cmd-result')).indexOf(item);
            if (idx >= 0) { selectedIdx = idx; }
            openSelected();
        }
    });

    requestAnimationFrame(() => input.focus());
}

/** Register Ctrl+K shortcut. Pass the same favoriteCourses Map from main.ts (by reference). */
export function bindCommandCenter(favorites: Map<string, CourseItem>): void {
    _favorites = favorites;
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            e.stopPropagation();
            openCommandCenter();
        }
    }, true);
}
