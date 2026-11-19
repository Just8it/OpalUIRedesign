import { store } from '../storage/store.ts';
import { keys, normaliseTheme } from '../storage/registry.ts';
import { storageAdmin } from '../storage/admin.ts';
import type { ThemeConfig } from '../theme.ts';
import type { IndexNode } from '../core/search/types.ts';
import { readProgress, type IndexProgress } from '../core/index-progress.ts';
import { applyPageTheme as applySharedPageTheme } from '../storage/page-theme.ts';
import { normaliseHome } from '../course/home/config.ts';
import { normaliseProgress } from '../course/home/progress.ts';
import { formatNumber, initLocale, onLocaleChange } from '../i18n/index.ts';
import { t, type PageMessageKey } from '../i18n/messages/pages.ts';
import { confirmDialog } from './confirm.ts';
import { localizePage } from './localize.ts';
let pageTheme: ThemeConfig = normaliseTheme(undefined);
/** Accent presets of the Darstellung panel; any other colour reads as "Eigene". */
const ACCENT_NAMES: Record<string, PageMessageKey | undefined> = { '#2f6fe4': 'optionsAccentBlue', '#b04736': 'optionsAccentRed', '#26805b': 'optionsAccentGreen', '#8150b5': 'optionsAccentPurple' };
const MODE_NAMES: Record<ThemeConfig['mode'], PageMessageKey> = { light: 'optionsModeLight', dark: 'optionsModeDark', oled: 'optionsModeOled' };
function applyPageTheme(raw: unknown) {
    pageTheme = applySharedPageTheme(raw);
    $('themeSwatch').style.background = pageTheme.accent;
    renderThemeValue();
}
function renderThemeValue() {
    $('themeValue').textContent = t('optionsThemeValue', {
        mode: t(MODE_NAMES[pageTheme.mode]),
        accent: t(ACCENT_NAMES[pageTheme.accent.toLowerCase()] ?? 'optionsAccentCustom'),
    });
}

// Persistent settings found in storage consumers in src/ and popup/.
// Transient index progress, cooldowns, migration flags and highlight intents stay local.
import { IMPORT_VALIDATORS } from '../storage/import-validation.ts';
function object(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function strings(v: unknown): v is string[] { return Array.isArray(v) && v.every(e => typeof e === 'string'); }
function hasUnsafeKey(value: unknown): boolean {
    return !!value && typeof value === 'object' && Object.entries(value).some(([key, child]) =>
        ['__proto__', 'constructor', 'prototype'].includes(key) || hasUnsafeKey(child));
}
// Mirrors COURSE_VIEW_ENABLED_KEY in src/course/types.ts. Off unless set.
// Mirrors src/core/index-messages.ts and src/core/index-progress.ts.
const INDEX_CHANNEL = 'opal-index';
const PROGRESS_STALE_MS = 2 * 60 * 1000;
const PROGRESS_DONE_VISIBLE_MS = 5000;

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const enabledToggle = $('enabledToggle');
const languageSelect = $<HTMLSelectElement>('languageSelect');
const courseViewToggle = $('courseViewToggle');
const downloadFilesToggle = $('downloadFilesToggle');
const preloadToggle = $('preloadToggle');
const catalogToggle = $('catalogToggle');
const deadlinesToggle = $('deadlinesToggle');
const explainRankingToggle = $('explainRankingToggle');
const storageCount = $('storageCount');
const indexCount = $('indexCount');
const courseCount = $('courseCount');
const folderCount = $('folderCount');
const fileCount = $('fileCount');
const lastIndexed = $('lastIndexed');
const statusText = $('statusText');
const indexProgress = $('indexProgress');
const exportBtn = $('exportBtn');
const exportIndexBtn = $('exportIndexBtn') as HTMLButtonElement;

/** A switch that mirrors one stored value: it follows the store (other pages, imports) and writes at once;
 *  a failed write puts the switch back and reports in the status line of its section. */
function bindSwitch<T>(input: HTMLInputElement, entry: Parameters<typeof store.get<T>>[0], toState: (value: T) => boolean, fromState: (on: boolean) => T, status: HTMLElement, after?: () => void) {
    const show = (value: T) => { input.checked = toState(value); after?.(); };
    void store.get(entry).then(show);
    store.watch(entry, show);
    input.addEventListener('change', async () => {
        try { await store.set(entry, fromState(input.checked)); setStatus(null, status); }
        catch {
            input.checked = toState(await store.get(entry));
            setStatus('optionsSaveFailed', status);
        }
    });
}
const generalStatus = $('generalStatus');
const searchStatus = $('searchStatus');
const homeStatus = $('homeStatus');
const helpStatus = $('helpStatus');
const plain = { to: (v: boolean) => v, from: (v: boolean) => v };
bindSwitch(enabledToggle, keys.enabled, plain.to, plain.from, generalStatus, () => { courseViewToggle.disabled = !enabledToggle.checked; });
bindSwitch(courseViewToggle, keys.courseView, plain.to, plain.from, generalStatus);
bindSwitch(downloadFilesToggle, keys.downloadFiles, plain.to, plain.from, generalStatus);
bindSwitch(preloadToggle, keys.preload, v => v.enabled, enabled => ({ enabled }), searchStatus);
bindSwitch(catalogToggle, keys.catalog, v => v.enabled, enabled => ({ enabled }), searchStatus);
bindSwitch(deadlinesToggle, keys.deadlines, plain.to, plain.from, searchStatus);
bindSwitch(explainRankingToggle, keys.explainRanking, plain.to, plain.from, helpStatus);
const importFile = (document.getElementById('importFile') as HTMLInputElement);
const clearIndexBtn = (document.getElementById('clearIndexBtn') as HTMLInputElement);
const clearAllBtn = (document.getElementById('clearAllBtn') as HTMLInputElement);

const EMPTY_STATS = { total: 0, courses: 0, folders: 0, files: 0, lastIndexed: 0 };
let stats: { storageKeys: number; index: typeof EMPTY_STATS } | undefined;

const statuses = new Map<HTMLElement, { render: () => string; timer?: ReturnType<typeof setTimeout> }>();
/** Shows a status line and clears it after 8 s; a pending state (`keep`) stays until the line changes. */
function setStatus(message: PageMessageKey | (() => string) | null, target: HTMLElement = statusText, keep = false) {
    clearTimeout(statuses.get(target)?.timer);
    if (message === null) {
        statuses.delete(target);
        target.textContent = '';
        return;
    }
    const render = typeof message === 'function' ? message : () => t(message);
    const timer = keep ? undefined : setTimeout(() => setStatus(null, target), 8000);
    statuses.set(target, { render, timer });
    target.textContent = render();
}

function getAllStorage() {
    return storageAdmin.readAll();
}

/** The index lives in the background script; talk to it by message. */
function sendIndexMessage<T>(request: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        chrome.runtime.sendMessage({ ...request, channel: INDEX_CHANNEL }, reply => {
            const lastError = chrome.runtime.lastError;
            if (lastError) { reject(new Error(lastError.message)); return; }
            if (!reply) { reject(new Error('No reply from index')); return; }
            if (reply.ok) resolve(reply.data);
            else reject(new Error(reply.error));
        });
    });
}

function readSearchIndexStats() {
    return sendIndexMessage<typeof EMPTY_STATS>({ op: 'stats' }).catch(() => EMPTY_STATS);
}

function clearSearchIndex() {
    return sendIndexMessage({ op: 'clear' });
}

function formatRelativeTime(timestamp: number) {
    if (!timestamp) return '-';
    const minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return t('optionsJustNow');
    if (minutes < 60) return t('optionsMinutesAgo', { minutes });
    if (minutes < 1440) return t('optionsHoursAgo', { hours: Math.round(minutes / 60) });
    return t('optionsDaysAgo', { count: Math.round(minutes / 1440) });
}

/* ── Crawler progress line ─────────────────────────────────────── */

let progressTimer: ReturnType<typeof setTimeout> | undefined;
let progress: ReturnType<typeof readProgress>;

function describeProgress(p: Pick<IndexProgress, 'status' | 'kind' | 'totalCourses' | 'completedCourses' | 'indexedItems' | 'currentCourseTitle'>) {
    const items = t('optionsEntryCount', { count: p.indexedItems });
    if (p.status === 'done') return t('optionsProgressDone', { items });
    const catalog = p.kind === 'catalog';
    const progress = p.totalCourses > 0
        ? t(catalog ? 'optionsProgressCatalogCount' : 'optionsProgressCoursesCount', {
            completed: Math.min(p.completedCourses, p.totalCourses), total: p.totalCourses, items,
        })
        : t(catalog ? 'optionsProgressCatalog' : 'optionsProgressCourses', { items });
    return p.currentCourseTitle ? t('optionsProgressCurrentCourse', { progress, course: p.currentCourseTitle }) : progress;
}

function renderProgress() {
    clearTimeout(progressTimer);
    const now = Date.now();
    const p = progress;
    const updatedAt = Number(p?.updatedAt) || 0;
    const running = p?.status === 'running' && now - updatedAt <= PROGRESS_STALE_MS;
    const freshDone = p?.status === 'done' && now - updatedAt < PROGRESS_DONE_VISIBLE_MS;
    if (!p || (!running && !freshDone)) {
        indexProgress.hidden = true;
        indexProgress.textContent = '';
        return;
    }
    indexProgress.hidden = false;
    indexProgress.textContent = describeProgress({
        status: p.status,
        kind: p.kind,
        totalCourses: Number(p.totalCourses) || 0,
        completedCourses: Number(p.completedCourses) || 0,
        indexedItems: Number(p.indexedItems) || 0,
        currentCourseTitle: typeof p.currentCourseTitle === 'string' ? p.currentCourseTitle : '',
    });
    const recheck = running
        ? updatedAt + PROGRESS_STALE_MS - now + 50
        : updatedAt + PROGRESS_DONE_VISIBLE_MS - now + 50;
    progressTimer = setTimeout(renderProgress, Math.max(50, recheck));
}

store.watch(keys.progress, next => {
    progress = readProgress(next);
    renderProgress();
    if (next?.status === 'done') void refreshStats();
});

let lastRuns: { preload: number; catalog: number } | undefined;
function lastRunText(timestamp: number) {
    return timestamp ? t('optionsLastRun', { time: formatRelativeTime(timestamp) }) : t('optionsNeverIndexed');
}
function renderLastRuns() {
    if (!lastRuns) return;
    $('preloadStatus').textContent = lastRunText(lastRuns.preload);
    $('catalogStatus').textContent = lastRunText(lastRuns.catalog);
}
async function refreshLastRuns() {
    const [active, catalog] = await Promise.all([store.get(keys.activeIndex), store.get(keys.catalogIndexed)]);
    lastRuns = { preload: Math.max(0, ...Object.values(active)), catalog };
    renderLastRuns();
}
store.watch(keys.activeIndex, () => { void refreshLastRuns(); });
store.watch(keys.catalogIndexed, () => { void refreshLastRuns(); });

async function refreshStats() {
    const [storage, index] = await Promise.all([getAllStorage(), readSearchIndexStats()]);
    stats = { storageKeys: Object.keys(storage).length, index };
    renderStats();
    progress = readProgress(await store.get(keys.progress));
    renderProgress();
    void refreshLastRuns();
}

function renderStats() {
    if (!stats) return;
    const { storageKeys, index: indexStats } = stats;
    storageCount.textContent = formatNumber(storageKeys);
    indexCount.textContent = formatNumber(indexStats.total);
    courseCount.textContent = formatNumber(indexStats.courses);
    folderCount.textContent = formatNumber(indexStats.folders);
    fileCount.textContent = formatNumber(indexStats.files);
    lastIndexed.textContent = formatRelativeTime(indexStats.lastIndexed);
    $<HTMLElement>('searchSummary').textContent = indexStats.lastIndexed
        ? t('optionsSummary', {
            files: t('optionsSummaryFiles', { count: Number(indexStats.files) || 0 }),
            courses: t('optionsSummaryCourses', { count: Number(indexStats.courses) || 0 }),
            time: formatRelativeTime(indexStats.lastIndexed),
        })
        : t('optionsNeverIndexed');
}

/** Keys that carry per-course data: pattern, normaliser applied on export and import, shape check. */
const COURSE_IMPORTS: [RegExp, (value: unknown) => unknown, (value: unknown) => boolean][] = [
    [/^opalCourseHome_[^\s]+$/i, value => normaliseHome(value), value => object(value) && Array.isArray(value.blocks)],
    [/^opalCourseProgress_[^\s]+$/i, normaliseProgress, value => object(value)],
];
function validImportEntry(key: string, value: unknown) {
    if (Object.prototype.hasOwnProperty.call(IMPORT_VALIDATORS, key)) return IMPORT_VALIDATORS[key as keyof typeof IMPORT_VALIDATORS](value);
    if (/^opalCoursePrefs_[^\s]+$/i.test(key)) return object(value) && ['order','hidden','collapsed'].every(k => strings(value[k])) && (value.wide === undefined || strings(value.wide)) && (value.open === undefined || strings(value.open));
    if (/^opalCourseCollapsed_[^\s]+$/i.test(key)) return strings(value);
    if (/^opalCourseOpened_[^\s]+$/i.test(key)) return object(value) && Object.values(value).every(Number.isFinite);
    return COURSE_IMPORTS.some(([pattern, , valid]) => pattern.test(key) && valid(value));
}
/** What gets stored for an accepted entry: course data goes through its normaliser. */
function importedValue(key: string, value: unknown) {
    const match = COURSE_IMPORTS.find(([pattern]) => pattern.test(key));
    return match ? match[1](value) : value;
}
// Export and import cover storage.local only; the search index is
// rebuilt by browsing and is not part of the settings file.
exportBtn.addEventListener('click', async () => {
    const data = await getAllStorage();
    const exported = Object.fromEntries(Object.entries(data).filter(([key, value]) => validImportEntry(key, value)).map(([key, value]) => [key, importedValue(key, value)]));
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opal-redesign-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('optionsBackupExported');
});

exportIndexBtn.addEventListener('click', async () => {
    exportIndexBtn.disabled = true;
    try {
        const nodes = await sendIndexMessage<IndexNode[]>({ op: 'exportNodes' });
        const blob = new Blob([JSON.stringify(nodes, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = `opal-redesign-search-index-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
        } finally {
            URL.revokeObjectURL(url);
        }
        setStatus(() => t('optionsIndexExported', { items: t('optionsEntryCount', { count: nodes.length }) }));
    } catch {
        setStatus('optionsIndexExportFailed');
    } finally {
        exportIndexBtn.disabled = false;
    }
});

importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    const fail = (reason: PageMessageKey) => setStatus(() => t('optionsImportFailed', { reason: t(reason) }));
    try {
        if (file.size > 5 * 1024 * 1024) return fail('optionsImportTooLarge');
        let data;
        try { data = JSON.parse(await file.text()); }
        catch { return fail('optionsImportInvalidJson'); }
        if (!object(data)) return fail('optionsImportInvalidRoot');
        if (hasUnsafeKey(data)) return fail('optionsImportUnsafeKeys');
        const accepted: Record<string, unknown> = {};
        const skipped: string[] = [];
        for (const [key, value] of Object.entries(data)) {
            if (validImportEntry(key, value)) accepted[key] = importedValue(key, value);
            else skipped.push(key);
        }
        await storageAdmin.importAll(accepted);
        setStatus(() => t('optionsImportDone', {
            accepted: Object.keys(accepted).join(', ') || t('optionsImportNone'),
            skipped: skipped.join(', ') || t('optionsImportNone'),
        }));
        refreshStats();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setStatus(() => t('optionsImportFailed', { reason }));
    } finally {
        importFile.value = '';
    }
});

clearIndexBtn.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'optionsClearIndexTitle', message: 'optionsClearIndexText', confirmLabel: 'optionsClearIndex', danger: true })) return;
    try {
        await clearSearchIndex();
        setStatus('optionsClearIndexDone');
    } catch {
        setStatus('optionsClearIndexFailed');
    }
    refreshStats();
});

clearAllBtn.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'optionsClearAllTitle', message: 'optionsClearAllText', confirmLabel: 'optionsClearAll', danger: true })) return;
    const results = await Promise.allSettled([storageAdmin.clear(), clearSearchIndex()]);
    const failed = results.flatMap((r, i) => r.status === 'rejected' ? [i === 0 ? 'optionsLocalStorage' : 'optionsIndex'] as const : []);
    setStatus(failed.length
        ? () => t('optionsClearAllFailed', { failed: failed.map(key => t(key)).join(', ') })
        : 'optionsClearAllDone');
    refreshStats();
});

/* ── Jetzt aktualisieren ───────────────────────────────────────────
 * The request key is claimed (reset to 0) by one open OPAL tab, which then runs the refresh
 * (src/index-requests.ts). If nobody claims it, it stays pending for the next OPAL page. */
$('refreshIndexBtn').addEventListener('click', async () => {
    try {
        const taken = new Promise<boolean>(resolve => {
            const stop = store.watch(keys.refreshRequested, value => { if (value === 0) { stop(); resolve(true); } });
            setTimeout(() => { stop(); resolve(false); }, 1500);
        });
        await store.set(keys.refreshRequested, Date.now());
        setStatus('optionsRefreshRequesting', searchStatus, true);
        if (await taken) setStatus('optionsRefreshing', searchStatus);
        else {
            // Stays until an OPAL tab takes the request.
            setStatus('optionsRefreshWaiting', searchStatus, true);
            const stop = store.watch(keys.refreshRequested, value => { if (value === 0) { stop(); setStatus('optionsRefreshing', searchStatus); } });
        }
    } catch {
        setStatus('optionsRefreshFailed', searchStatus);
    }
});

/* ── Startseite und Darstellung ────────────────────────────────────
 * Both ask the background script to open (or focus) an OPAL start page; it hands the request to that one
 * tab, which enters edit mode, for "appearance" with the Darstellung panel open. */
async function openDashboard(request: 'edit' | 'appearance' | 'open', status: HTMLElement = homeStatus, done: PageMessageKey = 'optionsHomeEditOpening') {
    try {
        if (!await store.get(keys.enabled)) { setStatus('optionsRedesignDisabled', status); return; }
        const ok = await new Promise<boolean>(resolve => chrome.runtime.sendMessage({ type: 'opal-customize', request }, reply => { void chrome.runtime.lastError; resolve(reply?.ok === true); }));
        if (!ok) throw new Error('not opened');
        setStatus(done, status);
    } catch {
        setStatus('optionsHomeOpenFailed', status);
    }
}
$('customizeBtn').addEventListener('click', () => { void openDashboard('edit'); });
$('appearanceBtn').addEventListener('click', () => { void openDashboard('appearance'); });

$('clearHistoryBtn').addEventListener('click', async () => { await store.remove(keys.history); setStatus('optionsHistoryCleared'); });
$('importBtn').addEventListener('click', () => importFile.click());
$('onboardingBtn').addEventListener('click', async () => {
    await store.set(keys.reopen, true);
    await openDashboard('open', helpStatus, 'optionsOnboardingOpening');
});
const deadlinesHome = $('deadlinesHomeBtn');
deadlinesHome.addEventListener('click', () => { void openDashboard('edit'); });

function renderLocale() {
    localizePage();
    // Reuse the real button so its action survives translation and the link can move in the sentence.
    const [before, after] = t('optionsDeadlinesWidget').split('{home}');
    $('deadlinesHomeDesc').replaceChildren(before, deadlinesHome, after);
    renderThemeValue();
    for (const [target, { render }] of statuses) target.textContent = render();
    renderStats();
    renderProgress();
    renderLastRuns();
}

async function init() {
    try { await setup(); }
    finally { document.body.hidden = false; }
    void refreshStats();
}

async function setup() {
    await initLocale();
    let language = await store.get(keys.language).catch(() => 'auto' as const);
    languageSelect.value = language;
    store.watch(keys.language, value => { languageSelect.value = language = value; });
    languageSelect.addEventListener('change', async () => {
        const value = languageSelect.value;
        if (value !== 'auto' && value !== 'de' && value !== 'en') return;
        try { await store.set(keys.language, value); setStatus(null, generalStatus); }
        catch {
            languageSelect.value = language;
            setStatus('optionsSaveFailed', generalStatus);
        }
    });
    applyPageTheme(await store.get(keys.theme).catch(() => undefined));
    store.watch(keys.theme, applyPageTheme);
    $('version').textContent = chrome.runtime.getManifest().version;
    onLocaleChange(renderLocale);
    renderLocale();
}
void init();
