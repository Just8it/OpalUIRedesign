/**
 * Dexie.js schema for the OPAL Smart Search index.
 *
 * All OPAL navigation nodes the user has visited are stored here as a flat
 * list. Orama's in-memory index is built from this store on startup.
 *
 * Indexed fields:
 *   ++        auto-increment PK (Dexie internal)
 *   id        OPAL unique identifier (unique)
 *   courseId  root course this node belongs to (secondary index for context boost)
 *   type      node type (secondary index for prefix filters /c /f)
 *   lastVisited  unix ms (secondary index for recency bias)
 */

import Dexie, { type Table } from 'dexie';

export interface IndexNode {
    id: string;              // OPAL unique identifier (URL hash or path segment)
    title: string;           // e.g. "Lecture 4: Architecture"
    url: string;             // Direct deep link
    type: 'course' | 'folder' | 'file' | 'action';
    courseId: string;        // Root course this belongs to (for context boost)
    parentId: string | null; // Immediate parent folder id
    lastVisited: number;     // Unix timestamp ms
    visitCount: number;      // Frequency counter
    fileExtension?: string;  // 'pdf', 'zip', etc. if type === 'file'
}

class OpalSearchDB extends Dexie {
    nodes!: Table<IndexNode, string>;

    constructor() {
        super('OpalSearchIndex');
        this.version(1).stores({
            // id is the primary key; additional indices for fast queries
            nodes: 'id, courseId, type, lastVisited',
        });
    }
}

export const db = new OpalSearchDB();
