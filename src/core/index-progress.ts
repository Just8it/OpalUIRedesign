import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import { t } from '../i18n/messages/search.ts';
/* ━━ Crawler progress ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * The crawlers publish their state to chrome.storage.local so every tab
 * and the options page can follow it through storage.onChanged.
 * Writes are throttled to about four per second; a heartbeat keeps a
 * slow crawl (long page loads) from looking abandoned.
 * options/options.js reads the same key and repeats the stale rule.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export const INDEX_PROGRESS_KEY = 'opalIndexProgress';

export type IndexProgressKind = 'favorites' | 'upcoming';

export interface IndexProgress {
    status: 'running' | 'done' | 'idle';
    kind: IndexProgressKind;
    startedAt: number;
    updatedAt: number;
    /** 0 when unknown: the bar is indeterminate. */
    totalCourses: number;
    completedCourses: number;
    indexedItems: number;
    currentCourseTitle?: string;
}

/** A running record older than this belongs to a tab that closed mid-crawl. */
export const PROGRESS_STALE_MS = 2 * 60 * 1000;
/** How long "Index aktuell" stays visible after a crawl finished. */
export const PROGRESS_DONE_VISIBLE_MS = 5000;

const WRITE_INTERVAL_MS = 250;
const HEARTBEAT_MS = 30_000;

/** Validates a stored value and applies the stale rule. */
export function readProgress(value: unknown, now = Date.now()): IndexProgress | null {
    if (!value || typeof value !== 'object') return null;
    const p = value as Partial<IndexProgress>;
    if (p.status !== 'running' && p.status !== 'done' && p.status !== 'idle') return null;
    const progress: IndexProgress = {
        status: p.status,
        kind: p.kind === 'upcoming' ? p.kind : 'favorites',
        startedAt: Number(p.startedAt) || 0,
        updatedAt: Number(p.updatedAt) || 0,
        totalCourses: Math.max(0, Number(p.totalCourses) || 0),
        completedCourses: Math.max(0, Number(p.completedCourses) || 0),
        indexedItems: Math.max(0, Number(p.indexedItems) || 0),
        currentCourseTitle: typeof p.currentCourseTitle === 'string' ? p.currentCourseTitle : undefined,
    };
    if (progress.status === 'running' && now - progress.updatedAt > PROGRESS_STALE_MS) {
        progress.status = 'idle';
    }
    return progress;
}

export interface ProgressReporter {
    setTotal(totalCourses: number): void;
    startCourse(title: string): void;
    courseDone(): void;
    addItems(count: number): void;
    /** 'idle' when the crawl gave up, so no "Index aktuell" is shown. */
    finish(outcome?: 'done' | 'idle'): Promise<void>;
}

export function startProgress(kind: IndexProgressKind, totalCourses: number): ProgressReporter {
    const state: IndexProgress = {
        status: 'running',
        kind,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        totalCourses,
        completedCourses: 0,
        indexedItems: 0,
    };
    let lastWrite = 0;
    let timer: number | undefined;
    let finished = false;

    const write = (): Promise<void> => {
        if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
        lastWrite = Date.now();
        state.updatedAt = lastWrite;
        try {
            return store.set(keys.progress, { ...state })
                .catch(() => { /* extension context gone */ });
        } catch {
            return Promise.resolve();
        }
    };

    const schedule = () => {
        if (finished || timer !== undefined) return;
        const wait = Math.max(0, WRITE_INTERVAL_MS - (Date.now() - lastWrite));
        timer = window.setTimeout(() => { timer = undefined; void write(); }, wait);
    };

    const heartbeat = window.setInterval(() => { if (!finished) void write(); }, HEARTBEAT_MS);
    void write();

    return {
        setTotal(totalCourses) { state.totalCourses = totalCourses; schedule(); },
        startCourse(title) { state.currentCourseTitle = title; schedule(); },
        courseDone() { state.completedCourses++; schedule(); },
        addItems(count) { if (count > 0) { state.indexedItems += count; schedule(); } },
        async finish(outcome = 'done') {
            if (finished) return;
            finished = true;
            clearInterval(heartbeat);
            state.status = outcome;
            state.currentCourseTitle = undefined;
            if (state.totalCourses) state.completedCourses = state.totalCourses;
            await write();
        },
    };
}

/** Status line for the palette strip. */
export function describeProgress(p: IndexProgress): string {
    const items = t('progressEntries', { count: p.indexedItems });
    if (p.status === 'done') return t('progressDone', { items });
    const progress = p.totalCourses > 0
        ? t('progressCoursesCount', { completed: Math.min(p.completedCourses, p.totalCourses), total: p.totalCourses, items })
        : t('progressCourses', { items });
    return p.currentCourseTitle ? t('progressCurrentCourse', { progress, course: p.currentCourseTitle }) : progress;
}
