import { courseMessages, t } from '../i18n/messages/course.ts';
import { store } from '../storage/store.ts';
import { keys, families } from '../storage/registry.ts';
import { storageAdmin } from '../storage/admin.ts';
import { snapshotIndexNodes } from './index-nodes.ts';
import { collectDeadlinesFromDoc } from '../core/deadline-collector.ts';
import { opal, OpalError } from '../opal/gateway.ts';
import type { CourseEntry, CourseLoadHandle, CourseLoadState, CourseSection, CourseSectionIssue, CourseSnapshot } from './types.ts';
import { buildSections, extractTree } from './tree.ts';
import { nextPageUrl, parseAnnouncements, parseFolder, parseFrameUrl, parseLinks, parseLiterature, plainText, safeFetchUrl, sanitizePage } from './parsers.ts';

/* v2: snapshots written before subfolders were followed correctly are dropped. */
const OLD_PREFIX = 'opalCourseSnapshot_';
/* OPAL keeps one "current node" per session, so course requests must not
   overlap: sections load one after another. Limits keep a huge course from
   turning into hundreds of requests. */
const REQUEST_GAP_MS = 80;
const MAX_REQUESTS = 400;
const MAX_FOLDER_DEPTH = 8;
const MAX_FOLDER_PAGES = 250;
const MAX_TABLE_PAGES = 25;
/** A load interrupted by a page reload continues from its stored sections for this long. */
const RESUME_MS = 30 * 60 * 1000;
/** How often a running load stores its progress. */
const SAVE_EVERY_MS = 1500;

/** Sections a partial snapshot already finished, by node and address, so a reload
 *  continues the load instead of starting over (and never finishing). */
export function resumableSections(previous: CourseSnapshot | undefined, now: number, maxAge = RESUME_MS): Map<string, CourseSnapshot['sections'][number]> {
    if (!previous?.partial || now - (previous.partialAt ?? 0) > maxAge) return new Map();
    return new Map(previous.sections.filter(s => s.state !== 'pending' && s.state !== 'error' && !s.incomplete).map(s => [`${s.nodeId}|${s.url}`, s]));
}
export const LOGIN_ERROR = 'course-login-required';
const isLoginError = (error: unknown): boolean => error instanceof OpalError && error.code === 'session' || error instanceof Error && error.message === LOGIN_ERROR;

export function loadErrorMessage(error: string): string {
    return error === LOGIN_ERROR ? t('loadLoginError') : error;
}
/** Keep the session failure code until the caller displays a message. */
function loadErrorText(error: unknown): string {
    if (isLoginError(error)) return LOGIN_ERROR;
    if (error instanceof OpalError) {
        if (error.code === 'unavailable') return t('loadUnavailable');
        if (error.code === 'timeout') return t('loadTimeout');
    }
    // The technical reason stays visible (small, after the advice): without it a failure on a
    // real course cannot be told apart from another one.
    const reason = error instanceof OpalError ? `${error.code}: ${error.message}` : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return t('loadCourseError', { reason: reason.slice(0, 160) });
}
/** The previous run's copy of a section, when that run finished it. */
export function keptSection(previous: CourseSnapshot | undefined, nodeId: string): CourseSection | undefined {
    return previous?.sections.find(s => s.nodeId === nodeId && (s.state === 'loaded' || s.state === 'empty' || s.state === 'native'));
}
export function staleSnapshot(previous: CourseSnapshot | undefined, error: unknown): CourseSnapshot | undefined {
    return isLoginError(error) ? undefined : previous;
}
let storageQueue: Promise<unknown> = Promise.resolve();

export function courseIdFromUrl(url: string): string | null {
    try { const u = new URL(url); return safeFetchUrl(url) ? /\/RepositoryEntry\/(\d+)(?:\/|$)/.exec(u.pathname)?.[1] ?? null : null; } catch { return null; }
}
export async function isCourseViewEnabled(): Promise<boolean> {
    return await store.get(keys.courseView);
}
export async function setCourseViewEnabled(on: boolean): Promise<void> {
    await store.set(keys.courseView, on);
}

/** `sectionId`: when the previous snapshot never finished this section (an interrupted
 *  load), "not seen before" only means "not looked at", so only the change date counts. */
export function markChanges(entries: CourseEntry[], previous: CourseSnapshot | undefined, previousVisit: number, now: number, sectionId?: string): CourseEntry[] {
    const seen = new Map(previous?.sections.flatMap(s => s.entries.map(e => [e.url, e.firstSeen] as const)) ?? []);
    const before = sectionId === undefined ? undefined : previous?.sections.find(s => s.nodeId === sectionId);
    const looked = sectionId === undefined || (!!before && before.state !== 'pending' && before.state !== 'error');
    return entries.map(e => {
        const known = seen.get(e.url);
        const firstSeen = known ?? (looked ? now : Math.min(now, e.modified ?? now));
        const added = known === undefined ? looked && firstSeen > previousVisit : firstSeen > previousVisit;
        return { ...e, firstSeen, isNew: previousVisit > 0 && (added || (e.modified ?? 0) > previousVisit) };
    });
}

export function trimCache(index: Record<string, number>): string[] {
    return Object.keys(index).sort((a, b) => index[b] - index[a]).slice(15);
}

function stored<T>(work: () => Promise<T>): Promise<T> {
    const result = storageQueue.then(work, work);
    storageQueue = result.catch(() => undefined);
    return result;
}

async function indexFiles(snapshot: CourseSnapshot): Promise<void> {
    const { upsertNode } = await import('../core/search-engine');
    for (const node of snapshotIndexNodes(snapshot)) await upsertNode(node);
}
interface LoadOptions { background?: boolean; maxRequests?: number }
class RequestBudget extends Error {}
/** Refreshes the view cache without recording a visit; each fetch yields to user work. */
export function loadCourseInBackground(courseId: string, opts: { maxRequests?: number } = {}): Promise<CourseSnapshot> {
    return new Promise((resolve, reject) => {
        loadCourse(courseId, (snapshot, state) => {
            if (state.phase === 'done') resolve(snapshot);
            if (state.phase === 'error') reject(new Error(loadErrorMessage(state.error ?? '')));
        }, { ...opts, background: true });
    });
}

export function loadCourse(courseId: string, onUpdate: (snapshot: CourseSnapshot, state: CourseLoadState) => void, options: LoadOptions = {}): CourseLoadHandle {
    let cancelled = false;
    let controller = new AbortController();
    let generation = 0;
    const openedAt = Date.now();
    const url = `https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/${courseId}`;
    let previous: CourseSnapshot | undefined;
    let previousVisit = 0;
    const ready = stored(async () => {
        const [cached, visits] = await Promise.all([store.get(families.snapshot(courseId)), store.get(keys.snapshotIndex)]);
        previous = cached;
        void storageAdmin.readAll().then(all => {
            const old = Object.keys(all).filter(key => key.startsWith(OLD_PREFIX));
            return old.length ? storageAdmin.remove(old) : undefined;
        }).catch(() => undefined);
        const index = visits;
        previousVisit = index[courseId] ?? 0;
        if (options.background) return;
        // An interrupted load is the same visit: keep the visit before it, or "Neu" would be lost.
        if (resumableSections(previous, openedAt).size) previousVisit = previous?.previousVisit ?? previousVisit;
        index[courseId] = openedAt;
        const dropped = trimCache(index);
        for (const key of dropped) delete index[key];
        await store.set(keys.snapshotIndex, index);
        if (dropped.length) await storageAdmin.remove(dropped.map(id => families.snapshot(id).name));
    }).catch(() => undefined);

    async function run(force: boolean) {
        const current = ++generation;
        controller.abort();
        controller = new AbortController();
        const signal = controller.signal;
        const active = () => !cancelled && generation === current;
        await ready;
        if (!active()) return;
        let lastUpdate = 0;
        let snapshot: CourseSnapshot = { courseId, title: t('course'), url, tree: { id: courseId, title: t('course'), kind: 'root', rawType: 'root', url, children: [] }, sections: [], announcements: [], fetchedAt: 0, previousVisit };
        const emit = (phase: CourseLoadState['phase'], error?: string) => {
            if (!active()) return;
            lastUpdate = Date.now();
            onUpdate(structuredClone(snapshot), { phase, loaded: snapshot.sections.filter(s => s.state !== 'pending').length, total: snapshot.sections.length, error });
        };
        if (previous && !force) {
            snapshot = structuredClone(previous);
            snapshot.previousVisit = previousVisit;
            for (const s of snapshot.sections) s.entries = markChanges(s.entries, previous, previousVisit, openedAt, s.nodeId);
            emit('cache');
            if (!previous.partial && !previous.sections.some(s => s.state === 'error' || s.state === 'pending' || s.incomplete)
                && Date.now() - previous.fetchedAt < 600000) { emit('done'); return; }
        }
        let requests = 0, folderPages = 0, nextRequest = 0;
        /** `vetted`: the address is a Wicket link that a parser accepted on purpose (the folder pager). */
        async function getPage(target: string, vetted = false): Promise<{ text: string; url: string }> {
            if (!active() || !(vetted || safeFetchUrl(target)) || requests >= (options.maxRequests ?? (options.background ? 40 : MAX_REQUESTS))) throw new RequestBudget(t('loadBudgetOrLink'));
            requests++;
            const wait = Math.max(0, nextRequest - Date.now());
            nextRequest = Math.max(Date.now(), nextRequest) + (options.background ? 250 : REQUEST_GAP_MS);
            await new Promise(resolve => setTimeout(resolve, wait));
            signal.throwIfAborted();
            // OPAL answers course urls with a redirect that only appends its page
            // counter ("?4"), so redirects are followed and the final address is
            // checked instead: outside OPAL or on the login page means not signed in.
            const response = await opal.fetchHtml(target, { priority: options.background ? 'background' : 'user', stateful: true, signal, redirect: 'follow' });
            if ((response.url && (!safeFetchUrl(response.url) || /\/opal\/(?:login|shiblogin)/.test(response.url)))) throw new Error(LOGIN_ERROR);
            // The final address (with OPAL's page counter) travels with the text: two
            // sections load at once, so it must not live in shared state.
            collect(response.text, target);
            return { text: response.text, url: response.url || target };
        }
        function collect(html: string, pageUrl: string) {
            if (typeof DOMParser === 'undefined') return;
            const doc = new DOMParser().parseFromString(html, 'text/html');
            collectDeadlinesFromDoc(doc, { courseId: new URL(url).pathname, courseTitle: snapshot.title, pageUrl, pageTitle: doc.title || snapshot.sections.find(s => s.url === pageUrl)?.title || snapshot.title });
        }
        const get = async (target: string): Promise<string> => (await getPage(target)).text;
        /** Opens a subfolder the way a click does. `clickUrl` comes from
         *  folderClickUrls(), which only accepts the row link of this node. */
        async function click(clickUrl: string, pageUrl: string): Promise<string> {
            if (!active() || requests >= (options.maxRequests ?? (options.background ? 40 : MAX_REQUESTS))) throw new RequestBudget(t('folderBudget'));
            requests++;
            const wait = Math.max(0, nextRequest - Date.now());
            nextRequest = Math.max(Date.now(), nextRequest) + (options.background ? 250 : REQUEST_GAP_MS);
            await new Promise(resolve => setTimeout(resolve, wait));
            signal.throwIfAborted();
            const page = new URL(pageUrl);
            const response = await opal.fetchHtml(clickUrl, { priority: options.background ? 'background' : 'user', stateful: true,
                signal, redirect: 'error',
                headers: {
                    'Wicket-Ajax': 'true',
                    'Wicket-Ajax-BaseURL': (page.pathname + page.search).replace(/^\/opal\//, ''),
                    'X-Requested-With': 'XMLHttpRequest',
                    Accept: 'application/xml, text/xml, */*; q=0.01',
                },
            });
            collect(response.text, pageUrl.replace(/\?\d+$/, ''));
            return response.text;
        }
        const leave = () => {
            if (!active()) return;
            cancelled = true; generation++; controller.abort();
        };
        if (typeof window !== 'undefined') window.addEventListener('pagehide', leave, { once: true });
        try {
            if (!/^\d+$/.test(courseId)) throw new Error(LOGIN_ERROR);
            const html = await get(url);
            const tree = extractTree(html);
            const sections = buildSections(tree);
            // A course start page that shows the lecturer's own page becomes "Kursinfo", first in the course
            // content. Its frame address is already known here, so the start page is not fetched twice.
            const introFrame = parseFrameUrl(html, url);
            if (introFrame) sections.unshift({ nodeId: tree.id, title: courseMessages.de.courseInfo, kind: 'page', rawType: 'root', path: [], url, state: 'pending', entries: [], frameUrl: introFrame });
            // Continue an interrupted load: finished sections come back from the partial snapshot.
            const resumed = force ? new Map() : resumableSections(previous, Date.now(), options.background ? 24 * 60 * 60 * 1000 : RESUME_MS);
            for (const [i, s] of sections.entries()) {
                const done = resumed.get(`${s.nodeId}|${s.url}`);
                if (done && s.state === 'pending' && done.kind === s.kind) sections[i] = structuredClone(done);
            }
            const announcementsDone = sections.some(s => s.kind === 'announcements' && s.state !== 'pending');
            snapshot = { courseId, title: tree.title, semester: plainText(html).match(/(?:Wintersemester|Sommersemester)\s+\d{4}(?:\s*\/\s*\d{4})?/)?.[0], url, tree, sections, announcements: announcementsDone && previous ? structuredClone(previous.announcements) : [], fetchedAt: 0, previousVisit };
            emit('loading');
            // Store progress while loading, so a reload of the page in between loses nothing.
            let lastSave = Date.now();
            const savePartial = () => {
                lastSave = Date.now();
                const copy: CourseSnapshot = { ...structuredClone(snapshot), partial: true, partialAt: lastSave, fetchedAt: 0 };
                void stored(async () => {
                    if (!active() || previous) return;
                    const index = await store.get(keys.snapshotIndex);
                    if (options.background || index[courseId]) await store.set(families.snapshot(courseId), copy);
                }).catch(() => undefined);
            };
            let cursor = 0;
            async function worker() {
                while (active() && cursor < snapshot.sections.length) {
                    const section = snapshot.sections[cursor++];
                    if (section.state !== 'pending') {
                        // Task/test/calendar bodies still carry deadlines even though the view leaves them native.
                        if (options.background && (section.kind === 'interactive' || section.kind === 'calendar')) await get(section.url);
                        continue;
                    }
                    try {
                        const html = section.kind === 'folder' || (section.kind === 'page' && section.frameUrl) ? undefined : await get(section.url);
                        if (section.kind === 'folder') {
                            const seen = new Set<string>();
                            const partial = (issue: CourseSectionIssue) => { section.incomplete = true; section.error = issue; };
                            // OPAL keeps the open folder as state of ONE page instance, and reaching a
                            // folder means clicking down its path from a fresh page. The first child can
                            // be clicked straight from the listing we already have (`here`), which makes
                            // a deep chain cost one request per level instead of one chain per folder.
                            type Here = { listing: string; pageUrl: string };
                            async function folder(path: string[], here?: Here): Promise<void> {
                                const key = path.join('\u0000');
                                if (seen.has(key)) return;
                                if (path.length > MAX_FOLDER_DEPTH || folderPages >= MAX_FOLDER_PAGES) { partial({ kind: 'folderBudget' }); return; }
                                seen.add(key);
                                folderPages++;
                                let state = here;
                                if (!state) {
                                    const page = await getPage(section.url);
                                    let listing = page.text;
                                    for (const name of path) {
                                        const step = parseFolder(listing, section.url).folders.find(f => f.title === name);
                                        if (!step?.clickUrl) { partial({ kind: 'folderOpenInOpal', title: name }); return; }
                                        listing = await click(step.clickUrl, page.url);
                                    }
                                    state = { listing, pageUrl: page.url };
                                }
                                const parsed = parseFolder(state.listing, section.url, path);
                                section.entries.push(...parsed.entries);
                                if (path.length === 0 && parsed.canUpload) section.canUpload = true;
                                // Further table pages of this folder (20 rows each). Each answer is a
                                // fresh render, so the next link always comes from the latest page.
                                let nextPage = nextPageUrl(state.listing, section.url);
                                let paged = false;
                                for (let n = 0; nextPage && n < MAX_TABLE_PAGES; n++) {
                                    const more = await getPage(nextPage, true);
                                    const moreParsed = parseFolder(more.text, section.url, path);
                                    section.entries.push(...moreParsed.entries);
                                    // A subfolder that only shows up on a later page cannot be reached
                                    // from a fresh page 1; say so instead of silently skipping it.
                                    for (const late of moreParsed.folders) partial({ kind: 'folderOpenInOpal', title: late.title });
                                    nextPage = nextPageUrl(more.text, section.url);
                                    paged = true;
                                }
                                if (nextPage) partial({ kind: 'folderMorePages' });
                                for (const [i, child] of parsed.folders.entries()) {
                                    // Only the first child can reuse the open page: clicking it changes that
                                    // page's state. Paging changed it too, so then every child starts fresh.
                                    const next = i === 0 && !paged && child.clickUrl ? { listing: await click(child.clickUrl, state.pageUrl), pageUrl: state.pageUrl } : undefined;
                                    await folder([...path, child.title], next);
                                }
                            }
                            await folder([]);
                        } else if (section.kind === 'page') {
                            section.frameUrl ??= parseFrameUrl(html ?? '', section.url);
                            if (section.frameUrl) {
                                const frame = await get(section.frameUrl);
                                section.entries = parseLinks(frame, section.frameUrl);
                                section.summary = plainText(frame).slice(0, 600);
                                const page = sanitizePage(frame, section.frameUrl);
                                if (page.html) { section.html = page.html; section.htmlTruncated = page.truncated || undefined; }
                            } else if (section.rawType === 'file') section.state = 'native';
                            else section.summary = plainText(html ?? '').slice(0, 600);
                        } else if (section.kind === 'announcements') snapshot.announcements.push(...parseAnnouncements(html ?? '', section.url));
                        else if (section.kind === 'literature') section.entries = parseLiterature(html ?? '', section.url);
                        else if (section.kind === 'links') section.entries = parseLinks((html ?? '').match(/<ul\b[^>]*class=["'][^"']*list-group[\s\S]*?<\/ul>/i)?.[0] ?? '', section.url);
                        section.entries = markChanges(section.entries, previous, previousVisit, Date.now(), section.nodeId);
                        if (section.state !== 'native') section.state = section.entries.length || section.kind === 'announcements' || section.summary ? 'loaded' : 'empty';
                    } catch (error) {
                        // A lost session ends the load, and background work stops when OPAL asks for a pause.
                        // Anything else (one slow or odd page) only marks its own section.
                        if (error instanceof RequestBudget || signal.aborted || isLoginError(error)
                            || error instanceof OpalError && (['unavailable', 'timeout', 'backoff'].includes(error.code) || options.background)) throw error;
                        console.warn('[OPAL course] section failed', section.title, error);
                        // One odd page does not make the whole course stale: keep what this section
                        // showed last time, and only mark it as an error when there is nothing to keep.
                        const kept = keptSection(previous, section.nodeId);
                        if (kept) {
                            Object.assign(section, structuredClone(kept));
                            if (section.kind === 'announcements') snapshot.announcements.push(...structuredClone(previous?.announcements ?? []));
                        } else {
                            section.state = 'error';
                            section.error = { kind: 'sectionLoadError' };
                        }
                    }
                    if (Date.now() - lastUpdate >= 250) emit('loading');
                    if (Date.now() - lastSave >= SAVE_EVERY_MS) savePartial();
                }
            }
            // One at a time on purpose: parallel requests make OPAL answer folder
            // clicks with an empty listing (its course state is shared per session).
            try { await worker(); } catch (error) {
                if (options.background && error instanceof RequestBudget) {
                    const unfinished = snapshot.sections[cursor - 1];
                    if (unfinished) { unfinished.state = 'pending'; }
                    snapshot.partial = true; snapshot.partialAt = Date.now();
                } else throw error;
            }
            if (!active()) return;
            if (snapshot.sections.some(s => s.state === 'pending' || s.state === 'error' || s.incomplete)) {
                snapshot.partial = true;
                snapshot.partialAt = Date.now();
            }
            snapshot.fetchedAt = snapshot.partial ? 0 : Date.now();
            await stored(async () => {
                if (!active()) return;
                const index = await store.get(keys.snapshotIndex);
                if (options.background || index[courseId]) await store.set(families.snapshot(courseId), snapshot);
            }).catch(() => undefined);
            if (!active()) return;
            previous = structuredClone(snapshot);
            emit('done');
            if (!options.background) void indexFiles(snapshot).catch(() => undefined);
        } catch (error) {
            if (!active()) return;
            if (!signal.aborted) console.warn('[OPAL course] load failed', error);
            const stale = staleSnapshot(previous, error);
            if (stale) {
                snapshot = structuredClone(stale);
                onUpdate(snapshot, { phase: options.background ? 'error' : 'done', loaded: snapshot.sections.length, total: snapshot.sections.length, stale: true, error: loadErrorText(error) });
                return;
            }
            if (!previous && snapshot.sections.length) {
                snapshot.partial = true; snapshot.partialAt = Date.now(); snapshot.fetchedAt = 0;
                await stored(() => store.set(families.snapshot(courseId), snapshot)).catch(() => undefined);
            }
            emit('error', loadErrorText(error));
        } finally {
            if (typeof window !== 'undefined') window.removeEventListener('pagehide', leave);
        }
    }
    void run(false);
    return { cancel() { cancelled = true; generation++; controller.abort(); }, refresh() { if (!cancelled) void run(true); } };
}
