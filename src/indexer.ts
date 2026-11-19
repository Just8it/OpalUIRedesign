import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
import { loadCourseInBackground, courseIdFromUrl } from './course/loader.ts';
import { snapshotIndexNodes } from './course/index-nodes.ts';
import { OpalError } from './opal/gateway.ts';
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
import { startProgress } from './core/index-progress';
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
            // Switching preloading off stops a run in progress before the next course.
            if (kind === 'upcoming' && !(await store.get(keys.preload)).enabled) break;
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
                // OPAL is unreachable, busy or the session ended: stop instead of asking for the remaining courses.
                if (e instanceof OpalError) break;
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
