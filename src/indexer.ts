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
import { matchEventToCourse } from './course-matcher';
import { loadCalendarEvents, expandRecurring } from './calendar-store';

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
        const m = path.match(/(\/opal\/[^/]*\/RepositoryEntry\/\d+)/i)
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
                source: 'user',
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
            source: 'user',
        });
    }
}

/* ── Public: index current page ────────────────────────────────── */

export async function indexCurrentPage(): Promise<void> {
    const url = location.href;
    const title = document.title.replace(/ [–—-] .*$/, '').trim() // strip " - OPAL" suffix
        || document.querySelector('h1')?.textContent?.trim()
        || '';

    if (!title || url.includes('/opal/home')) return;

    const crumbs = parseBreadcrumbs();
    const courseId = crumbs.length > 0 ? urlToId(crumbs[0].url) : urlToId(url);
    const parentId = crumbs.length > 1 ? urlToId(crumbs[crumbs.length - 2].url) : null;

    const node: IndexNode = {
        id: urlToId(url),
        title,
        url,
        type: inferType(url, title),
        courseId,
        parentId,
        lastVisited: Date.now(),
        visitCount: 1,
        fileExtension: inferExtension(url),
        source: 'user',
    };

    await upsertNode(node);

    // Also index any intermediate breadcrumb pages we haven't seen yet
    for (let i = 0; i < crumbs.length - 1; i++) {
        const c = crumbs[i];
        await upsertNode({
            id: urlToId(c.url),
            title: c.title,
            url: c.url,
            type: inferType(c.url, c.title),
            courseId: urlToId(crumbs[0].url),
            parentId: i > 0 ? urlToId(crumbs[i - 1].url) : null,
            lastVisited: Date.now(),
            visitCount: 1,
            source: 'user',
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
            const url = a.href;
            if (!title || title.length < 2 || !url.includes('opal')) continue;

            const id = urlToId(url);
            await upsertNode({
                id,
                title,
                url,
                type: inferType(url, title),
                courseId: id,        // top-level: course is its own root
                parentId: null,
                lastVisited: Date.now(),
                visitCount: 1,
                source: 'user',
            });
        }
    }

}

/* ── Public: background course catalog indexing ────────────────── */

/**
 * Index OPAL course catalog via a hidden iframe + header search form.
 *
 * Plain fetch() doesn't work — OPAL (Apache Wicket) needs a full browser
 * page load with JS execution to render search results.  Direct search
 * URLs also fail because Wicket's page state counter (?5) is session-bound.
 *
 * Strategy:
 *   1. Create a hidden 800×600 iframe and load /opal/home.
 *   2. Search "TU Dresden", then click "alle anzeigen" to load the
 *      full result table (wait until row count stabilises).
 *   3. Scrape `<tbody tr>` rows with metadata (title, description,
 *      author, institution, semester, courseType). Skip deprecated
 *      courses (icon-blocked).
 *   4. Upsert every course into Dexie + Orama via upsertNode().
 *
 * 1-hour cooldown via chrome.storage.local prevents hammering.
 * Errors are silently logged — best-effort enhancement.
 */

const CATALOG_COOLDOWN_KEY = 'opalCatalogIndexed_v1';
const CATALOG_SETTINGS_KEY = 'opalCatalogSettings';
const CATALOG_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CatalogSettings {
    enabled: boolean;
}

/** Load catalog indexing settings from chrome.storage.local. */
export async function loadCatalogSettings(): Promise<CatalogSettings> {
    const data = await chrome.storage.local.get({ [CATALOG_SETTINGS_KEY]: { enabled: false } });
    return data[CATALOG_SETTINGS_KEY] as CatalogSettings;
}

/** Save catalog indexing settings. */
export async function saveCatalogSettings(s: CatalogSettings): Promise<void> {
    await chrome.storage.local.set({ [CATALOG_SETTINGS_KEY]: s });
}

/** Get timestamp of last successful catalog index (0 = never). */
export async function getCatalogLastRun(): Promise<number> {
    const stored = await chrome.storage.local.get({ [CATALOG_COOLDOWN_KEY]: 0 });
    return (stored[CATALOG_COOLDOWN_KEY] as number) || 0;
}

/** Check whether the catalog data is stale (older than 30 days or never indexed). */
export async function isCatalogStale(): Promise<boolean> {
    const last = await getCatalogLastRun();
    return last === 0 || Date.now() - last > CATALOG_STALE_MS;
}

/**
 * Single query that matches virtually every course in the catalog —
 * nearly all entries on OPAL belong to TU Dresden.
 */
const CATALOG_QUERIES = [
    'TU Dresden',
];

const IFRAME_LOAD_TIMEOUT = 30_000;  // 30 s for initial home page load
const SEARCH_POLL_TIMEOUT = 45_000;  // 45 s to wait for results after clicking search
const POLL_INTERVAL_MS     =    500;  // poll every 500 ms

/* ── Iframe helpers ────────────────────────────────────────────── */

/** Set to true in DevTools to make indexer iframes visible for debugging:
 *  window.__opalIndexDebug = true  (then reload)  */
const DEBUG_IFRAME = false;

/** Create a hidden-but-sized iframe (Wicket needs real dimensions). */
function createCatalogIframe(): HTMLIFrameElement {
    const f = document.createElement('iframe');
    if (DEBUG_IFRAME) {
        f.style.cssText =
            'position:fixed;width:800px;height:600px;border:2px solid red;' +
            'top:10px;right:10px;z-index:999999;background:white;';
    } else {
        f.style.cssText =
            'position:fixed;width:800px;height:600px;border:none;' +
            'opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    }
    f.setAttribute('tabindex', '-1');
    f.setAttribute('aria-hidden', 'true');
    return f;
}

/** Wait for the next iframe load event (resolves true) or timeout (false). */
function waitForLoad(iframe: HTMLIFrameElement, timeout: number): Promise<boolean> {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), timeout);
        iframe.addEventListener('load', () => {
            clearTimeout(timer);
            resolve(true);
        }, { once: true });
    });
}

/**
 * Poll `iframe.contentDocument` for an element matching `selector`.
 * Re-reads contentDocument each tick so it works even if the iframe
 * navigates (full page load) rather than doing in-place AJAX updates.
 */
function pollIframe<T extends Element>(
    iframe: HTMLIFrameElement, selector: string, timeout: number,
): Promise<T | null> {
    return new Promise(resolve => {
        const t0 = Date.now();
        const tick = () => {
            try {
                const doc = iframe.contentDocument;
                if (doc) {
                    const el = doc.querySelector<T>(selector);
                    if (el) return resolve(el);
                }
            } catch { /* cross-origin or detached — ignore */ }
            if (Date.now() - t0 > timeout) return resolve(null);
            setTimeout(tick, POLL_INTERVAL_MS);
        };
        tick();
    });
}



/**
 * Like safeClick() in settings.ts but targets an iframe's document.
 * main-world.ts is injected into all frames (all_frames: true in manifest),
 * so dispatching opal-safe-click on iframe.contentDocument reaches the
 * MAIN world helper running inside that frame.
 */
function safeClickInFrame(el: HTMLElement, iframe: HTMLIFrameElement): void {
    const doc = iframe.contentDocument;
    if (!doc) return;
    const originalId = el.id;
    const tempId = 'opal-click-' + Math.random().toString(36).substring(2, 9);
    if (!originalId) el.id = tempId;
    doc.dispatchEvent(new CustomEvent('opal-safe-click', { detail: { tempId: el.id } }));
    setTimeout(() => { if (!originalId) el.removeAttribute('id'); }, 0);
}

/* ── Main export ───────────────────────────────────────────────── */

let catalogRunning = false;

export async function indexCourseCatalog(force = false): Promise<void> {
    const TAG = '[OPAL Catalog]';
    if (catalogRunning) {
        console.log(`${TAG} Already running — skipping concurrent call`);
        return;
    }
    catalogRunning = true;
    try {
        console.log(`${TAG} Starting background course catalog indexing...`);

        // ── Minimum 1-hour cooldown to prevent hammering ──────────
        if (!force) {
            const lastRun = await getCatalogLastRun();
            if (lastRun && Date.now() - lastRun < 60 * 60 * 1000) {
                const rem = Math.round((60 * 60 * 1000 - (Date.now() - lastRun)) / 60_000);
                console.log(`${TAG} Cooldown active (${rem} min remaining)`);
                return;
            }
        }

        const t0 = performance.now();
        const seenIds = new Set<string>();
        let totalIndexed = 0;

        // ── 1. Create iframe → /opal/home ─────────────────────────
        const iframe = createCatalogIframe();
        document.body.appendChild(iframe);
        iframe.src = 'https://bildungsportal.sachsen.de/opal/home';
        console.log(`${TAG} Loading OPAL home in hidden iframe...`);

        const homeLoaded = await waitForLoad(iframe, IFRAME_LOAD_TIMEOUT);
        if (!homeLoaded) {
            console.warn(`${TAG} Iframe failed to load /opal/home`);
            iframe.remove();
            return;
        }
        console.log(`${TAG}   Home page loaded`);

        // Verify we can access contentDocument and find the search form
        const homeDoc = iframe.contentDocument;
        if (!homeDoc?.querySelector('input[name="headerSearchField"]')) {
            console.warn(`${TAG} Search form not found on home page -- aborting`);
            iframe.remove();
            return;
        }

        // ── 2. For each query term, submit search + scrape ────────
        for (const term of CATALOG_QUERIES) {
            try {
                const iDoc = iframe.contentDocument;
                if (!iDoc) { console.warn(`${TAG}   No contentDocument`); break; }

                const input = iDoc.querySelector<HTMLInputElement>('input[name="headerSearchField"]');
                const btn = iDoc.querySelector<HTMLButtonElement>('button[name="headerSearchButton:btn"]');
                if (!input || !btn) {
                    console.warn(`${TAG}   "${term}": Search form missing -- skipping`);
                    continue;
                }

                // Fill search field and click submit.
                // Use the iframe's own Event/MouseEvent constructors so the events
                // originate from the page context — Wicket ignores clicks from the
                // extension context. Also wait 1 s for Wicket AJAX to attach handlers.
                console.log(`${TAG} Searching "${term}"...`);
                const iWin = iframe.contentWindow as (Window & typeof globalThis) | null;
                const IEvent      = (iWin as any)?.Event      ?? Event;
                const IMouseEvent = (iWin as any)?.MouseEvent ?? MouseEvent;
                input.value = term;
                input.dispatchEvent(new IEvent('input',  { bubbles: true }));
                input.dispatchEvent(new IEvent('change', { bubbles: true }));
                await new Promise(r => setTimeout(r, 1000)); // wait for Wicket handlers
                btn.dispatchEvent(new IMouseEvent('click', { bubbles: true, cancelable: true, view: iWin }));

                // Poll for results — look for RepositoryEntry links in the table
                const resultSel = 'tbody a[href*="/RepositoryEntry/"]';
                const found = await pollIframe<HTMLElement>(iframe, resultSel, SEARCH_POLL_TIMEOUT);
                if (!found) {
                    try {
                        const body = iframe.contentDocument?.body?.textContent?.substring(0, 300) || '(empty)';
                        console.warn(`${TAG}   "${term}": No results after ${SEARCH_POLL_TIMEOUT / 1000}s. Body: ${body}`);
                    } catch { /* noop */ }
                    continue;
                }

                // ── 3. Click "alle anzeigen" if present to load ALL results ──
                const curDoc = iframe.contentDocument!;
                // Case-insensitive search — OPAL has used both "alle anzeigen" and "Alle anzeigen"
                const alleSpan = Array.from(curDoc.querySelectorAll('span, a')).find(
                    el => /^alle\s+anzeigen$/i.test(el.textContent?.trim() ?? '')
                );
                if (alleSpan) {
                    const alleLink = (alleSpan.tagName === 'A' ? alleSpan : alleSpan.closest('a')) as HTMLAnchorElement | null;
                    if (alleLink) {
                        console.log(`${TAG}   "${term}": Clicking "alle anzeigen"...`);
                        // Use the MAIN world helper — main-world.ts runs in all_frames so
                        // it's present inside the hidden iframe too. Dispatching on
                        // iframe.contentDocument instead of the top-level document reaches it.
                        safeClickInFrame(alleLink, iframe);

                        // Wait for all entries to load — poll until "Seiten" span disappears
                        // or the row count stabilises (OPAL replaces the table body)
                        const ALLE_TIMEOUT = 120_000; // 2 min max
                        const t1 = Date.now();
                        let lastCount = 0;
                        let stableRounds = 0;
                        await new Promise<void>(resolve => {
                            const tick = () => {
                                try {
                                    const doc = iframe.contentDocument;
                                    if (!doc) { resolve(); return; }

                                    // Check if "Seiten" is still visible (means pagination is loading)
                                    const seitenSpan = Array.from(doc.querySelectorAll('span')).find(
                                        s => s.textContent?.trim() === 'Seiten'
                                    );

                                    const currentCount = doc.querySelectorAll(
                                        'tbody a[href*="/RepositoryEntry/"]'
                                    ).length;

                                    if (!seitenSpan && currentCount > lastCount) {
                                        // No more pagination and we have results — done
                                        console.log(`${TAG}   "${term}": All entries loaded (${currentCount} links)`);
                                        resolve();
                                        return;
                                    }

                                    // Stability check — if count hasn't changed for 3 ticks, assume done
                                    if (currentCount === lastCount && currentCount > 0) {
                                        stableRounds++;
                                        if (stableRounds >= 6) { // 3 seconds stable
                                            console.log(`${TAG}   "${term}": Table stable at ${currentCount} links`);
                                            resolve();
                                            return;
                                        }
                                    } else {
                                        stableRounds = 0;
                                        lastCount = currentCount;
                                    }
                                } catch { /* cross-origin etc */ }
                                if (Date.now() - t1 > ALLE_TIMEOUT) {
                                    console.warn(`${TAG}   "${term}": "alle anzeigen" timed out after ${ALLE_TIMEOUT / 1000}s`);
                                    resolve();
                                    return;
                                }
                                setTimeout(tick, POLL_INTERVAL_MS);
                            };
                            tick();
                        });
                    }
                } else {
                    console.log(`${TAG}   "${term}": No "alle anzeigen" found — scraping current page`);
                }

                // ── 4. Scrape all visible course links ────────────────
                let batchNew = 0;
                const finalDoc = iframe.contentDocument!;
                const rows = finalDoc.querySelectorAll('tbody tr');
                console.log(`${TAG}   "${term}": Scraping ${rows.length} table rows...`);

                for (const row of Array.from(rows)) {
                    // Skip deprecated/blocked courses
                    if (row.querySelector('span.fonticon.icon-blocked')) continue;

                    const a = row.querySelector<HTMLAnchorElement>('a[href*="/RepositoryEntry/"]');
                    if (!a?.href) continue;

                    let fullUrl: string;
                    try { fullUrl = new URL(a.href, 'https://bildungsportal.sachsen.de').href; }
                    catch { continue; }

                    const id = urlToId(fullUrl);
                    if (!id || seenIds.has(id)) continue;
                    seenIds.add(id);

                    const title =
                        a.getAttribute('title')
                        || a.textContent?.replace(/\s+/g, ' ').trim()
                        || '';
                    if (title.length < 2) continue;

                    // Extract metadata from table cells
                    // Columns: 0=star, 1=icon, 2=title, 3=description, 4=author,
                    //          5=institution, 6=license, 7=modified, 8=semester, 9=courseType, 10=views
                    const cells = row.querySelectorAll('td');
                    const cellText = (idx: number) =>
                        cells[idx]?.textContent?.replace(/\s+/g, ' ').trim() || '';

                    const description = cellText(3);
                    const author      = cellText(4);
                    const institution  = cellText(5);
                    const semester     = cellText(8);
                    const courseType   = cellText(9);

                    const courseId = extractCourseIdFromUrl(fullUrl);
                    await upsertNode({
                        id, title, url: fullUrl, type: 'course',
                        courseId: courseId || id, parentId: null,
                        lastVisited: Date.now(), visitCount: 1,
                        source: 'catalog',
                        description, author, institution, semester, courseType,
                    });
                    totalIndexed++;
                    batchNew++;
                    if (batchNew <= 3 || batchNew % 200 === 0) {
                        console.log(`${TAG}     #${totalIndexed}: "${title.substring(0, 60)}..."`);
                    }
                }

                console.log(`${TAG}   "${term}": +${batchNew} courses (${totalIndexed} total)`);

                // Brief pause between queries to be kind to the server
                await new Promise(r => setTimeout(r, 800));

            } catch (termErr) {
                console.warn(`${TAG}   "${term}": Error:`, termErr);
            }
        }

        // ── Cleanup ───────────────────────────────────────────────
        iframe.remove();
        chrome.storage.local.set({ [CATALOG_COOLDOWN_KEY]: Date.now() });

        const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
        console.log(`${TAG} Done -- ${totalIndexed} courses indexed in ${totalSec}s`);

    } catch (err) {
        console.error(`${TAG} Background catalog indexing error:`, err);
    } finally {
        catalogRunning = false;
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
    const data = await chrome.storage.local.get({ [HIGHLIGHT_KEY]: undefined });
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

/* ── Active Course Pre-Indexer ─────────────────────────────────── */

/**
 * Active Course Pre-Indexer — proactively crawls files for courses
 * that have events in today's or tomorrow's calendar.
 *
 * Flow:
 *   1. Load calendar events for today + tomorrow.
 *   2. Match each event title to a known course via matchEventToCourse().
 *   3. For each unindexed (or stale) course URL, open it in a hidden iframe.
 *   4. Detect links to material/folder sections within the course page.
 *   5. Navigate into each section and index file rows.
 *
 * Per-course 6-hour cooldown prevents hammering OPAL on every page load.
 * At most 3 courses are crawled per session.
 *
 * Must be called after the Fuse.js course index is populated, i.e. after
 * the first updateWidgetsContent() cycle (~5 s after init).
 */

const ACTIVE_INDEX_KEY        = 'opalActiveIndex_v1';
const ACTIVE_INDEX_SETTINGS_KEY = 'opalActiveIndexSettings';
const ACTIVE_COOLDOWN_MS      = 6 * 60 * 60 * 1000; // 6 h per course

export interface ActiveIndexSettings { enabled: boolean; }

export async function loadActiveIndexSettings(): Promise<ActiveIndexSettings> {
    const data = await chrome.storage.local.get({ [ACTIVE_INDEX_SETTINGS_KEY]: { enabled: true } });
    return data[ACTIVE_INDEX_SETTINGS_KEY] as ActiveIndexSettings;
}

export async function saveActiveIndexSettings(s: ActiveIndexSettings): Promise<void> {
    await chrome.storage.local.set({ [ACTIVE_INDEX_SETTINGS_KEY]: s });
}

/** Timestamp of the last active-index run (0 = never). */
export async function getActiveIndexLastRun(): Promise<number> {
    const stored = await chrome.storage.local.get({ [ACTIVE_INDEX_KEY]: {} });
    const map = stored[ACTIVE_INDEX_KEY] as Record<string, number>;
    const vals = Object.values(map);
    return vals.length > 0 ? Math.max(...vals) : 0;
}
const COURSE_LOAD_TIMEOUT_AI  = 15_000;              // 15 s for course page
const FOLDER_LOAD_TIMEOUT_AI  = 10_000;              // 10 s for folder pages
const MAX_COURSES_PER_RUN     = 3;
const MAX_SECTIONS_PER_COURSE = 5;

export async function indexUpcomingCourses(force = false): Promise<void> {
    const TAG = '[OPAL ActiveIndex]';
    try {
        const settings = await loadActiveIndexSettings();
        if (!settings.enabled) return;

        // ── 1. Calendar events for today + tomorrow ────────────
        const rawEvents = await loadCalendarEvents();
        const now = new Date();
        const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const rangeEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 23, 59, 59);
        const expanded   = expandRecurring(rawEvents, rangeStart, rangeEnd);

        if (expanded.length === 0) return;

        // ── 2. Match events → unique course URLs ───────────────
        const courseMap = new Map<string, string>(); // href → title
        for (const ev of expanded) {
            const match = matchEventToCourse(ev.title);
            if (match?.course.href && !courseMap.has(match.course.href)) {
                courseMap.set(match.course.href, match.course.title);
            }
        }
        if (courseMap.size === 0) return;

        // ── 3. Apply per-course cooldown ───────────────────────
        const stored    = await chrome.storage.local.get({ [ACTIVE_INDEX_KEY]: {} });
        const cooldowns = stored[ACTIVE_INDEX_KEY] as Record<string, number>;

        const toIndex = [...courseMap.entries()].filter(
            ([url]) => force || Date.now() - (cooldowns[url] ?? 0) > ACTIVE_COOLDOWN_MS
        );

        if (toIndex.length === 0) {
            console.log(`${TAG} All upcoming courses are fresh — skipping`);
            return;
        }

        console.log(`${TAG} Pre-indexing ${Math.min(toIndex.length, MAX_COURSES_PER_RUN)} upcoming course(s)…`);

        // ── 4. Crawl each course ───────────────────────────────
        for (const [url, title] of toIndex.slice(0, MAX_COURSES_PER_RUN)) {
            try {
                console.log(`${TAG}   "${title}"`);
                await indexCourseFilesViaIframe(url, TAG);
                cooldowns[url] = Date.now();
                await chrome.storage.local.set({ [ACTIVE_INDEX_KEY]: cooldowns });
            } catch (e) {
                console.warn(`${TAG}   Error on "${title}":`, e);
            }
            await new Promise(r => setTimeout(r, 500));
        }

        console.log(`${TAG} Done`);
    } catch (err) {
        console.warn('[OPAL ActiveIndex] Unexpected error:', err);
    }
}

async function indexCourseFilesViaIframe(courseUrl: string, TAG: string): Promise<void> {
    const iframe = createCatalogIframe();
    document.body.appendChild(iframe);
    try {
        iframe.src = courseUrl;
        const loaded = await waitForLoad(iframe, COURSE_LOAD_TIMEOUT_AI);
        if (!loaded) { console.warn(`${TAG}     Timeout loading ${courseUrl}`); return; }

        const doc = iframe.contentDocument;
        if (!doc) return;

        const courseId = extractCourseIdFromUrl(courseUrl);

        // Index the course landing page itself
        const pageTitle = doc.title?.replace(/ [–—-] .*$/, '').trim() || '';
        if (pageTitle) {
            await upsertNode({
                id: urlToId(courseUrl), title: pageTitle, url: courseUrl,
                type: 'course', courseId, parentId: null,
                lastVisited: Date.now(), visitCount: 1, source: 'user',
            });
        }

        // Find links to material / folder sections
        const sections = findMaterialSectionLinks(doc, courseUrl);
        console.log(`${TAG}     → ${sections.length} section(s) found`);

        for (const sectionUrl of sections.slice(0, MAX_SECTIONS_PER_COURSE)) {
            try {
                iframe.src = sectionUrl;
                const sLoaded = await waitForLoad(iframe, FOLDER_LOAD_TIMEOUT_AI);
                if (!sLoaded) continue;

                const sDoc = iframe.contentDocument;
                if (!sDoc) continue;

                const count = await scrapeFilesFromDoc(sDoc, courseId, urlToId(sectionUrl));
                if (count > 0) console.log(`${TAG}       +${count} file(s) from ${sectionUrl}`);
            } catch { /* skip broken section */ }
            await new Promise(r => setTimeout(r, 300));
        }
    } finally {
        iframe.remove();
    }
}

/**
 * Find links within a course page that lead to material/folder sections.
 * Filters to links that share the same RepositoryEntry ID and match
 * either URL structure or link-text keywords.
 */
function findMaterialSectionLinks(doc: Document, courseUrl: string): string[] {
    // Extract the numeric course ID for same-course filtering
    const idMatch = courseUrl.match(/\/RepositoryEntry\/(\d+)/i);
    const repoId  = idMatch ? idMatch[1] : '';

    const origin = (() => { try { return new URL(courseUrl).origin; } catch { return ''; } })();
    const seen   = new Set<string>();
    const links: string[] = [];

    for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const raw = a.getAttribute('href') || '';
        if (!raw || raw.startsWith('javascript:')) continue;

        let full: string;
        try { full = new URL(raw, origin).href; } catch { continue; }

        // Must belong to the same course
        if (repoId && !full.includes(repoId)) continue;
        // Skip the root course URL itself
        if (full === courseUrl || seen.has(full)) continue;

        const lower = full.toLowerCase();
        const text  = a.textContent?.trim() ?? '';

        const isSection =
            lower.includes('/folder/') ||
            lower.includes('/briefcase') ||
            lower.includes('coursenode') ||
            /material|datei|ordner|skript|folien|vorlesung|übung|uebung|exercise|script|slides/i.test(text);

        if (isSection) {
            seen.add(full);
            links.push(full);
        }
    }
    return links;
}

/**
 * Scrape file/folder links from a given Document and upsert them into the index.
 * Same logic as indexFilesOnPage() but accepts any Document (e.g. from an iframe).
 * Returns the count of nodes indexed.
 */
async function scrapeFilesFromDoc(doc: Document, courseId: string, parentId: string): Promise<number> {
    let count = 0;

    // Strategy 1: a[data-file-name] — stable OPAL attribute
    const fileLinks = doc.querySelectorAll<HTMLAnchorElement>('a[data-file-name]');
    if (fileLinks.length > 0) {
        for (const a of Array.from(fileLinks)) {
            const href = a.href;
            if (!href || href.startsWith('javascript:')) continue;

            const title = a.getAttribute('data-file-name') || a.textContent?.trim() || '';
            if (!title) continue;

            const row      = a.closest('tr');
            const iconEl   = row?.querySelector<HTMLElement>('span.fonticon');
            const isFolder = iconEl?.classList.contains('icon-folder') ?? false;

            await upsertNode({
                id: urlToId(href), title, url: href,
                type: isFolder ? 'folder' : 'file',
                courseId, parentId, lastVisited: Date.now(), visitCount: 1,
                fileExtension: isFolder ? undefined : (inferExtension(href) ?? inferExtensionFromName(title)),
                source: 'user',
            });
            count++;
        }
        return count;
    }

    // Strategy 2: file-extension hrefs (fallback) — includes .html for FolderResource pages
    for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = a.href;
        if (!/\.(pdf|zip|docx?|pptx?|xlsx?|mp4|png|jpg|svg|csv|txt|7z|rar|html?)(\?|$)/i.test(href)) continue;
        // Skip navigation / layout HTML (only keep FolderResource HTML files)
        if (/\.html?(\?|$)/i.test(href) && !href.includes('FolderResource')) continue;
        const title = a.textContent?.trim() || '';
        if (!title || title.length < 2) continue;

        await upsertNode({
            id: urlToId(href), title, url: href, type: 'file',
            courseId, parentId, lastVisited: Date.now(), visitCount: 1,
            fileExtension: inferExtension(href) ?? inferExtensionFromName(title),
            source: 'user',
        });
        count++;
    }
    return count;
}
