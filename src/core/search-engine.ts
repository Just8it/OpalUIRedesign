/**
 * Smart Search Engine — Orama wrapper with context-aware reranking.
 *
 * Architecture:
 *   1. On startup  → syncFromDexie() loads all IndexNodes from Dexie into
 *                    an Orama in-memory index.
 *   2. On upsert   → upsertNode() updates both Dexie and Orama atomically.
 *   3. On query    → searchNodes() runs Orama full-text search, then
 *                    applies score multipliers for context (active course)
 *                    and recency before returning sorted results.
 *
 * Prefix shortcuts:
 *   /c <query>  → restrict results to type='course'
 *   /f <query>  → restrict results to type='file'
 */

import { create, insert, remove, search } from '@orama/orama';
import type { AnyOrama } from '@orama/orama';
import { db, type IndexNode } from './index-db';

/* ── Schema ────────────────────────────────────────────────────── */

const ORAMA_SCHEMA = {
    id:            'string',
    title:         'string',
    url:           'string',
    type:          'string',
    courseId:      'string',
    parentId:      'string',
    fileExtension: 'string',
} as const;

/* ── Module state ──────────────────────────────────────────────── */

let orama: AnyOrama | null = null;

/** Initialise the Orama index and populate from Dexie. */
export async function initSearchEngine(): Promise<void> {
    orama = await create({ schema: ORAMA_SCHEMA });
    await purgeStaleEntries();
    await syncFromDexie();
    console.log('[Search] Engine ready.');
}

/** Remove stale Dexie entries caused by Wicket version counters (?32) or
 *  broken courseIds (";") from before the urlToId fix. Runs once at startup. */
async function purgeStaleEntries(): Promise<void> {
    const all = await db.nodes.toArray();
    const toDelete: string[] = [];
    for (const n of all) {
        if (/\?\d+$/.test(n.id)) toDelete.push(n.id);
        else if (n.courseId === ';' || n.courseId === '') toDelete.push(n.id);
    }
    if (toDelete.length > 0) {
        await db.nodes.bulkDelete(toDelete);
        console.log(`[Search] Purged ${toDelete.length} stale entries.`);
    }
}

/** Reload Orama from the full Dexie store (called once at startup). */
async function syncFromDexie(): Promise<void> {
    if (!orama) return;
    const nodes = await db.nodes.toArray();
    for (const node of nodes) {
        await insert(orama, nodeToDoc(node));
    }
    console.log(`[Search] Synced ${nodes.length} nodes from Dexie.`);
}

/* ── Upsert ────────────────────────────────────────────────────── */

/**
 * Save or update a node in both Dexie and Orama.
 * Call this from the passive indexer whenever a new OPAL page is visited.
 */
export async function upsertNode(node: IndexNode): Promise<void> {
    if (!node.id) return;
    const existing = await db.nodes.get(node.id);

    if (existing) {
        // Increment visit count, update recency
        const updated: IndexNode = {
            ...existing,
            ...node,
            visitCount: existing.visitCount + 1,
            lastVisited: Date.now(),
        };
        await db.nodes.put(updated);

        // Replace in Orama: remove old doc, insert fresh one
        if (orama) {
            try { await remove(orama, node.id); } catch { /* not found */ }
            await insert(orama, nodeToDoc(updated));
        }
    } else {
        const fresh: IndexNode = { ...node, visitCount: 1, lastVisited: Date.now() };
        await db.nodes.put(fresh);
        if (orama) {
            await insert(orama, nodeToDoc(fresh));
        }
    }
}

/* ── Query ─────────────────────────────────────────────────────── */

export interface SearchResult {
    node: IndexNode;
    score: number;
}

/**
 * Search for nodes matching `rawQuery`.
 *
 * @param rawQuery   User input, may start with /c or /f prefix.
 * @param courseId   Active course ID for context boost (empty string if none).
 * @param limit      Max results to return (default 8).
 */
export async function searchNodes(
    rawQuery: string,
    courseId = '',
    limit = 8,
): Promise<SearchResult[]> {
    if (!orama) return [];

    // Parse prefix shortcuts
    let typeFilter: string | null = null;
    let query = rawQuery.trim();

    if (query.startsWith('/c ')) { typeFilter = 'course'; query = query.slice(3).trim(); }
    else if (query.startsWith('/f ')) { typeFilter = 'file';   query = query.slice(3).trim(); }

    if (!query) return [];

    // Normalize German umlauts so "Übung" finds "Uebung" and vice-versa
    query = normalizeForSearch(query);

    // Run Orama full-text search with fuzzy tolerance
    const raw = await search(orama, {
        term:  query,
        tolerance: 1,       // allow 1-char typo/mismatch
        limit: 50,          // over-fetch so reranker has room to work
        boost: { title: 2 },// title hits weighted 2× over url/type hits
        properties: ['title', 'url'],
    });

    const now = Date.now();
    const ONE_DAY = 86_400_000;

    // Fetch Dexie records for recency/visitCount data
    const nodeIds = raw.hits.map(h => h.document.id as string);
    const dexieMap = new Map<string, IndexNode>();
    const dexieNodes = await db.nodes.bulkGet(nodeIds);
    for (const n of dexieNodes) {
        if (n) dexieMap.set(n.id, n);
    }

    // Build a map of courseId → normalized course title for cross-field matching.
    // When the user searches "übung elektrotechnik" and a file is called "Übung"
    // inside a course called "Elektrotechnik", we boost that file because the
    // query terms span both the item title and its parent course name.
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    const courseIdSet = new Set(raw.hits.map(h => h.document.courseId as string).filter(Boolean));
    const courseTitleMap = new Map<string, string>();
    if (courseIdSet.size > 0) {
        const courseNodes = await db.nodes.bulkGet([...courseIdSet]);
        for (const cn of courseNodes) {
            if (cn) courseTitleMap.set(cn.id, normalizeForSearch(cn.title).toLowerCase());
        }
    }

    let results: SearchResult[] = raw.hits
        .map(hit => {
            const dexie = dexieMap.get(hit.document.id as string);
            const node = dexie ?? (hit.document as unknown as IndexNode);

            let score = hit.score;

            // --- Context Boost: same course as the active page ---
            if (courseId && node.courseId === courseId) score *= 4;

            // --- Cross-field Boost: query terms match both item title AND course name ---
            // e.g. query "übung elektrotechnik" → title has "übung", course has "elektrotechnik"
            if (queryTerms.length >= 2 && node.courseId) {
                const courseTitle = courseTitleMap.get(node.courseId) ?? '';
                if (courseTitle) {
                    const itemTitle = normalizeForSearch(node.title).toLowerCase();
                    const titleHits = queryTerms.filter(t => itemTitle.includes(t));
                    const courseHits = queryTerms.filter(t => courseTitle.includes(t));
                    // Boost when some terms match the title and OTHER terms match the course
                    if (titleHits.length > 0 && courseHits.length > 0
                        && titleHits.length + courseHits.length >= queryTerms.length) {
                        score *= 3;
                    }
                }
            }

            // --- Recency Bias: visited within last 7 days gets a boost ---
            const age = now - (node.lastVisited ?? 0);
            if (age < ONE_DAY)      score *= 2.0;
            else if (age < 7 * ONE_DAY) score *= 1.4;

            // --- Frequency Bias ---
            if ((node.visitCount ?? 0) > 5)  score *= 1.3;
            if ((node.visitCount ?? 0) > 20) score *= 1.2;

            return { node, score };
        })
        // Apply type filter after scoring (so boost still applies)
        .filter(r => !typeFilter || r.node.type === typeFilter)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return results;
}

/* ── Helpers ───────────────────────────────────────────────────── */

/** Normalize text for search: expand umlauts, split underscores/hyphens/dots
 *  into spaces so Orama tokenizes each word separately. */
function normalizeForSearch(s: string): string {
    return s
        .replace(/ä/gi, 'ae')
        .replace(/ö/gi, 'oe')
        .replace(/ü/gi, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[_\-\.]+/g, ' ')   // split filenames: 02_Uebung_ETfMB → 02 Uebung ETfMB
        .replace(/\s+/g, ' ')
        .trim();
}

function nodeToDoc(n: IndexNode): Record<string, string> {
    return {
        id:            n.id,
        title:         normalizeForSearch(n.title),
        url:           n.url,
        type:          n.type,
        courseId:      n.courseId,
        parentId:      n.parentId ?? '',
        fileExtension: n.fileExtension ?? '',
    };
}
