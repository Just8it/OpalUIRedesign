/* ━━ Search index: runtime message protocol ━━━━━━━━━━━━━━━━━━━━━
 * Shared by the background script (owner of the index), the content
 * script client and, as plain objects, options/options.js.
 * Every request carries `channel: INDEX_CHANNEL` so the background
 * listener can ignore unrelated runtime messages.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { IndexNode, SearchOptions, SearchResult } from './search/types';

export const INDEX_CHANNEL = 'opal-index';

/** What an indexer may send. Visit fields are owned by the background. */
export type IndexNodeInput = Omit<IndexNode, 'visitCount' | 'lastVisited' | 'indexedAt'>
    & Partial<Pick<IndexNode, 'visitCount' | 'lastVisited' | 'indexedAt'>>;

export interface IndexStats {
    total: number;
    courses: number;
    folders: number;
    files: number;
    /** Newest indexedAt or lastVisited, 0 when empty. */
    lastIndexed: number;
}

export type IndexRequest =
    | { op: 'search'; query: string; options?: SearchOptions }
    | { op: 'recents'; limit?: number }
    /** Indexing. Never changes visitCount/lastVisited of an existing node. */
    | { op: 'upsertMany'; nodes: IndexNodeInput[] }
    /** A real open by the user. `node` is inserted first when the id is unknown. */
    | { op: 'recordVisit'; id: string; node?: IndexNodeInput }
    | { op: 'get'; id: string }
    | { op: 'getMany'; ids: string[] }
    | { op: 'byCourse'; courseId: string; nodeType?: IndexNode['type']; limit?: number }
    /** Files that appeared in already indexed courses and were not opened yet. */
    | { op: 'newFiles'; maxAgeDays?: number; limit?: number }
    | { op: 'stats' }
    /** Complete stored index for a user-requested JSON download. */
    | { op: 'exportNodes' }
    | { op: 'clear' }
    /** Migration and import: keeps the larger visit values when a node exists. */
    | { op: 'importMany'; nodes: IndexNode[] };

export interface IndexResponses {
    search: SearchResult[];
    recents: SearchResult[];
    upsertMany: { written: number; rejected: number };
    recordVisit: boolean;
    get: IndexNode | null;
    getMany: (IndexNode | null)[];
    byCourse: IndexNode[];
    newFiles: SearchResult[];
    stats: IndexStats;
    exportNodes: IndexNode[];
    clear: true;
    importMany: { written: number; rejected: number };
}

export type IndexEnvelope = IndexRequest & { channel: typeof INDEX_CHANNEL };

export type IndexReply<T> = { ok: true; data: T } | { ok: false; error: string };

export const OPAL_ORIGIN = 'https://bildungsportal.sachsen.de';

/** True for https://bildungsportal.sachsen.de/opal/... and for the
 *  site-relative `/opal/...` form some stored urls and ids use. */
export function isOpalUrl(value: unknown): boolean {
    if (typeof value !== 'string' || !value || value.length > 4096) return false;
    if (value === '/opal' || value.startsWith('/opal/') || value.startsWith('/opal?')) return true;
    try {
        const u = new URL(value);
        return u.protocol === 'https:'
            && u.host === 'bildungsportal.sachsen.de'
            && (u.pathname === '/opal' || u.pathname.startsWith('/opal/'));
    } catch {
        return false;
    }
}

export function isStableFileUrl(value: string): boolean {
    if (!isOpalUrl(value)) return false;
    const u = new URL(value, OPAL_ORIGIN);
    return !u.search && !u.hash && /\.[a-z0-9]{2,8}$/i.test(u.pathname) && !/wicket|ILinkListener/i.test(u.href);
}

export function isSafeCourseLink(value: string, courseUrl: string): boolean {
    if (!isOpalUrl(value) || /logout|logoff|delete|remove|unsubscribe|abmelden|loeschen|austragen|javascript:/i.test(value)) return false;
    try {
        const root = new URL(courseUrl, OPAL_ORIGIN).pathname.match(/\/RepositoryEntry\/(\d+)(?:\/|$)/i)?.[1];
        const target = new URL(value, OPAL_ORIGIN).pathname.match(/\/RepositoryEntry\/(\d+)(?:\/|$)/i)?.[1];
        return !!root && root === target;
    } catch { return false; }
}
