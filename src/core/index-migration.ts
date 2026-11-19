import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
/* ━━ One-time migration of the page-origin search index ━━━━━━━━━
 * Versions up to 0.2.x opened the Dexie database `OpalSearchIndex` from
 * the content script, so it lives in OPAL's page origin. The background
 * script now owns the index in the extension origin. This moves the old
 * nodes over once, then deletes the old database.
 *
 * Raw IndexedDB on purpose: keeps Dexie out of the content bundle.
 * Concurrency: a Web Lock serialises tabs of the same origin and the flag
 * is re-checked inside it. Without locks a double run is still harmless,
 * because importMany keeps the larger visit values and the imported ones
 * are all zero.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { IndexNode } from './search/types';


const LEGACY_DB = 'OpalSearchIndex';
const BATCH = 500;

/** Opens the legacy database only if it already exists. */
function openExisting(): Promise<IDBDatabase | null> {
    return new Promise(resolve => {
        let req: IDBOpenDBRequest;
        try {
            req = indexedDB.open(LEGACY_DB);
        } catch {
            resolve(null);
            return;
        }
        // Fires with oldVersion 0 only when the database does not exist:
        // aborting the upgrade leaves nothing behind.
        req.onupgradeneeded = () => req.transaction?.abort();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
    });
}

function readAll(db: IDBDatabase): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains('nodes')) { resolve([]); return; }
        const req = db.transaction('nodes', 'readonly').objectStore('nodes').getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error);
    });
}

function deleteLegacy(): Promise<void> {
    return new Promise(resolve => {
        const req = indexedDB.deleteDatabase(LEGACY_DB);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        // Another tab still holds a connection; the delete stays queued and
        // completes once it closes (Dexie closes on versionchange).
        req.onblocked = () => resolve();
    });
}

function toImport(old: Record<string, unknown>): IndexNode {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
        ...(old as unknown as IndexNode),
        // The old counters were bumped by every crawler pass, so they carry no signal.
        visitCount: 0,
        lastVisited: 0,
        indexedAt: num(old.indexedAt) || num(old.lastVisited),
    };
}

async function isDone(): Promise<boolean> {
    return !!(await store.get(keys.migrated));
}

async function migrate(importMany: (nodes: IndexNode[]) => Promise<void>): Promise<void> {
    if (await isDone()) return;

    const db = await openExisting();
    if (db) {
        let rows: Record<string, unknown>[];
        try {
            rows = await readAll(db);
        } finally {
            db.close();
        }
        const nodes = rows.filter(r => r && typeof r.id === 'string').map(toImport);
        for (let i = 0; i < nodes.length; i += BATCH) {
            // Throws when the background is unreachable: the flag stays unset
            // and the next page load retries (re-importing is idempotent).
            await importMany(nodes.slice(i, i + BATCH));
        }
        await deleteLegacy();
        if (nodes.length) console.log(`[OPAL Search] Migrated ${nodes.length} index entries to the extension`);
    }
    await store.set(keys.migrated, Date.now());
}

export async function migrateLegacyIndex(importMany: (nodes: IndexNode[]) => Promise<void>): Promise<void> {
    if (await isDone()) return;
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks?.request) {
        await locks.request('opal-index-migration-v2', () => migrate(importMany));
    } else {
        await migrate(importMany);
    }
}
