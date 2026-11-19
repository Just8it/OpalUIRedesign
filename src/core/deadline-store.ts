import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import { storageAvailable } from '../storage/backend.ts';
/* ━━ Scraped deadline store ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Deadlines found on OPAL pages, kept in chrome.storage.local.
 * Writes are debounced and batched: crawl loops queue results per
 * page, one flush merges them into storage. Merge is by id, so a
 * re-crawl never duplicates an entry and never clears `dismissed`.
 * The merge, dismiss and prune logic are pure functions for tests.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { DeadlineKind } from './deadline-parser';

export const SCRAPED_DEADLINES_KEY = 'opalScrapedDeadlines';
export const SCRAPED_DEADLINES_ENABLED_KEY = 'opalScrapedDeadlinesEnabled';
export const MAX_SCRAPED_DEADLINES = 200;
/** Entries more than this far past due are dropped on write. */
export const PRUNE_AFTER_MS = 86_400_000;
const FLUSH_DELAY_MS = 1500;

export interface ScrapedDeadline {
    id: string;
    /** Empty when the source has no title. The widget supplies a localized fallback. */
    title: string;
    description?: string;
    courseId: string;
    courseTitle?: string;
    pageUrl: string;
    /** ISO string */
    due: string;
    kind: DeadlineKind;
    /** ISO string of the first time it was found */
    foundAt: string;
    dismissed?: boolean;
}

const KINDS: readonly DeadlineKind[] = ['deadline', 'enrolment', 'exam'];

/* ── Pure helpers ──────────────────────────────────────────── */

/** Stable short id from page, calendar day and kind. */
export function deadlineId(pageUrl: string, dayKey: string, kind: DeadlineKind): string {
    const input = `${pageUrl}|${dayKey}|${kind}`;
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193);
        h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    }
    return `sd_${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

function str(v: unknown, max = 500): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
}

/** Drops malformed entries read back from storage. */
export function sanitizeScrapedDeadlines(raw: unknown): ScrapedDeadline[] {
    if (!Array.isArray(raw)) return [];
    const out: ScrapedDeadline[] = [];
    for (const r of raw) {
        if (!r || typeof r !== 'object') continue;
        const o = r as Record<string, unknown>;
        const id = str(o.id, 64);
        const title = o.title === '' ? '' : str(o.title);
        const pageUrl = str(o.pageUrl, 2000);
        const due = str(o.due, 40);
        const kind = KINDS.includes(o.kind as DeadlineKind) ? (o.kind as DeadlineKind) : undefined;
        if (!id || title === undefined || !pageUrl || !due || !kind || Number.isNaN(Date.parse(due))) continue;
        const entry: ScrapedDeadline = {
            id, title, pageUrl, due, kind,
            courseId: str(o.courseId, 2000) ?? '',
            foundAt: str(o.foundAt, 40) ?? due,
        };
        const description = str(o.description);
        const courseTitle = str(o.courseTitle);
        if (description) entry.description = description;
        if (courseTitle) entry.courseTitle = courseTitle;
        if (o.dismissed === true) entry.dismissed = true;
        out.push(entry);
    }
    return out;
}

/**
 * Merges freshly found entries into the stored list.
 * - same id: fields refreshed, first `foundAt` and `dismissed` kept
 * - a page in `scannedPages` loses its entries that were not found
 *   again, unless the user dismissed them (so they do not come back)
 * - entries more than PRUNE_AFTER_MS past due are dropped
 * - capped at MAX_SCRAPED_DEADLINES, open entries before dismissed ones
 */
export function mergeScrapedDeadlines(
    existing: ScrapedDeadline[],
    incoming: ScrapedDeadline[],
    scannedPages: Iterable<string>,
    now: number,
): ScrapedDeadline[] {
    const scanned = new Set(scannedPages);
    const incomingIds = new Set(incoming.map(e => e.id));
    const byId = new Map<string, ScrapedDeadline>();

    for (const e of existing) {
        if (scanned.has(e.pageUrl) && !e.dismissed && !incomingIds.has(e.id)) continue;
        byId.set(e.id, e);
    }
    for (const e of incoming) {
        const prev = byId.get(e.id);
        const merged: ScrapedDeadline = { ...e, foundAt: prev?.foundAt ?? e.foundAt };
        if (prev?.dismissed || e.dismissed) merged.dismissed = true;
        else delete merged.dismissed;
        byId.set(e.id, merged);
    }

    const cutoff = now - PRUNE_AFTER_MS;
    const live = [...byId.values()].filter(e => {
        const due = Date.parse(e.due);
        return !Number.isNaN(due) && due >= cutoff;
    });
    const byDue = (a: ScrapedDeadline, b: ScrapedDeadline) => Date.parse(a.due) - Date.parse(b.due) || a.id.localeCompare(b.id);
    if (live.length > MAX_SCRAPED_DEADLINES) {
        live.sort((a, b) => Number(!!a.dismissed) - Number(!!b.dismissed) || byDue(a, b));
        live.length = MAX_SCRAPED_DEADLINES;
    }
    return live.sort(byDue);
}

export function dismissInList(list: ScrapedDeadline[], id: string): ScrapedDeadline[] {
    return list.map(e => (e.id === id ? { ...e, dismissed: true } : e));
}

/** Open entries due after `now`, soonest first. */
export function visibleScrapedDeadlines(list: ScrapedDeadline[], now: number): ScrapedDeadline[] {
    return list
        .filter(e => !e.dismissed && Date.parse(e.due) > now)
        .sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
}

/* ── Storage ───────────────────────────────────────────────── */

function hasStorage(): boolean {
    return storageAvailable();
}

export async function loadScrapedDeadlines(): Promise<ScrapedDeadline[]> {
    if (!hasStorage()) return [];
    try {
        return await store.get(keys.scrapedDeadlines);
    } catch {
        return [];
    }
}

export async function loadScrapedDeadlinesEnabled(): Promise<boolean> {
    if (!hasStorage()) return false;
    try {
        return await store.get(keys.deadlines);
    } catch {
        return false;
    }
}

export async function saveScrapedDeadlinesEnabled(enabled: boolean): Promise<void> {
    if (!hasStorage()) return;
    await store.set(keys.deadlines, enabled);
}

/* One chain for every read-modify-write, so a dismiss never races a flush. */
let writeChain: Promise<void> = Promise.resolve();

function serialized(task: () => Promise<void>): Promise<void> {
    writeChain = writeChain.then(task).catch(err => console.warn('[OPAL] Deadline store write failed:', err));
    return writeChain;
}

async function readModifyWrite(change: (list: ScrapedDeadline[]) => ScrapedDeadline[]): Promise<void> {
    const before = await loadScrapedDeadlines();
    const after = change(before);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    await store.set(keys.scrapedDeadlines, after);
}

const pendingEntries = new Map<string, ScrapedDeadline>();
const pendingPages = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Queues the result of one page scan (an empty list clears that page's open entries). */
export function queuePageDeadlines(pageUrl: string, entries: ScrapedDeadline[]): void {
    if (!hasStorage()) return;
    pendingPages.add(pageUrl);
    for (const e of entries) pendingEntries.set(e.id, e);
    if (flushTimer === null) flushTimer = setTimeout(() => { void flushScrapedDeadlines(); }, FLUSH_DELAY_MS);
}

export function flushScrapedDeadlines(): Promise<void> {
    if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
    if (pendingPages.size === 0 && pendingEntries.size === 0) return writeChain;
    const entries = [...pendingEntries.values()];
    const pages = [...pendingPages];
    pendingEntries.clear();
    pendingPages.clear();
    return serialized(async () => {
        if (!(await loadScrapedDeadlinesEnabled())) return;
        await readModifyWrite(list => mergeScrapedDeadlines(list, entries, pages, Date.now()));
    });
}

export function dismissScrapedDeadline(id: string): Promise<void> {
    if (!hasStorage()) return Promise.resolve();
    return serialized(() => readModifyWrite(list => dismissInList(list, id)));
}
