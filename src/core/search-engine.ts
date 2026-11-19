/* ━━ Search index client (content script) ━━━━━━━━━━━━━━━━━━━━━━
 * Thin async wrappers over runtime messages to the background script,
 * which owns the index (see src/background.ts). Nothing here touches
 * IndexedDB except the one-time legacy migration in index-migration.ts.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { IndexNode, SearchResult, SearchOptions } from './search/types';
import {
    INDEX_CHANNEL,
    type IndexNodeInput,
    type IndexReply,
    type IndexRequest,
    type IndexResponses,
    type IndexStats,
} from './index-messages';
import { migrateLegacyIndex } from './index-migration';

export type { IndexNode, SearchResult } from './search/types';
export type { IndexNodeInput, IndexStats } from './index-messages';

/* ── Transport ─────────────────────────────────────────────────── */

function sendOnce<T>(req: IndexRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        try {
            // Callback form: identical in Chrome and Firefox and reports a
            // missing receiver through lastError instead of an unhandled rejection.
            chrome.runtime.sendMessage({ ...req, channel: INDEX_CHANNEL }, (reply: IndexReply<T> | undefined) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) { reject(new Error(lastError.message)); return; }
                if (!reply) { reject(new Error('No reply from index')); return; }
                if (reply.ok) resolve(reply.data);
                else reject(new Error(reply.error));
            });
        } catch (err) {
            // Extension context invalidated (extension reloaded under the tab)
            reject(err);
        }
    });
}

/** One retry covers a service worker that was just starting up. */
async function send<R extends IndexRequest>(req: R): Promise<IndexResponses[R['op']]> {
    try {
        return await sendOnce<IndexResponses[R['op']]>(req);
    } catch (err) {
        // recordVisit is not idempotent; a lost reply must not count twice.
        if (!chrome.runtime?.id || req.op === 'recordVisit') throw err;
        await new Promise(r => setTimeout(r, 150));
        return sendOnce<IndexResponses[R['op']]>(req);
    }
}

/* ── Startup ───────────────────────────────────────────────────── */

let initPromise: Promise<void> | null = null;

/** Runs the one-time migration of the old page-origin database. Safe to
 *  call repeatedly; the background loads its index lazily on its own. */
export function initSearchEngine(): Promise<void> {
    if (!initPromise) {
        initPromise = migrateLegacyIndex(nodes => importNodes(nodes))
            .catch(err => console.warn('[OPAL Search] Legacy index migration failed:', err));
    }
    return initPromise;
}

/* ── Upsert queue ──────────────────────────────────────────────── */

const FLUSH_DELAY_MS = 50;
const FLUSH_MAX = 200;

let pending = new Map<string, IndexNodeInput>();
let flushTimer: number | undefined;
let inflight: Promise<void> = Promise.resolve();

function flushNow(): Promise<void> {
    if (flushTimer !== undefined) { clearTimeout(flushTimer); flushTimer = undefined; }
    if (pending.size === 0) return inflight;
    const nodes = [...pending.values()];
    pending = new Map();
    // Chain so batches reach the background in order.
    inflight = inflight
        .then(() => send({ op: 'upsertMany', nodes }))
        .then(() => undefined, err => console.warn('[OPAL Search] Upsert failed:', err));
    return inflight;
}

/**
 * Queue a node for indexing. Resolves immediately: the crawler loops await
 * this per node, and waiting for the round trip would defeat batching.
 * Await flushUpserts() when the writes must have landed.
 */
export function upsertNode(node: IndexNodeInput): Promise<void> {
    if (!node.id) return Promise.resolve();
    pending.set(node.id, node);
    if (pending.size >= FLUSH_MAX) void flushNow();
    else if (flushTimer === undefined) flushTimer = window.setTimeout(() => void flushNow(), FLUSH_DELAY_MS);
    return Promise.resolve();
}

/** Send everything queued so far and wait until the background stored it. */
export function flushUpserts(): Promise<void> {
    return flushNow();
}

// Best effort on navigation: the message is dispatched before the page goes.
window.addEventListener('pagehide', () => { void flushNow(); });

/* ── Queries and commands ──────────────────────────────────────── */

export async function searchNodes(rawQuery: string, courseId = '', limit = 8,
    filters: Pick<SearchOptions, 'courseId' | 'excludeCatalog'> = {}): Promise<SearchResult[]> {
    if (!rawQuery.trim()) return [];
    return send({ op: 'search', query: rawQuery, options: { ...filters, activeCourseId: courseId || undefined, limit } });
}

export function recentNodes(limit = 6): Promise<SearchResult[]> {
    return send({ op: 'recents', limit });
}

/** A real open by the user. Flushes queued upserts first so a node indexed
 *  a moment ago exists; `node` lets the background insert an unknown one. */
export async function recordVisit(id: string, node?: IndexNodeInput): Promise<boolean> {
    if (!id) return false;
    await flushNow();
    return send({ op: 'recordVisit', id, node });
}

export function getNode(id: string): Promise<IndexNode | null> {
    return send({ op: 'get', id });
}

export function getNodes(ids: string[]): Promise<(IndexNode | null)[]> {
    return send({ op: 'getMany', ids });
}

export function nodesByCourse(courseId: string, nodeType?: IndexNode['type'], limit?: number): Promise<IndexNode[]> {
    return send({ op: 'byCourse', courseId, nodeType, limit });
}

/** Files that appeared in already indexed courses and were not opened yet, newest first. */
export function getNewFiles(maxAgeDays = 14, limit = 12): Promise<SearchResult[]> {
    return send({ op: 'newFiles', maxAgeDays, limit });
}

export function getIndexStats(): Promise<IndexStats> {
    return send({ op: 'stats' });
}

export async function clearIndex(): Promise<void> {
    // A batch already on its way would otherwise land after the clear and
    // bring deleted entries back.
    pending.clear();
    await inflight;
    pending.clear();
    await send({ op: 'clear' });
}

export async function importNodes(nodes: IndexNode[]): Promise<void> {
    // Rejected rows fail the same checks the daily prune applies (foreign url,
    // empty title), so they are dropped on purpose and do not block migration.
    const { rejected } = await send({ op: 'importMany', nodes });
    if (rejected) console.log(`[OPAL Search] Skipped ${rejected} invalid legacy index entries`);
}
