import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
import { formatDate, initLocale, localeTag } from './i18n/index.ts';
import { t } from './i18n/messages/pages.ts';

const localeReady = initLocale();

import { installFileOpening } from './core/file-opening';
installFileOpening(async url => {
    const idx = await ensureLoaded();
    const node = idx.get(url) ?? idx.get(new URL(url).pathname);
    return node?.parentId ? idx.get(node.parentId) : undefined;
});
import { installOpalCoordinator } from './opal/background';
installOpalCoordinator();
import { installCustomizeRequests } from './customize-requests';
installCustomizeRequests();
import { createClaims, isClaimMessage } from './core/claims';
const claim = createClaims();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!isClaimMessage(message) || sender.id !== chrome.runtime.id || !sender.tab) return false;
    respond({ granted: claim(message) });
    return false;
});
/* ━━ Background: owner of the search index ━━━━━━━━━━━━━━━━━━━━━
 * Holds the Dexie database (extension origin) and one in-memory
 * SearchIndex built from it, and answers the runtime messages defined
 * in core/index-messages.ts.
 *
 * Chrome runs this as an MV3 service worker that may be stopped after
 * a short idle time, Firefox as a non-persistent event page. Module
 * state can therefore vanish between any two messages: every handler
 * awaits ensureLoaded(), which rebuilds the index from Dexie on demand.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { db } from './core/index-db';
import { createSearchIndex } from './core/search/engine';
import type { IndexNode, SearchIndex, SearchResult } from './core/search/types';
import {
    INDEX_CHANNEL,
    isOpalUrl,
    type IndexEnvelope,
    type IndexNodeInput,
    type IndexReply,
    type IndexRequest,
    type IndexStats,
} from './core/index-messages';

/* ── Loading ───────────────────────────────────────────────────── */

let index: SearchIndex | null = null;
let loading: Promise<SearchIndex> | null = null;

function ensureLoaded(): Promise<SearchIndex> {
    if (index) return Promise.resolve(index);
    if (!loading) {
        loading = (async () => {
            // Prune before building so the index never holds stale nodes and no
            // write can interleave with the prune (all handlers wait for this).
            await pruneIfDue().catch(err => console.warn('[OPAL Index] Prune failed:', err));
            const all = await db.nodes.toArray();
            const idx = createSearchIndex();
            idx.setAll(all.filter(n => sanitize(n)));
            index = idx;
            return idx;
        })().catch(err => {
            loading = null;
            throw err;
        });
    }
    return loading;
}

/* ── Validation ────────────────────────────────────────────────── */

const NODE_TYPES = new Set<IndexNode['type']>(['course', 'folder', 'file', 'action']);
const OPTIONAL_TEXT: Record<string, number> = {
    fileExtension: 16,
    searchText: 2000,
    description: 2000,
    author: 300,
    institution: 300,
    semester: 100,
    courseType: 100,
};

function text(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function timestamp(value: unknown, now: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
    return Math.min(value, now + 86_400_000);
}

/** Copies the known fields of an untrusted node. Returns null unless the
 *  id and url point into OPAL. Undefined optionals are left out, so a
 *  merge never erases metadata another indexer stored. */
export function sanitize(raw: unknown): IndexNodeInput | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = text(r.id, 2048);
    const title = text(r.title, 500).replace(/\s+/g, ' ');
    const url = text(r.url, 4096);
    const type = r.type as IndexNode['type'];
    const https = (value: string) => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
    const external = type === 'file' && isOpalUrl(text(r.courseId, 2048)) && https(id) && https(url) && id === url;
    if (!id || !title || !(isOpalUrl(id) && isOpalUrl(url) || external) || !NODE_TYPES.has(type)) return null;

    const node: IndexNodeInput = {
        id,
        title,
        url,
        type,
        courseId: text(r.courseId, 2048),
        parentId: text(r.parentId, 2048) || null,
    };
    if (r.source === 'user' || r.source === 'catalog') node.source = r.source;
    const bag = node as unknown as Record<string, unknown>;
    for (const [key, max] of Object.entries(OPTIONAL_TEXT)) {
        const v = text(r[key], max);
        if (v) bag[key] = v;
    }
    if (['lecture', 'exercise', 'solution', 'exam', 'video', 'other'].includes(String(r.category))) node.category = r.category as IndexNode['category'];
    if (typeof r.itemNumber === 'string' && /^\d+(?:\.\d+)*$/.test(r.itemNumber) && r.itemNumber.length <= 40) node.itemNumber = r.itemNumber;
    if (typeof r.modified === 'number' && Number.isFinite(r.modified) && r.modified >= 0) node.modified = timestamp(r.modified, Date.now());
    if (typeof r.solutionUrl === 'string' && r.solutionUrl.length <= 4096 && https(r.solutionUrl)) node.solutionUrl = r.solutionUrl;
    return node;
}

/* ── Merging ───────────────────────────────────────────────────── */

/** Indexing path: refreshes metadata, never touches visit fields. */
function mergeIndexed(existing: IndexNode | undefined, clean: IndexNodeInput, now: number): IndexNode {
    if (!existing) {
        return { ...clean, visitCount: 0, lastVisited: 0, indexedAt: now, firstSeenAt: now };
    }
    return {
        ...existing,
        ...clean,
        visitCount: existing.visitCount || 0,
        lastVisited: existing.lastVisited || 0,
        indexedAt: now,
        firstSeenAt: existing.firstSeenAt ?? existing.indexedAt ?? now,
        // Once the user opened a node it stays a user node.
        source: existing.source === 'user' ? 'user' : (clean.source ?? existing.source),
    };
}

/** Import path: the imported visit data only wins when it is larger. */
function mergeImported(existing: IndexNode | undefined, clean: IndexNodeInput, raw: Record<string, unknown>, now: number): IndexNode {
    const visitCount = Math.min(Math.floor(timestamp(raw.visitCount, Number.MAX_SAFE_INTEGER)), 1_000_000);
    const lastVisited = timestamp(raw.lastVisited, now);
    const indexedAt = timestamp(raw.indexedAt, now);
    if (!existing) return { ...clean, visitCount, lastVisited, indexedAt, firstSeenAt: indexedAt };
    return {
        ...clean,
        ...existing,
        visitCount: Math.max(existing.visitCount || 0, visitCount),
        lastVisited: Math.max(existing.lastVisited || 0, lastVisited),
        indexedAt: Math.max(existing.indexedAt || 0, indexedAt),
    };
}

/* ── Pruning ───────────────────────────────────────────────────── */


const DAY_MS = 86_400_000;
const TTL_USER = 120 * DAY_MS;
const TTL_CATALOG = 365 * DAY_MS;
const MAX_USER = 3000;

function nodeAge(n: IndexNode): number {
    return Math.max(n.lastVisited || 0, n.indexedAt || 0);
}

/** Runs at most once a day, only while the index is being (re)built. */
async function pruneIfDue(): Promise<void> {
    const now = Date.now();
    const last = await store.get(keys.prunedAt);
    if (last && now - last < DAY_MS && last <= now) return;

    const all = await db.nodes.toArray();
    const toDelete = new Set<string>();
    for (const n of all) {
        // Wicket version counters (?32), broken course ids and foreign urls
        if (/\?\d+$/.test(n.id) || n.courseId === ';' || !n.courseId || !sanitize(n)) {
            toDelete.add(n.id);
            continue;
        }
        const ttl = n.source === 'catalog' ? TTL_CATALOG : TTL_USER;
        const age = nodeAge(n);
        if (age && now - age > ttl) toDelete.add(n.id);
    }

    const userNodes = all.filter(n => n.source !== 'catalog' && !toDelete.has(n.id));
    if (userNodes.length > MAX_USER) {
        userNodes.sort((a, b) => nodeAge(a) - nodeAge(b));
        for (const n of userNodes.slice(0, userNodes.length - MAX_USER)) toDelete.add(n.id);
    }

    if (toDelete.size > 0) {
        await db.nodes.bulkDelete([...toDelete]);
        console.log(`[OPAL Index] Pruned ${toDelete.size} stale entries`);
    }
    await store.set(keys.prunedAt, now);
}

/* ── Handlers ──────────────────────────────────────────────────── */

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback;

/** Runs mutations one after another: each merge reads memory, then writes
 *  the database, then memory, and two of those must not interleave. */
let mutations: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = mutations.then(fn, fn);
    mutations = run.catch(() => undefined);
    return run;
}

async function writeMany(nodes: unknown[], mode: 'index' | 'import'): Promise<{ written: number; rejected: number }> {
    const idx = await ensureLoaded();
    const now = Date.now();
    const batch = new Map<string, IndexNode>();
    let rejected = 0;
    for (const raw of nodes.slice(0, 5000)) {
        const clean = sanitize(raw);
        if (!clean) { rejected++; continue; }
        // A later duplicate in the same batch builds on the earlier one.
        const existing = batch.get(clean.id) ?? idx.get(clean.id);
        const merged = mode === 'index'
            ? mergeIndexed(existing, clean, now)
            : mergeImported(existing, clean, raw as Record<string, unknown>, now);
        batch.set(clean.id, merged);
    }
    if (batch.size === 0) return { written: 0, rejected };

    // Store first: if the write fails (quota), memory must not show entries
    // that are gone after the next worker start. Mutations run one at a time
    // (see serial), so nothing reads a half-applied batch.
    await db.nodes.bulkPut([...batch.values()]);
    for (const n of batch.values()) idx.upsert(n);
    return { written: batch.size, rejected };
}

async function recordVisit(id: unknown, rawNode: unknown): Promise<boolean> {
    if (typeof id !== 'string' || !id) return false;
    const idx = await ensureLoaded();
    const now = Date.now();
    let existing = idx.get(id);
    if (!existing && rawNode) {
        const clean = sanitize(rawNode);
        if (clean && clean.id === id) existing = mergeIndexed(undefined, clean, now);
    }
    if (!existing) return false;
    const updated: IndexNode = {
        ...existing,
        visitCount: (existing.visitCount || 0) + 1,
        lastVisited: now,
        source: 'user',
    };
    await db.nodes.put(updated);
    idx.upsert(updated);
    return true;
}

/** A course's first crawl makes every file look new. Files only count when
 *  they showed up at least this long after the course's first indexed content. */
const NEW_FILE_GRACE_MS = 12 * 60 * 60 * 1000;

async function newFiles(maxAgeDays: number, limit: number): Promise<SearchResult[]> {
    const idx = await ensureLoaded();
    const all = await db.nodes.toArray();
    const baseline = new Map<string, number>();
    for (const n of all) {
        if (n.type !== 'file' && n.type !== 'folder') continue;
        const seen = n.firstSeenAt ?? n.indexedAt ?? 0;
        if (!seen) continue;
        const known = baseline.get(n.courseId);
        if (known === undefined || seen < known) baseline.set(n.courseId, seen);
    }
    const cutoff = Date.now() - maxAgeDays * DAY_MS;
    const fresh = all.filter(n => {
        if (n.type !== 'file' || (n.visitCount || 0) > 0) return false;
        const seen = n.firstSeenAt ?? 0;
        const base = baseline.get(n.courseId);
        return seen >= cutoff && base !== undefined && seen > base + NEW_FILE_GRACE_MS;
    });
    fresh.sort((a, b) => (b.firstSeenAt || 0) - (a.firstSeenAt || 0));
    return fresh.slice(0, limit).map(node => {
        // Ancestor titles, root first; cycle-safe.
        const path: string[] = [];
        const seen = new Set([node.id]);
        let parent = node.parentId ? idx.get(node.parentId) : undefined;
        while (parent && !seen.has(parent.id)) {
            seen.add(parent.id);
            path.unshift(parent.title);
            parent = parent.parentId ? idx.get(parent.parentId) : undefined;
        }
        const course = idx.get(node.courseId);
        if (course && !seen.has(course.id)) path.unshift(course.title);
        const time = formatDate(node.firstSeenAt || 0, { dateStyle: 'medium', timeStyle: 'short' });
        return { node, score: node.firstSeenAt || 0, path, explanation: [t('backgroundFirstSeen', { time })] };
    });
}

async function stats(): Promise<IndexStats> {
    await ensureLoaded();
    const [total, courses, folders, files, newestIndexed, newestVisited] = await Promise.all([
        db.nodes.count(),
        db.nodes.where('type').equals('course').count(),
        db.nodes.where('type').equals('folder').count(),
        db.nodes.where('type').equals('file').count(),
        db.nodes.orderBy('indexedAt').last(),
        db.nodes.orderBy('lastVisited').last(),
    ]);
    return {
        total,
        courses,
        folders,
        files,
        lastIndexed: Math.max(newestIndexed?.indexedAt || 0, newestVisited?.lastVisited || 0),
    };
}

async function handle(req: IndexRequest): Promise<unknown> {
    switch (req.op) {
        case 'search': {
            const idx = await ensureLoaded();
            if (typeof req.query !== 'string') return [];
            const opts = req.options ?? {};
            return idx.search(req.query.slice(0, 200), {
                activeCourseId: typeof opts.activeCourseId === 'string' ? opts.activeCourseId : undefined,
                courseId: typeof opts.courseId === 'string' ? opts.courseId : undefined,
                excludeCatalog: opts.excludeCatalog === true,
                limit: clamp(opts.limit, 1, 50, 8),
            });
        }
        case 'recents': {
            const idx = await ensureLoaded();
            return idx.recents(clamp(req.limit, 1, 30, 8));
        }
        case 'upsertMany':
            return serial(() => writeMany(Array.isArray(req.nodes) ? req.nodes : [], 'index'));
        case 'importMany':
            return serial(() => writeMany(Array.isArray(req.nodes) ? req.nodes : [], 'import'));
        case 'recordVisit':
            return serial(() => recordVisit(req.id, req.node));
        case 'get': {
            const idx = await ensureLoaded();
            return typeof req.id === 'string' ? idx.get(req.id) ?? null : null;
        }
        case 'getMany': {
            const idx = await ensureLoaded();
            const ids = Array.isArray(req.ids) ? req.ids.slice(0, 500) : [];
            return ids.map(id => (typeof id === 'string' ? idx.get(id) ?? null : null));
        }
        case 'byCourse': {
            await ensureLoaded();
            if (typeof req.courseId !== 'string' || !req.courseId) return [];
            const wanted = req.nodeType && NODE_TYPES.has(req.nodeType) ? req.nodeType : null;
            const nodes = await db.nodes
                .where('courseId').equals(req.courseId)
                .filter(n => !wanted || n.type === wanted)
                .toArray();
            nodes.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0)
                || a.title.localeCompare(b.title, localeTag(), { numeric: true }));
            return nodes.slice(0, clamp(req.limit, 1, 500, 200));
        }
        case 'newFiles':
            return newFiles(clamp(req.maxAgeDays, 1, 60, 14), clamp(req.limit, 1, 50, 12));
        case 'stats':
            return stats();
        case 'exportNodes':
            return db.nodes.toArray();
        case 'clear':
            return serial(async () => {
                const idx = await ensureLoaded();
                await db.nodes.clear();
                idx.clear();
                return true;
            });
        default:
            throw new Error('Unknown index op');
    }
}

/* ── Wiring ────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    const envelope = msg as IndexEnvelope | null;
    if (!envelope || typeof envelope !== 'object' || envelope.channel !== INDEX_CHANNEL) return false;
    // Only our own content scripts and extension pages may touch the index.
    if (sender.id !== chrome.runtime.id) return false;

    localeReady.then(() => handle(envelope)).then(
        data => sendResponse({ ok: true, data } satisfies IndexReply<unknown>),
        err => {
            console.warn('[OPAL Index] Request failed:', envelope.op, err);
            sendResponse({ ok: false, error: t('backgroundIndexFailed') } satisfies IndexReply<unknown>);
        },
    );
    // Keep the channel open for the async reply (works in Chrome and Firefox).
    return true;
});

chrome.commands.onCommand.addListener(command => {
    if (command !== 'opal-search') return;
    const fallback = () => { chrome.windows.create({ url: chrome.runtime.getURL('popup/popup.html'), type: 'popup', width: 440, height: 600 }); };
    const popup = () => {
        try {
            if (!chrome.action.openPopup) { fallback(); return; }
            Promise.resolve(chrome.action.openPopup()).catch(fallback);
        } catch { fallback(); }
    };
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs[0];
        if (tab?.id !== undefined && isOpalUrl(tab.url)) {
            chrome.tabs.sendMessage(tab.id, { channel: 'opal-command', op: 'open' }, () => {
                if (chrome.runtime.lastError) popup();
            });
        } else popup();
    });
});

// Content scripts may not expose openOptionsPage; the background always does.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'opal-open-options') return;
    try {
        chrome.runtime.openOptionsPage(() => {
            const error = chrome.runtime.lastError;
            sendResponse({ ok: !error });
        });
    } catch {
        sendResponse({ ok: false });
    }
    return true;
});
