/* ━━ Passive Page Indexer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Passive Page Indexer — runs on every OPAL page load.
 *
 * indexCurrentPage()
 *   Reads breadcrumbs + the current page link to build an IndexNode and
 *   upserts it via the search engine. Called from main.ts on every page.
 *
 * bootstrapFromDashboard()
 *   Seeds the index from the Favorites and My Courses portlets visible on
 *   the home page. This gives the user useful search results on Day 1,
 *   before they have browsed individual pages.
 */

import { upsertNode } from './core/search-engine';
import type { IndexNode } from './core/index-db';

/* ── ID helpers ────────────────────────────────────────────────── */

/** Derive a stable ID from a URL (path only — strip Wicket version counters).
 *  OPAL appends bare numeric query params like ?32, ?33 on every AJAX round-trip.
 *  Including them would create duplicate index entries for the same page. */
function urlToId(url: string): string {
    // Reject non-http URLs (javascript:, data:, etc.)
    if (!url || !url.startsWith('http')) return '';
    try {
        const u = new URL(url);
        // Keep search params only if they carry real keys (e.g. ?foo=bar),
        // drop bare Wicket counters like ?32
        const search = /^\?\d+$/.test(u.search) ? '' : u.search;
        return (u.pathname + search).replace(/\/$/, '') || url;
    } catch {
        return url;
    }
}

/* ── Type inference ────────────────────────────────────────────── */

function inferType(url: string, title: string): IndexNode['type'] {
    const u = url.toLowerCase();
    // File-extension check FIRST — URLs like /RepositoryEntry/.../file.pdf are files, not courses
    if (/\.(pdf|zip|docx?|pptx?|xlsx?|mp4|png|jpg|svg|csv|txt|7z|rar)(\?|$)/.test(u)) return 'file';
    if (u.includes('/course/') || u.includes('repositoryentry')) return 'course';
    if (u.includes('/folder/') || u.includes('briefcase')) return 'folder';
    return 'action';
}

function inferExtension(url: string): string | undefined {
    const m = url.toLowerCase().match(/\.([a-z0-9]{2,5})(\?|$)/);
    return m ? m[1] : undefined;
}

/** Extract extension from a human-readable filename like "Notes.pdf". */
function inferExtensionFromName(name: string): string | undefined {
    const m = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    return m ? m[1] : undefined;
}

/**
 * Extract the stable course root ID from a URL.
 * Returns the "/opal/auth/RepositoryEntry/XXXXX" portion if present,
 * otherwise falls back to urlToId(url).
 */
function extractCourseIdFromUrl(url: string): string {
    try {
        const path = new URL(url).pathname;
        const m    = path.match(/(\/opal\/[^/]*\/RepositoryEntry\/\d+)/i)
                  ?? path.match(/(\/RepositoryEntry\/\d+)/i);
        return m ? m[1] : urlToId(url);
    } catch {
        return urlToId(url);
    }
}

/* ── Breadcrumb parser ─────────────────────────────────────────── */

interface BreadcrumbEntry { title: string; url: string; }

function parseBreadcrumbs(): BreadcrumbEntry[] {
    const anchors = document.querySelectorAll<HTMLAnchorElement>(
        '.o_breadcrumb a, nav.breadcrumb a, [class*="breadcrumb"] a'
    );
    return Array.from(anchors)
        .map(a => ({ title: a.textContent?.trim() ?? '', url: a.href }))
        .filter(e => e.title && e.url
                  && !e.url.includes('/opal/home')
                  && !e.url.startsWith('javascript:'));
}

/* ── File listing scraper ──────────────────────────────────────── */

/**
 * When the user visits an OPAL folder page (div.folder table), scrape every
 * file and sub-folder row and upsert them into the index so they appear in
 * search results without requiring a separate visit.
 *
 * DOM shape (verified against live OPAL pages):
 *   div.folder > div > div.table-panel > form > … > table > tbody > tr
 *   Each row: [checkbox | span.fonticon.(pdf|zip|icon-folder|…) | a[data-file-name] | size | date | license]
 */
/** Fingerprint of the last set of file hrefs we indexed — skip if unchanged. */
let lastFileFingerprint = '';

export async function indexFilesOnPage(): Promise<void> {
    // Strategy 1: a[data-file-name] links (stable OPAL attribute)
    const fileLinks = document.querySelectorAll<HTMLAnchorElement>('a[data-file-name]');

    // Fingerprint check — skip if the same set of files was already indexed
    const hrefs = Array.from(fileLinks).map(a => a.href).sort().join('|');
    const fingerprint = location.pathname + '::' + hrefs;
    if (fingerprint === lastFileFingerprint) return;
    lastFileFingerprint = fingerprint;

    if (fileLinks.length === 0) {
        // Strategy 2: any anchor whose href looks like a file download
        const allAnchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
        let found = false;
        for (const a of Array.from(allAnchors)) {
            if (/\.(pdf|zip|docx?|pptx?|xlsx?|mp4|png|jpg|svg|csv|txt|7z|rar)(\?|$)/i.test(a.href)) { found = true; break; }
        }
        if (!found) return;
    }

    const courseId = extractCourseIdFromUrl(location.href);
    const parentId = urlToId(location.href);

    if (fileLinks.length > 0) {
        for (const linkEl of Array.from(fileLinks)) {
            const href = linkEl.href;
            if (!href || href.startsWith('javascript:')) continue;

            const title = linkEl.getAttribute('data-file-name')
                       || linkEl.textContent?.trim()
                       || '';
            if (!title) continue;

            const row = linkEl.closest('tr');
            const iconEl = row?.querySelector<HTMLElement>('span.fonticon');
            const isFolder = iconEl?.classList.contains('icon-folder') ?? false;
            const type: IndexNode['type'] = isFolder ? 'folder' : 'file';
            const fileExtension = isFolder
                ? undefined
                : (inferExtension(href) ?? inferExtensionFromName(title));

            await upsertNode({
                id: urlToId(href), title, url: href, type,
                courseId, parentId, lastVisited: Date.now(), visitCount: 1, fileExtension,
            });
        }
        return;
    }

    // Fallback: file-like href anchors without data-file-name
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = a.href;
        if (!/\.(pdf|zip|docx?|pptx?|xlsx?|mp4|png|jpg|svg|csv|txt|7z|rar)(\?|$)/i.test(href)) continue;
        const title = a.textContent?.trim() || '';
        if (!title || title.length < 2) continue;

        await upsertNode({
            id: urlToId(href), title, url: href, type: 'file',
            courseId, parentId, lastVisited: Date.now(), visitCount: 1,
            fileExtension: inferExtension(href) ?? inferExtensionFromName(title),
        });
    }
}

/* ── Public: index current page ────────────────────────────────── */

export async function indexCurrentPage(): Promise<void> {
    const url   = location.href;
    const title = document.title.replace(/ [–—-] .*$/, '').trim() // strip " - OPAL" suffix
                  || document.querySelector('h1')?.textContent?.trim()
                  || '';

    if (!title || url.includes('/opal/home')) return;

    const crumbs = parseBreadcrumbs();
    const courseId = crumbs.length > 0 ? urlToId(crumbs[0].url) : urlToId(url);
    const parentId = crumbs.length > 1 ? urlToId(crumbs[crumbs.length - 2].url) : null;

    const node: IndexNode = {
        id:            urlToId(url),
        title,
        url,
        type:          inferType(url, title),
        courseId,
        parentId,
        lastVisited:   Date.now(),
        visitCount:    1,
        fileExtension: inferExtension(url),
    };

    await upsertNode(node);

    // Also index any intermediate breadcrumb pages we haven't seen yet
    for (let i = 0; i < crumbs.length - 1; i++) {
        const c = crumbs[i];
        await upsertNode({
            id:          urlToId(c.url),
            title:       c.title,
            url:         c.url,
            type:        inferType(c.url, c.title),
            courseId:    urlToId(crumbs[0].url),
            parentId:    i > 0 ? urlToId(crumbs[i - 1].url) : null,
            lastVisited: Date.now(),
            visitCount:  1,
        });
    }

    // Index any files/folders visible in a folder listing on this page
    await indexFilesOnPage();
}

/* ── Public: bootstrap from dashboard portlets ─────────────────── */

/**
 * Seed the index from the Favorites and My Courses portlets on the home page.
 * Runs once on Day 1 so there are results before any navigation.
 */
export async function bootstrapFromDashboard(): Promise<void> {
    const portletSelectors = [
        'div[data-portlet-order="Bookmarks"]',
        'div[data-portlet-order="RepositoryPortletStudent"]',
    ];

    for (const sel of portletSelectors) {
        const portlet = document.querySelector(sel);
        if (!portlet) continue;

        const links = portlet.querySelectorAll<HTMLAnchorElement>('a[href]');
        for (const a of Array.from(links)) {
            const title = a.textContent?.trim();
            const url   = a.href;
            if (!title || title.length < 2 || !url.includes('opal')) continue;

            const id = urlToId(url);
            await upsertNode({
                id,
                title,
                url,
                type:        inferType(url, title),
                courseId:    id,        // top-level: course is its own root
                parentId:    null,
                lastVisited: Date.now(),
                visitCount:  1,
            });
        }
    }

}

/* ── Public: highlight a file row after Command Center navigation ── */

const HIGHLIGHT_KEY = 'opalHighlightFile';

interface HighlightIntent { title: string; url: string; }

/**
 * Check chrome.storage.local for a pending file-highlight instruction.
 * If found, locate the matching file row on the current page, scroll to it,
 * and pulse it with a highlight animation. One-shot: cleared immediately.
 */
export async function checkAndHighlightFile(): Promise<void> {
    const data = await new Promise<Record<string, unknown>>(r =>
        chrome.storage.local.get(HIGHLIGHT_KEY, r)
    );
    const intent = data[HIGHLIGHT_KEY] as HighlightIntent | undefined;
    if (!intent) return;

    // Clear immediately (one-shot)
    chrome.storage.local.remove([HIGHLIGHT_KEY]);

    // Try to find the file row — OPAL may still be loading via AJAX, so retry once after 800ms
    const tryHighlight = (): boolean => {
        // Strategy 1: match by data-file-name attribute
        const byName = document.querySelector<HTMLAnchorElement>(
            `a[data-file-name="${CSS.escape(intent.title)}"]`
        );
        if (byName) {
            const row = byName.closest('tr') ?? byName.parentElement;
            if (row) { applyHighlight(row); return true; }
        }

        // Strategy 2: match by href containing the same URL path
        try {
            const targetPath = new URL(intent.url).pathname;
            for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
                try {
                    if (new URL(a.href).pathname === targetPath) {
                        const row = a.closest('tr') ?? a.parentElement;
                        if (row) { applyHighlight(row); return true; }
                    }
                } catch { /* skip invalid URLs */ }
            }
        } catch { /* skip if intent.url is invalid */ }

        return false;
    };

    if (!tryHighlight()) {
        // Retry once after Wicket AJAX may have rendered the table
        setTimeout(() => tryHighlight(), 800);
    }
}

function applyHighlight(el: Element): void {
    el.classList.add('opal-file-highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Clean up class after animation completes
    setTimeout(() => el.classList.remove('opal-file-highlight'), 3500);
}
