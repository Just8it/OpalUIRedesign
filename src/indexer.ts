import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
import { loadCourseInBackground, courseIdFromUrl } from './course/loader.ts';
import { snapshotIndexNodes } from './course/index-nodes.ts';
import { createBackgroundStepper } from './opal/iframe-step.ts';
import { OpalError } from './opal/gateway.ts';
import { responseFailure } from './opal/coordinator.ts';
import './opal/native-bridge.ts';
import { collectDeadlinesFromDoc } from './core/deadline-collector';
import { isSafeCourseLink } from './core/index-messages';
/* ━━ Passive Page Indexer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Passive Page Indexer — runs on every OPAL page load.
 *
 * indexCurrentPage()
 *   Reads breadcrumbs + the current page link to build an IndexNode and
 *   upserts it via the search engine. Called from main.ts on every page.
 *
 * bootstrapFromDashboard()
 *   Seeds the index from the Favorites portlet visible on
 *   the home page. This gives the user useful search results on Day 1,
 *   before they have browsed individual pages.
 */

import { upsertNode, flushUpserts, recordVisit, type IndexNodeInput } from './core/search-engine';
import type { IndexNode } from './core/search/types';
import { startProgress, type ProgressReporter } from './core/index-progress';
import { matchEventToCourse } from './course-matcher';
import { loadCalendarEvents, expandRecurring } from './calendar-store';
import {
    extractCourseNodeLinksFromMarkup,
    FILE_EXTENSION_PATTERN,
    inferExtensionFromName,
    inferExtensionFromUrl,
    isDownloadUrl,
    readBestLinkTitle,
} from './core/opal-link-parser';

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

function inferType(url: string, _title: string): IndexNode['type'] {
    const u = url.toLowerCase();
    // File-extension check FIRST — URLs like /RepositoryEntry/.../file.pdf are files, not courses
    if (FILE_EXTENSION_PATTERN.test(u)) return 'file';
    // CourseNode sub-URLs are sections within a course — classify as folder, not course
    if (u.includes('coursenode')) return 'folder';
    if (u.includes('/course/') || u.includes('repositoryentry')) return 'course';
    if (u.includes('/folder/') || u.includes('briefcase')) return 'folder';
    return 'action';
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
    const courseId = extractCourseIdFromUrl(location.href);
    const parentId = urlToId(location.href);
    const sectionLinks = findMaterialSectionLinks(document, location.href);

    // Fingerprint check — skip if the same set of files was already indexed
    const hrefs = [
        ...Array.from(fileLinks).map(a => a.href),
        ...sectionLinks.map(section => section.url),
    ].sort().join('|');
    const fingerprint = location.pathname + '::' + hrefs;
    if (fingerprint === lastFileFingerprint) return;
    lastFileFingerprint = fingerprint;

    if (fileLinks.length === 0) {
        // Strategy 2: any anchor whose href looks like a file download
        const allAnchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
        let found = sectionLinks.length > 0;
        for (const a of Array.from(allAnchors)) {
            if (isDownloadUrl(a.href)) { found = true; break; }
        }
        if (!found) return;
    }

    for (const section of sectionLinks) {
        await upsertNode({
            id: urlToId(section.url),
            title: section.title,
            url: section.url,
            type: 'folder',
            courseId,
            parentId,
            source: 'user',
            searchText: document.title,
        });
    }

    const indexedFileUrls = new Set<string>();
    if (fileLinks.length > 0) {
        for (const linkEl of Array.from(fileLinks).slice(0, 500)) {
            const href = linkEl.href;
            if (!isSafeCourseLink(href, new URL(courseId, location.origin).href)) continue;

            const title = readBestLinkTitle({
                'data-file-name': linkEl.getAttribute('data-file-name') ?? undefined,
                download: linkEl.getAttribute('download') ?? undefined,
                title: linkEl.getAttribute('title') ?? undefined,
                'aria-label': linkEl.getAttribute('aria-label') ?? undefined,
            }, linkEl.textContent ?? '', href);
            if (!title) continue;

            const row = linkEl.closest('tr');
            const iconEl = row?.querySelector<HTMLElement>('span.fonticon');
            const isFolder = iconEl?.classList.contains('icon-folder') ?? false;
            const type: IndexNode['type'] = isFolder ? 'folder' : 'file';
            const fileExtension = isFolder
                ? undefined
                : (inferExtensionFromUrl(href) ?? inferExtensionFromName(title));

            await upsertNode({
                id: urlToId(href), title, url: href, type,
                courseId, parentId, fileExtension,
                source: 'user',
                searchText: document.title,
            });
            indexedFileUrls.add(urlToId(href));
        }
    }

    // Fallback: file-like href anchors without data-file-name
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = a.href;
        if (!isDownloadUrl(href) || !isSafeCourseLink(href, new URL(courseId, location.origin).href)) continue;
        const id = urlToId(href);
        if (indexedFileUrls.has(id)) continue;
        const title = readBestLinkTitle({
            download: a.getAttribute('download') ?? undefined,
            title: a.getAttribute('title') ?? undefined,
            'aria-label': a.getAttribute('aria-label') ?? undefined,
        }, a.textContent ?? '', href);
        if (!title || title.length < 2) continue;

        await upsertNode({
            id, title, url: href, type: 'file',
            courseId, parentId,
            fileExtension: inferExtensionFromUrl(href) ?? inferExtensionFromName(title),
            source: 'user',
            searchText: document.title,
        });
    }
}

/* ── Public: index current page ────────────────────────────────── */

/** Guards recordVisit to once per page load. */
let visitRecordedFor = '';

export async function indexCurrentPage(): Promise<void> {
    const url = location.href;
    if (visitRecordedFor !== urlToId(url)) collectPageDeadlines(document, url, parseBreadcrumbs()[0]?.title);
    const title = document.title.replace(/ [–—-] .*$/, '').trim() // strip " - OPAL" suffix
        || document.querySelector('h1')?.textContent?.trim()
        || '';

    if (!title || url.includes('/opal/home')) return;

    const crumbs = parseBreadcrumbs();
    const breadcrumbText = crumbs.map(c => c.title).join(' ');
    // extractCourseIdFromUrl strips /CourseNode/... so sub-pages of a course
    // always get the root RepositoryEntry as their courseId, not their own URL.
    const courseId = crumbs.length > 0 ? extractCourseIdFromUrl(crumbs[0].url) : extractCourseIdFromUrl(url);
    const parentId = crumbs.length > 1 ? urlToId(crumbs[crumbs.length - 2].url) : null;

    const node: IndexNodeInput = {
        id: urlToId(url),
        title,
        url,
        type: inferType(url, title),
        courseId,
        parentId,
        fileExtension: inferExtensionFromUrl(url),
        source: 'user',
        searchText: breadcrumbText,
    };

    await upsertNode(node);

    // The page the user is on is the only passive signal that counts as a
    // visit; breadcrumbs and listed files below are merely indexed.
    if (node.id && visitRecordedFor !== node.id) {
        visitRecordedFor = node.id;
        recordVisit(node.id, node).catch(console.warn);
    }

    // Also index any intermediate breadcrumb pages we haven't seen yet
    for (let i = 0; i < crumbs.length - 1; i++) {
        const c = crumbs[i];
        await upsertNode({
            id: urlToId(c.url),
            title: c.title,
            url: c.url,
            type: inferType(c.url, c.title),
            courseId: extractCourseIdFromUrl(crumbs[0].url),
            parentId: i > 0 ? urlToId(crumbs[i - 1].url) : null,
            source: 'user',
            searchText: breadcrumbText,
        });
    }

    // Index any files/folders visible in a folder listing on this page
    await indexFilesOnPage();
}

/* ── Public: bootstrap from dashboard portlets ─────────────────── */

/**
 * Seed the index from the Favorites portlet on the home page.
 * Runs once on Day 1 so there are results before any navigation.
 */
export async function bootstrapFromDashboard(): Promise<void> {
    const portlet = document.querySelector('div[data-portlet-order="Bookmarks"]');
    if (!portlet || portlet.querySelector('.panel-config')) return;
    const snapshot = new Map<string, { href: string; title: string }>();
    const links = portlet.querySelectorAll<HTMLAnchorElement>('a[href]');
    for (const a of Array.from(links)) {
        const title = a.textContent?.trim();
        const url = a.href;
        if (!title || title.length < 2 || !url.includes('opal')) continue;

        if (!isSafeCourseLink(url, url)) continue;
        snapshot.set(extractCourseIdFromUrl(url), { href: url, title });
        const id = urlToId(url);
        await upsertNode({
            id,
            title,
            url,
            type: inferType(url, title),
            courseId: extractCourseIdFromUrl(url),
            parentId: null,
            source: 'user',
        });
    }
    await store.set(keys.favoriteSnapshot, [...snapshot.values()]);
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
 *   4. Queue every course via upsertNode(); the background stores it.
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
    const data = { [CATALOG_SETTINGS_KEY]: await store.get(keys.catalog) };
    return data[CATALOG_SETTINGS_KEY] as CatalogSettings;
}

/** Save catalog indexing settings. */
export async function saveCatalogSettings(s: CatalogSettings): Promise<void> {
    await store.set(keys.catalog, s);
}

/** Get timestamp of last successful catalog index (0 = never). */
export async function getCatalogLastRun(): Promise<number> {
    const stored = { [CATALOG_COOLDOWN_KEY]: await store.get(keys.catalogIndexed) };
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

function checkFrameSession(iframe: HTMLIFrameElement): void {
    const doc = iframe.contentDocument;
    if (!doc) throw new OpalError('session', 'OPAL iframe left the session origin');
    const failure = responseFailure(doc.URL, doc.documentElement?.outerHTML ?? '');
    if (failure) throw new OpalError(failure, 'OPAL iframe session unavailable');
}

/** Wait for the next iframe load event (resolves true) or timeout (false). */
function waitForLoad(iframe: HTMLIFrameElement, timeout: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(false), timeout);
        iframe.addEventListener('load', () => {
            clearTimeout(timer);
            try { checkFrameSession(iframe); resolve(true); } catch (error) { reject(error); }
        }, { once: true });
    });
}

/**
 * Poll `iframe.contentDocument` for an element matching `selector`.
 * Re-reads contentDocument each tick so it works even if the iframe
 * navigates (full page load) rather than doing in-place AJAX updates.
 */
function pollIframe<T extends Element>(
    iframe: HTMLIFrameElement, selector: string, timeout: number, signal?: AbortSignal,
): Promise<T | null> {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
            if (signal?.aborted) { reject(signal.reason); return; }
            try {
                checkFrameSession(iframe);
                const doc = iframe.contentDocument;
                if (doc) {
                    const el = doc.querySelector<T>(selector);
                    if (el) return resolve(el);
                }
            } catch (error) { if (error instanceof OpalError) { reject(error); return; } }
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
    doc.documentElement.setAttribute('data-opal-click-target', el.id);
    doc.dispatchEvent(new CustomEvent('opal-safe-click'));
    setTimeout(() => {
        doc.documentElement.removeAttribute('data-opal-click-target');
        if (!originalId) el.removeAttribute('id');
    }, 0);
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
    let progress: ProgressReporter | null = null;
    let completed = false;
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
        // The catalog total is unknown until all pages loaded: indeterminate bar.
        progress = startProgress('catalog', 0);

        // ── 1. Create iframe → /opal/home ─────────────────────────
        const iframe = createCatalogIframe();
        document.body.appendChild(iframe);
        const step = createBackgroundStepper(iframe);
        try {
        const homeLoaded = await step(async () => {
        iframe.src = 'https://bildungsportal.sachsen.de/opal/home';
        console.log(`${TAG} Loading OPAL home in hidden iframe...`);

        return await waitForLoad(iframe, IFRAME_LOAD_TIMEOUT);
        });
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
                const found = await step(async signal => {
                const iDoc = iframe.contentDocument;
                if (!iDoc) return null;

                const input = iDoc.querySelector<HTMLInputElement>('input[name="headerSearchField"]');
                const btn = iDoc.querySelector<HTMLButtonElement>('button[name="headerSearchButton:btn"]');
                if (!input || !btn) {
                    console.warn(`${TAG}   "${term}": Search form missing -- skipping`);
                    return null;
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
                signal.throwIfAborted();
                btn.dispatchEvent(new IMouseEvent('click', { bubbles: true, cancelable: true, view: iWin }));

                // Poll for results — look for RepositoryEntry links in the table
                const resultSel = 'tbody a[href*="/RepositoryEntry/"]';
                return await pollIframe<HTMLElement>(iframe, resultSel, Math.min(SEARCH_POLL_TIMEOUT, 13_000), signal);
                });
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
                        await step(async signal => {
                        safeClickInFrame(alleLink, iframe);

                        // Wait for all entries to load — poll until "Seiten" span disappears
                        // or the row count stabilises (OPAL replaces the table body)
                        const ALLE_TIMEOUT = 13_000; // 2 min max
                        const t1 = Date.now();
                        let lastCount = 0;
                        let stableRounds = 0;
                        await new Promise<void>((resolve, reject) => {
                            const tick = () => {
                                if (signal.aborted) { reject(signal.reason); return; }
                                try {
                                    checkFrameSession(iframe);
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
                                } catch (error) { reject(error); return; }
                                if (Date.now() - t1 > ALLE_TIMEOUT) {
                                    console.warn(`${TAG}   "${term}": "alle anzeigen" timed out after ${ALLE_TIMEOUT / 1000}s`);
                                    resolve();
                                    return;
                                }
                                setTimeout(tick, POLL_INTERVAL_MS);
                            };
                            tick();
                        });
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

                for (const row of Array.from(rows).slice(0, 5000)) {
                    // Skip deprecated/blocked courses
                    if (row.querySelector('span.fonticon.icon-blocked')) continue;

                    const a = row.querySelector<HTMLAnchorElement>('a[href*="/RepositoryEntry/"]');
                    if (!a?.href) continue;

                    let fullUrl: string;
                    try { fullUrl = new URL(a.href, 'https://bildungsportal.sachsen.de').href; }
                    catch { continue; }

                    if (!isSafeCourseLink(fullUrl, fullUrl)) continue;
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
                        source: 'catalog',
                        description, author, institution, semester, courseType,
                    });
                    totalIndexed++;
                    batchNew++;
                    progress?.addItems(1);
                    if (batchNew <= 3 || batchNew % 200 === 0) {
                        console.log(`${TAG}     #${totalIndexed}: "${title.substring(0, 60)}..."`);
                    }
                }

                console.log(`${TAG}   "${term}": +${batchNew} courses (${totalIndexed} total)`);

                // Brief pause between queries to be kind to the server
                await new Promise(r => setTimeout(r, 800));

            } catch (termErr) {
                if (termErr instanceof OpalError) throw termErr;
                console.warn(`${TAG}   "${term}": Error:`, termErr);
            }
        }

        // ── Cleanup ───────────────────────────────────────────────
        iframe.remove();
        } finally { iframe.remove(); }
        store.set(keys.catalogIndexed, Date.now());
        completed = true;

        const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
        console.log(`${TAG} Done -- ${totalIndexed} courses indexed in ${totalSec}s`);

    } catch (err) {
        console.error(`${TAG} Background catalog indexing error:`, err);
    } finally {
        catalogRunning = false;
        await flushUpserts();
        await progress?.finish(completed ? 'done' : 'idle');
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
    const data = { [HIGHLIGHT_KEY]: await store.get(keys.highlight) };
    const intent = data[HIGHLIGHT_KEY] as HighlightIntent | undefined;
    if (!intent) return;

    // Clear immediately (one-shot)
    store.remove(keys.highlight);

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
 *   3. For each unindexed (or stale) course URL, fetch it through the background course loader.
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
    const data = { [ACTIVE_INDEX_SETTINGS_KEY]: await store.get(keys.preload) };
    return data[ACTIVE_INDEX_SETTINGS_KEY] as ActiveIndexSettings;
}

export async function saveActiveIndexSettings(s: ActiveIndexSettings): Promise<void> {
    await store.set(keys.preload, s);
}

/** Timestamp of the last active-index run (0 = never). */
export async function getActiveIndexLastRun(): Promise<number> {
    const stored = { [ACTIVE_INDEX_KEY]: await store.get(keys.activeIndex) };
    const map = stored[ACTIVE_INDEX_KEY] as Record<string, number>;
    const vals = Object.values(map);
    return vals.length > 0 ? Math.max(...vals) : 0;
}
const MAX_COURSES_PER_RUN     = 3;

export async function indexUpcomingCourses(force = false): Promise<void> {
    const TAG = '[OPAL ActiveIndex]';
    try {
        const settings = await loadActiveIndexSettings();
        if (!settings.enabled) return;
        const favorites = await store.get(keys.favoriteSnapshot);
        const favoriteIds = new Set(favorites.map(c => courseIdFromUrl(c.href)).filter(Boolean));
        if (!favoriteIds.size) return;

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
            if (match?.course.href && favoriteIds.has(courseIdFromUrl(match.course.href)) && !courseMap.has(match.course.href)) {
                courseMap.set(match.course.href, match.course.title);
            }
        }
        if (courseMap.size === 0) return;

        // ── 3. Apply per-course cooldown ───────────────────────
        const stored = { [ACTIVE_INDEX_KEY]: await store.get(keys.activeIndex) };
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
        const courses = toIndex.slice(0, MAX_COURSES_PER_RUN).map(([href, title]) => ({ href, title }));
        await crawlCourses('upcoming', courses, cooldowns, TAG);
    } catch (err) {
        console.warn('[OPAL ActiveIndex] Unexpected error:', err);
    }
}

/**
 * Index all favorite courses — used when the user manually presses
 * the refresh button. Unlike indexUpcomingCourses, this ignores the calendar
 * and indexes every course in the provided map.
 */
export async function indexFavoriteCourses(
    favorites: Map<string, { href: string; title: string }>,
    force = false,
): Promise<void> {
    const TAG = '[OPAL ActiveIndex]';
    try {
        const settings = await loadActiveIndexSettings();
        if (!settings.enabled && !force) return;

        const stored = { [ACTIVE_INDEX_KEY]: await store.get(keys.activeIndex) };
        const cooldowns = stored[ACTIVE_INDEX_KEY] as Record<string, number>;

        const toIndex = [...favorites.values()].filter(
            c => force || Date.now() - (cooldowns[c.href] ?? 0) > ACTIVE_COOLDOWN_MS
        );

        if (toIndex.length === 0) {
            console.log(`${TAG} All favorite courses are fresh — skipping`);
            return;
        }

        console.log(`${TAG} Indexing ${toIndex.length} favorite course(s)…`);

        await crawlCourses('favorites', toIndex, cooldowns, TAG);
        await store.set(keys.favoriteFingerprint, [...favorites.values()].map(c => extractCourseIdFromUrl(c.href)).sort());
    } catch (err) {
        console.warn('[OPAL ActiveIndex] Unexpected error:', err);
    }
}

/** Crawls courses one after another and publishes progress for every tab. */
async function crawlCourses(
    kind: 'favorites' | 'upcoming',
    courses: { href: string; title: string }[],
    cooldowns: Record<string, number>,
    TAG: string,
): Promise<void> {
    // The automatic run (upcoming) is capped by its caller; a refresh the user asked for covers every favourite.
    const progress = startProgress(kind, courses.length);
    try {
        for (const course of courses) {
            if (!isSafeCourseLink(course.href, course.href)) continue;
            progress.startCourse(course.title);
            try {
                console.log(`${TAG}   "${course.title}"`);
                const id = courseIdFromUrl(course.href);
                if (!id) continue;
                const snapshot = await loadCourseInBackground(id);
                const nodes = snapshotIndexNodes(snapshot);
                for (const node of nodes) await upsertNode(node);
                progress.addItems(nodes.length);
                cooldowns[course.href] = Date.now();
                await store.set(keys.activeIndex, cooldowns);
            } catch (e) {
                console.warn(`${TAG}   Error on "${course.title}":`, e);
            }
            progress.courseDone();
            await new Promise(r => setTimeout(r, 500));
        }
        console.log(`${TAG} Done`);
    } finally {
        await flushUpserts();
        await progress.finish();
    }
}

/**
 * Find CourseNode / folder links within a course landing page.
 * Only links whose URL contains the same RepositoryEntry ID are included,
 * ensuring we stay within the current course.
 * Returns {url, title} pairs — title is the visible link text, used as the
 * folder node title when the section is stored in the index.
 *
 * Two passes are made:
 *  Pass 1 — regular href links (fast, always correct)
 *  Pass 2 — javascript: Wicket links whose encoded payload contains a
 *            CourseNode URL (covers the majority of OPAL course-menu entries)
 */
function findMaterialSectionLinks(doc: Document, courseUrl: string): { url: string; title: string }[] {
    const idMatch = courseUrl.match(/\/RepositoryEntry\/(\d+)/i);
    const repoId  = idMatch ? idMatch[1] : '';

    const origin = (() => { try { return new URL(courseUrl).origin; } catch { return ''; } })();
    const seen   = new Set<string>();
    const links: { url: string; title: string }[] = [];

    const addIfNew = (fullUrl: string, text: string) => {
        if (!isSafeCourseLink(fullUrl, courseUrl)) return;
        const stripped = fullUrl.split('?')[0].replace(/\/$/, '');
        if (seen.has(stripped)) return;
        seen.add(stripped);
        links.push({ url: fullUrl, title: text || stripped });
    };

    // ── Pass 1: regular href links ────────────────────────────────
    for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).slice(0, 1000)) {
        const raw = a.getAttribute('href') || '';
        if (!raw || raw.startsWith('javascript:')) continue;

        let full: string;
        try { full = new URL(raw, origin).href; } catch { continue; }

        if (repoId && !full.includes(repoId)) continue;
        if (full.replace(/\?.*/, '') === courseUrl.replace(/\?.*/, '')) continue;

        const lower = full.toLowerCase();
        const isSection =
            lower.includes('/folder/') ||
            lower.includes('/briefcase') ||
            lower.includes('coursenode');

        if (isSection) addIfNew(full, a.textContent?.trim() ?? '');
    }

    // ── Pass 2: javascript: Wicket links ─────────────────────────
    // OPAL's course navigation menu items use href="javascript:…" where the
    // actual CourseNode URL is percent-encoded inside the string.
    // Example: javascript:o_main.next('…%2FCourseNode%2F12345…')
    // We decode the href value and extract any RepositoryEntry/CourseNode path.
    if (repoId) {
        const courseNodeRe = new RegExp(
            `RepositoryEntry\\/${repoId}\\/CourseNode\\/(\\d+)`, 'i'
        );
        for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href^="javascript:"]'))) {
            const raw  = a.getAttribute('href') || '';
            const text = a.textContent?.trim() ?? '';
            if (!text || text.length < 2) continue;

            // Decode percent-encoding, then look for the CourseNode path
            let decoded: string;
            try { decoded = decodeURIComponent(raw); } catch { decoded = raw; }

            const m = courseNodeRe.exec(decoded);
            if (!m) continue;

            const nodeId  = m[1];
            const fullUrl = `${origin}/opal/auth/RepositoryEntry/${repoId}/CourseNode/${nodeId}`;
            addIfNew(fullUrl, text);
        }
    }

    // Some OPAL themes store CourseNode targets in onclick/data-* attributes
    // rather than href. Parse the raw markup so those hidden links are indexed too.
    for (const link of extractCourseNodeLinksFromMarkup(doc.documentElement.outerHTML, courseUrl)) {
        addIfNew(link.url, link.title);
    }

    return links;
}

function collectPageDeadlines(doc: Document, pageUrl: string, courseTitle?: string): void {
    try { collectDeadlinesFromDoc(doc, { courseId: extractCourseIdFromUrl(pageUrl), courseTitle, pageUrl, pageTitle: doc.title }); }
    catch (err) { console.warn('[OPAL] Deadline collection failed:', err); }
}
export async function refreshFavoriteIndex(): Promise<void> {
    const data = { opalFavoriteSnapshot: await store.get(keys.favoriteSnapshot) };
    const courses = data.opalFavoriteSnapshot as { href: string; title: string }[];
    await indexFavoriteCourses(new Map(courses.map(c => [extractCourseIdFromUrl(c.href), c])), true);
}
