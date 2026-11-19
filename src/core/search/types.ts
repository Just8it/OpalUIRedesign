import type { EntryCategory } from '../../course/find/types.ts';
export type { EntryCategory } from '../../course/find/types.ts';
/* ━━ Search: shared types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Contract between the pure search engine (./engine.ts), the
 * background script that owns the index, and the content script.
 * No browser or storage imports in this folder.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** A single OPAL navigation node stored in the search index. */
export interface IndexNode {
    id: string;              // OPAL unique identifier (normalised URL path)
    title: string;           // e.g. "Lecture 4: Architecture"
    url: string;             // Direct deep link
    type: 'course' | 'folder' | 'file' | 'action';
    courseId: string;        // Root course this belongs to
    parentId: string | null; // Immediate parent node id
    /** Last time the USER opened this node. 0 when only ever seen by an indexer. */
    lastVisited: number;
    /** How often the USER opened this node. Indexing never increases it. */
    visitCount: number;
    modified?: number;
    solutionUrl?: string;
    category?: EntryCategory;
    itemNumber?: string;
    fileExtension?: string;  // 'pdf', 'zip', etc. if type === 'file'
    source?: 'user' | 'catalog';
    /** Last time an indexer (passive or crawler) saw this node. */
    indexedAt?: number;
    /** When an indexer saw this node for the very first time. Never updated. */
    firstSeenAt?: number;
    searchText?: string;     // Legacy denormalised context; the engine does not need it
    /* Catalog metadata (optional) */
    description?: string;
    author?: string;
    institution?: string;
    semester?: string;       // e.g. "Sommersemester 2026"
    courseType?: string;
}

/** One ranked hit. */
export interface SearchResult {
    node: IndexNode;
    score: number;
    /** Titles of the ancestors, root (course) first, without the node itself. */
    path: string[];
    /** Human-readable scoring steps, e.g. "title token uebung +18". */
    explanation: string[];
}

export interface SearchOptions {
    /** Course the user is currently in; gives a moderate additive boost. */
    activeCourseId?: string;
    /** Restrict results to this course before ranking and limiting. */
    courseId?: string;
    /** Hide catalogue-only nodes before they can displace visible results. */
    excludeCatalog?: boolean;
    /** Max results (default 8). */
    limit?: number;
    /** Clock override for tests (default Date.now()). */
    now?: number;
}

/**
 * In-memory index. Built once, then updated incrementally; a query must not
 * rebuild anything that depends on the whole node set.
 */
export interface SearchIndex {
    /** Replace the whole index. */
    setAll(nodes: IndexNode[]): void;
    /** Insert or replace one node (and refresh whatever derives from it, including descendants' paths). */
    upsert(node: IndexNode): void;
    remove(id: string): void;
    clear(): void;
    get(id: string): IndexNode | undefined;
    size(): number;
    /** Supports the `/c ` and `/f ` type prefixes and extension words such as `pdf`. Empty query returns []. */
    search(rawQuery: string, options?: SearchOptions): SearchResult[];
    /** Nodes the user actually opened, ranked by frecency. Used for the empty query. */
    recents(limit?: number, now?: number): SearchResult[];
}
