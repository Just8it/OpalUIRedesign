/* ━━ Index Database (Dexie) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Persistent store of the search index. Only the background script opens
 * it, so the database lives in the extension origin, not in OPAL's page
 * origin. The in-memory ranking index (src/core/search) is built from it.
 *
 * Indexed fields:
 *   id           primary key (normalised OPAL url path)
 *   courseId     root course, used by the palette's course drill-down
 *   type         node type
 *   lastVisited  last real open by the user
 *   indexedAt    last time an indexer saw the node (stats)
 */

import Dexie, { type Table } from 'dexie';
import type { IndexNode } from './search/types';

export type { IndexNode } from './search/types';

class OpalSearchDB extends Dexie {
    nodes!: Table<IndexNode, string>;

    constructor() {
        super('OpalSearchIndex');
        this.version(1).stores({
            nodes: 'id, courseId, type, lastVisited',
        });
        this.version(2).stores({
            nodes: 'id, courseId, type, lastVisited, indexedAt',
        });
    }
}

export const db = new OpalSearchDB();

import { enrichBatch } from './search/storage-enrichment';
const originalBulkPut = db.nodes.bulkPut.bind(db.nodes);
db.nodes.bulkPut = (async (nodes: IndexNode[]) => {
    await enrichBatch(nodes, id => db.nodes.get(id));
    return originalBulkPut(nodes);
}) as typeof db.nodes.bulkPut;
