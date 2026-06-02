/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Command Center (Ctrl+K)
   Fuzzy search overlay for courses, files, and folders.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { CourseItem } from './types';
import { searchNodes } from './core/search-engine';
import type { SearchResult } from './core/search-engine';
import type { IndexNode } from './core/index-db';
import { db } from './core/index-db';
import { loadCatalogSettings, isCatalogStale, indexCourseCatalog } from './indexer';
import { escapeAttr, escapeHtml, safeHref } from './utils';

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
    const deduped = hist.filter(q => q.toLowerCase() !== query.toLowerCase());
    const updated = [query, ...deduped].slice(0, HISTORY_MAX);
    return new Promise<void>(resolve => chrome.storage.local.set({ [HISTORY_KEY]: updated }, resolve));
}

function renderHistoryItems(hist: string[], resultsEl: HTMLElement, input: HTMLInputElement): void {
    const clockIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    resultsEl.innerHTML = hist.slice(0, 5).map(q => `
        <div class="opal-cmd-history-item" data-query="${escapeAttr(q)}"
             style="display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;
                    text-decoration:none;transition:background 0.1s;">
            <span style="color:var(--color-opal-text-muted);flex-shrink:0;">${clockIcon}</span>
            <span style="flex:1;font-size:0.875rem;color:var(--color-opal-text);
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(q)}</span>
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
    file:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    folder: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    action: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
};
const TYPE_COLOR: Record<string, string> = {
    course: 'var(--color-opal-accent)',
    file:   'var(--color-opal-warning)',
    folder: 'var(--color-opal-success)',
    action: 'var(--color-opal-text-muted)',
};

/**
 * Render a list of search results.
 * courseNames: optional map of courseId → course title, used to show file/folder context.
 */
function renderCmdResults(
    results: SearchResult[],
    courseId: string,
    selectedIdx: number,
    courseNames: Map<string, string> = new Map(),
): string {
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

        // For files and folders, show the parent course name as subtitle instead of bare type
        let subtitle: string;
        if ((n.type === 'file' || n.type === 'folder') && courseNames.has(n.courseId)) {
            const cName = courseNames.get(n.courseId)!;
            subtitle = `${cName}${ext}`;
        } else {
            subtitle = `${n.type}${ext}`;
        }

        const href = safeHref(n.url);
        return `<a class="opal-cmd-result" href="${href}" data-url="${href}" data-idx="${i}"
                   style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                          cursor:pointer;text-decoration:none;background:${bg};transition:background 0.1s;">
              <span style="color:${color};flex-shrink:0;">${TYPE_ICON[n.type] ?? TYPE_ICON.action}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.875rem;font-weight:500;color:var(--color-opal-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(n.title)}</div>
                <div style="font-size:0.6875rem;color:var(--color-opal-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(subtitle)}</div>
              </div>
              ${isContextual ? `<span style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-opal-accent);background:var(--color-opal-accent-soft);padding:2px 6px;border-radius:4px;flex-shrink:0;">Aktuell</span>` : ''}
              <svg style="flex-shrink:0;color:var(--color-opal-text-muted);opacity:0.4;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </a>`;
    }).join('');
}

/** Render the drill-down header chip + sectioned results. */
function renderDrillView(
    drillTitle: string,
    results: SearchResult[],
    selectedIdx: number,
    fileCount: number,
): string {
    const header = `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 16px 4px;
                    border-bottom:1px solid var(--color-opal-divider);margin-bottom:2px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" style="color:var(--color-opal-text-muted);flex-shrink:0;">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          <span style="font-size:0.6875rem;font-weight:600;color:var(--color-opal-text-muted);
                       white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${drillTitle}</span>
          <span style="font-size:10px;color:var(--color-opal-text-muted);flex-shrink:0;">Esc zurück</span>
        </div>`;

    if (results.length === 0) {
        return header + `<div style="padding:1.5rem 1rem;text-align:center;font-size:0.875rem;color:var(--color-opal-text-muted);">Keine Inhalte indexiert.<br><span style="font-size:0.75rem;opacity:0.7;">Öffne den Kurs einmal oder nutze „Nächste Kurse aktualisieren".</span></div>`;
    }

    let html = header;
    const folderStart = fileCount;

    if (fileCount > 0) {
        html += `<div style="padding:6px 16px 2px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-opal-text-muted);opacity:0.6;">Dateien</div>`;
    }

    results.forEach((r, i) => {
        if (i === folderStart && results.slice(folderStart).some(x => x.node.type === 'folder')) {
            html += `<div style="padding:6px 16px 2px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-opal-text-muted);opacity:0.6;${i > 0 ? 'border-top:1px solid var(--color-opal-divider);margin-top:4px;padding-top:8px;' : ''}">Ordner</div>`;
        }

        const n = r.node;
        const isSelected = i === selectedIdx;
        const color = TYPE_COLOR[n.type] ?? TYPE_COLOR.action;
        const ext = n.fileExtension ? ` · .${n.fileExtension.toUpperCase()}` : '';
        const bg = isSelected ? 'var(--color-opal-divider)' : 'transparent';

        const href = safeHref(n.url);
        html += `<a class="opal-cmd-result" href="${href}" data-url="${href}" data-idx="${i}"
                    style="display:flex;align-items:center;gap:12px;padding:9px 16px;
                           cursor:pointer;text-decoration:none;background:${bg};transition:background 0.1s;">
               <span style="color:${color};flex-shrink:0;">${TYPE_ICON[n.type] ?? TYPE_ICON.action}</span>
               <div style="flex:1;min-width:0;">
                 <div style="font-size:0.875rem;font-weight:500;color:var(--color-opal-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(n.title)}</div>
                 ${n.type === 'file' ? `<div style="font-size:0.6875rem;color:var(--color-opal-text-muted);">${n.type}${ext}</div>` : ''}
               </div>
               <svg style="flex-shrink:0;color:var(--color-opal-text-muted);opacity:0.4;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
             </a>`;
    });

    return html;
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

    loadCatalogSettings().then(async s => {
        if (s.enabled && await isCatalogStale()) {
            indexCourseCatalog().catch(console.warn);
        }
    }).catch(() => { });

    const overlay = document.createElement('div');
    overlay.id = 'opal-cmd-overlay';
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
             display:flex;flex-direction:column;
             max-height:calc(100vh - 20vh);
             background:var(--color-opal-surface);border:1px solid var(--color-opal-glass-border);
             border-radius:16px;box-shadow:0 32px 80px var(--color-opal-shadow);overflow:clip;">
          <div style="flex-shrink:0;display:flex;align-items:center;gap:12px;padding:14px 16px;
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
          <div id="opal-cmd-results" style="flex:1;min-height:0;overflow-y:auto;padding:6px 0;"></div>
          <div style="flex-shrink:0;display:flex;justify-content:space-between;padding:8px 16px;
                      border-top:1px solid var(--color-opal-divider);">
            <span style="font-size:10px;color:var(--color-opal-text-muted);">/c Kurse &nbsp;·&nbsp; /f Dateien &nbsp;·&nbsp; ↵ auf Kurs → Ordner</span>
            <span style="font-size:10px;color:var(--color-opal-text-muted);">↑↓ navigieren &nbsp;·&nbsp; ↵ öffnen &nbsp;·&nbsp; Esc schließen</span>
          </div>
        </div>`;

    document.body.appendChild(overlay);

    const input    = document.getElementById('opal-cmd-input') as HTMLInputElement;
    const resultsEl = document.getElementById('opal-cmd-results')!;
    let results: SearchResult[]   = [];
    let selectedIdx                = 0;
    let debounce: number | undefined;
    let courseNames: Map<string, string> = new Map();

    // ── Drill-down state ──────────────────────────────────────────
    type CmdMode = 'search' | 'drill';
    let mode: CmdMode = 'search';
    let drillCourse: IndexNode | null = null;
    let drillFileCount = 0;
    let preDrill: { query: string; results: SearchResult[]; idx: number; courseNames: Map<string, string> } | null = null;

    const close = () => overlay.remove();

    const rerender = () => {
        if (mode === 'drill' && drillCourse) {
            resultsEl.innerHTML = renderDrillView(drillCourse.title, results, selectedIdx, drillFileCount);
        } else {
            resultsEl.innerHTML = renderCmdResults(results, courseId, selectedIdx, courseNames);
        }
    };

    const navigate = (delta: number) => {
        selectedIdx = Math.max(0, Math.min(results.length - 1, selectedIdx + delta));
        rerender();
        resultsEl.querySelectorAll<HTMLElement>('.opal-cmd-result')[selectedIdx]
            ?.scrollIntoView({ block: 'nearest' });
    };

    // ── Drill-down enter / exit ───────────────────────────────────

    const enterDrillMode = async (course: IndexNode) => {
        preDrill = {
            query: input.value,
            results: [...results],
            idx: selectedIdx,
            courseNames: new Map(courseNames),
        };
        drillCourse = course;
        mode = 'drill';
        selectedIdx = 0;

        // Always resolve to the root RepositoryEntry — a course node may have
        // been stored with a CourseNode sub-URL as its courseId (passive indexer
        // breadcrumb edge case). Folder/file nodes are keyed on the root path.
        const cid = (() => {
            const url = course.url || '';
            try {
                const path = new URL(url).pathname;
                const m = path.match(/(\/opal\/[^/]*\/RepositoryEntry\/\d+)/i)
                    ?? path.match(/(\/RepositoryEntry\/\d+)/i);
                return m ? m[1] : (course.courseId || course.id);
            } catch {
                return course.courseId || course.id;
            }
        })();

        // Files matching current query within this course
        const rawQ = input.value.trim().replace(/^\/\w\s+/, '').trim();
        let files: SearchResult[] = [];
        if (rawQ) {
            const hits = await searchNodes(rawQ, cid, 20);
            files = hits
                .filter(r => r.node.type === 'file' && r.node.courseId === cid)
                .slice(0, 5);
        }

        // All scraped folders for this course
        const folderNodes = await db.nodes
            .where('courseId').equals(cid)
            .filter(n => n.type === 'folder')
            .toArray();

        // Sort folders: most recently visited first
        folderNodes.sort((a, b) => (b.lastVisited ?? 0) - (a.lastVisited ?? 0));

        // If no folders indexed yet, fall back to showing recently indexed files
        if (folderNodes.length === 0 && files.length === 0) {
            const allFiles = await db.nodes
                .where('courseId').equals(cid)
                .filter(n => n.type === 'file')
                .toArray();
            allFiles.sort((a, b) => (b.lastVisited ?? 0) - (a.lastVisited ?? 0));
            files = allFiles.slice(0, 8).map(f => ({ node: f, score: 0 }));
        }

        drillFileCount = files.length;
        results = [
            ...files,
            ...folderNodes.map(f => ({ node: f, score: 0 })),
        ];

        rerender();
    };

    const exitDrillMode = () => {
        if (!preDrill) { close(); return; }
        mode = 'search';
        drillCourse = null;
        drillFileCount = 0;
        results     = preDrill.results;
        selectedIdx = preDrill.idx;
        courseNames = preDrill.courseNames;
        input.value = preDrill.query;
        preDrill    = null;
        rerender();
    };

    // ── Open selected item ────────────────────────────────────────

    const openSelected = async () => {
        const result = results[selectedIdx];
        if (!result) return;
        const { node } = result;

        const currentQuery = input.value.trim();
        const isFilesOnly  = currentQuery.startsWith('/f ');

        // Course in search mode → drill into it instead of navigating
        if (mode === 'search' && node.type === 'course' && !isFilesOnly) {
            await enterDrillMode(node);
            return;
        }

        if (currentQuery && node.type !== 'action') {
            await saveToHistory(currentQuery);
        }
        close();

        if (node.type === 'file' && node.parentId) {
            const parent = await db.nodes.get(node.parentId);
            if (parent?.url) {
                chrome.storage.local.set({ opalHighlightFile: { title: node.title, url: node.url } });
                location.href = parent.url;
                return;
            }
        }
        location.href = node.url;
    };

    // ── History on open ───────────────────────────────────────────

    loadHistory().then(hist => {
        if (hist.length > 0 && !input.value.trim()) {
            renderHistoryItems(hist, resultsEl, input);
        }
    });

    // ── Input handler ─────────────────────────────────────────────

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        selectedIdx = 0;

        // Typing while in drill mode → exit drill and search normally
        if (mode === 'drill') {
            mode = 'search';
            drillCourse = null;
            drillFileCount = 0;
            preDrill = null;
        }

        debounce = window.setTimeout(async () => {
            const q = input.value.trim();
            if (!q) {
                const hist = await loadHistory();
                if (hist.length > 0) renderHistoryItems(hist, resultsEl, input);
                else resultsEl.innerHTML = '';
                results = [];
                courseNames = new Map();
                return;
            }

            if (q.startsWith('/') && !q.startsWith('/c ') && !q.startsWith('/f ')) {
                results = [];
                resultsEl.innerHTML = '';
                return;
            }

            const isCoursesOnly = q.startsWith('/c ');
            const isFilesOnly   = q.startsWith('/f ');
            const displayQ = (isCoursesOnly || isFilesOnly) ? q.slice(3).trim() : q;

            const raw = await searchNodes(q, courseId, 30);

            // ── Build courseNames map for file/folder subtitles ────
            courseNames = new Map();
            if (isFilesOnly || (!isCoursesOnly)) {
                const cids = new Set<string>();
                for (const r of raw) {
                    if ((r.node.type === 'file' || r.node.type === 'folder') && r.node.courseId) {
                        cids.add(r.node.courseId);
                    }
                }
                if (cids.size > 0) {
                    const courseNodes = await db.nodes.bulkGet([...cids]);
                    for (const cn of courseNodes) {
                        if (cn) courseNames.set(cn.id, cn.title);
                    }
                }
            }

            // ── Substring-match favorites Orama may have missed ───
            const qLower = (displayQ || q).toLowerCase();
            const rawIds = new Set(raw.map(r => {
                try { return new URL(r.node.url, location.origin).pathname.replace(/\/$/, ''); }
                catch { return ''; }
            }));
            const extraFavs: SearchResult[] = [];
            if (!isFilesOnly) {
                for (const [path, course] of _favorites) {
                    if (rawIds.has(path)) continue;
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

            // ── Synthetic search action ───────────────────────────
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
                const favCourses: SearchResult[] = [...extraFavs];
                const otherCourses: SearchResult[] = [];
                for (const r of raw) {
                    let isFav = false;
                    try {
                        const p = new URL(r.node.url, location.origin).pathname.replace(/\/$/, '');
                        isFav = _favorites.has(p);
                    } catch { /* ignore malformed result URLs */ }
                    if (isFav) favCourses.push(r);
                    else otherCourses.push(r);
                }
                results = [...favCourses, searchAction, ...otherCourses].slice(0, 8);

            } else if (isFilesOnly) {
                results = raw.slice(0, 8);

            } else {
                const favCourses: SearchResult[] = [...extraFavs];
                const otherUserNodes: SearchResult[] = [];
                for (const r of raw) {
                    if (r.node.source === 'catalog') continue;
                    if (r.node.type === 'action') continue;
                    let isFav = false;
                    try {
                        const p = new URL(r.node.url, location.origin).pathname.replace(/\/$/, '');
                        isFav = _favorites.has(p);
                    } catch { /* ignore malformed result URLs */ }
                    if (isFav) favCourses.push(r);
                    else otherUserNodes.push(r);
                }
                results = [...favCourses, searchAction, ...otherUserNodes].slice(0, 8);
            }

            rerender();
        }, 120);
    });

    // ── Keyboard navigation ───────────────────────────────────────

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (mode === 'drill') exitDrillMode();
            else close();
        } else if (e.key === 'ArrowDown') { e.preventDefault(); navigate(+1); }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); navigate(-1); }
        else if (e.key === 'Enter')     { e.preventDefault(); openSelected(); }
    });

    // ── Click handlers ────────────────────────────────────────────

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { close(); return; }
        const item = (e.target as HTMLElement).closest<HTMLElement>('.opal-cmd-result');
        if (item) {
            e.preventDefault();
            const idx = Array.from(resultsEl.querySelectorAll('.opal-cmd-result')).indexOf(item);
            if (idx >= 0) selectedIdx = idx;
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
