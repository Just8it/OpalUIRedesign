import { tufastActions, clickTufast } from './tufast';
import { t } from './i18n/messages/search.ts';
import { store } from './storage/store.ts';
import { openFile } from './core/file-opening';
import { keys } from './storage/registry.ts';
import { availableChips, selectedChip, filterMaterials, pairedSolution } from './command-center/materials';
import { nodesByCourse, recordVisit } from './core/search-engine';
import { createResultRenderer } from './command-center/render';
import { createProviders } from './command-center/providers';
import { createNavigation } from './command-center/navigation';
import { openExtensionOptions } from './extension-options';
import { openSurface, closeSurface, enter } from './motion';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Command Center (Ctrl+K)
   Search overlay for courses, files, and folders. Queries go to the
   background index by message, so replies are async and may arrive
   out of order; a sequence number drops stale ones.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { bindDialogKeyboard } from './settings';
import type { CourseItem } from './types';
import { clearIndex, type IndexNode, type SearchResult } from './core/search-engine';
import { PROGRESS_DONE_VISIBLE_MS, PROGRESS_STALE_MS, readProgress, type IndexProgress } from './core/index-progress';
import { refreshFavoriteIndex } from './indexer';

import { applyTheme, loadTheme, saveTheme, type ThemeMode } from './theme';
import { isCourseViewEnabled, setCourseViewEnabled } from './course/loader';

/* ── Module state ─────────────────────────────────────────────── */

/** Reference to main.ts's favoriteCourses map (passed in via bindCommandCenter). */
let _favorites: Map<string, CourseItem> = new Map();

/** Short: every keystroke is a message round trip, stale replies are dropped. */
const SEARCH_DEBOUNCE_MS = 40;
const RECENTS_LIMIT = 6;

/* ── Search History ───────────────────────────────────────────── */


const HISTORY_MAX = 10;

async function loadHistory(): Promise<string[]> {
    return store.get(keys.history);
}

async function saveToHistory(query: string): Promise<void> {
    if (!query) return;
    const hist = await loadHistory();
    const deduped = hist.filter(q => q.toLowerCase() !== query.toLowerCase());
    const updated = [query, ...deduped].slice(0, HISTORY_MAX);
    return store.set(keys.history, updated);
}





/* ── Helpers ──────────────────────────────────────────────────── */

function getActiveCourseId(): string {
    const isHome = (
        location.pathname.startsWith('/opal/home') ||
        location.pathname === '/opal/' ||
        location.pathname === '/opal'
    );
    if (isHome) return '';
    const firstCrumb = document.querySelector<HTMLAnchorElement>(
        '.o_breadcrumb a, nav.breadcrumb a, [class*="breadcrumb"] a'
    );
    if (firstCrumb) {
        try {
            const u = new URL(firstCrumb.href);
            return (u.pathname + u.search).replace(/\/$/, '');
        } catch { return ''; }
    }
    return '';
}




function asResult(node: IndexNode, score = 0): SearchResult {
    return { node, score, path: [], explanation: [] };
}

/** Synthetic rows (actions, OPAL search) are not index nodes and never count as visits. */
function isSyntheticNode(node: IndexNode): boolean {
    return node.id.startsWith('__opal-');
}

/* ── Highlighting ─────────────────────────────────────────────── */

/** Lowercase and strip diacritics one UTF-16 unit at a time, so the folded
 *  string keeps the original's indices (ä→a, ß→s). */


/** Query words worth marking: no type prefix, no ext:/type: syntax. */


/** "uebung" should also mark "Übung": try the umlaut-transcribed form too. */


/** Escape first, then wrap the matched ranges in <mark>. */


/* ── Actions ──────────────────────────────────────────────────── */

interface CommandAction {
    id: string;
    title: string;
    subtitle: string;
    keywords: string[];
    run: () => void | Promise<void>;
}

let explainRanking = false;
void store.get(keys.explainRanking).then(value => { explainRanking = value; });
store.watch(keys.explainRanking, value => { explainRanking = value; });
// Palette titles name the action the click performs, so they follow the stored state.
let courseViewOn = false;
void store.get(keys.courseView).then(value => { courseViewOn = value; });
store.watch(keys.courseView, value => { courseViewOn = value; });
function toggleRanking(): void {
    explainRanking = !explainRanking;
    void store.set(keys.explainRanking, explainRanking);
}
const COMMAND_ACTIONS: CommandAction[] = [
    {
        id: 'refresh-index',
        get title() { return t('commandRefreshFiles'); },
        get subtitle() { return t('commandRefreshFilesHint'); },
        keywords: ['index', 'suchindex', 'aktualisieren', 'dateien'],
        run: refreshFavoriteIndex,
    },
    {
        id: 'explain-ranking',
        get title() { return t(explainRanking ? 'commandHideRanking' : 'commandShowRanking'); },
        get subtitle() { return t('commandRankingHint'); },
        keywords: ['ranking', 'score', 'bewertung', 'anzeigen'],
        run: toggleRanking,
    },
    {
        id: 'open-options',
        get title() { return t('commandOptions'); },
        get subtitle() { return t('commandOptionsHint'); },
        keywords: ['settings', 'optionen', 'einstellungen', 'daten', 'export', 'import'],
        run: openExtensionOptions,
    },
    {
        id: 'clear-search-index',
        get title() { return t('commandClearIndex'); },
        get subtitle() { return t('commandClearIndexHint'); },
        keywords: ['clear', 'cache', 'index', 'suche', 'daten löschen'],
        run: () => clearIndex(),
    },
    {
        id: 'toggle-theme',
        get title() { return t('commandTheme'); },
        get subtitle() { return t('commandThemeHint'); },
        keywords: ['theme', 'dark', 'light', 'oled', 'design'],
        run: async () => {
            const order: ThemeMode[] = ['dark', 'light', 'oled'];
            const current = await loadTheme();
            const nextMode = order[(order.indexOf(current.mode) + 1) % order.length];
            const next = { ...current, mode: nextMode };
            await saveTheme(next);
            applyTheme(next);
        },
    },
    {
        // Course pages follow the switch live (src/course/view.ts listens to storage).
        id: 'toggle-course-view',
        get title() { return t(courseViewOn ? 'commandDisableCourseView' : 'commandEnableCourseView'); },
        get subtitle() { return t('commandCourseViewHint'); },
        keywords: ['kursansicht', 'kurs', 'ansicht', 'dateien', 'abschnitte', 'einschalten', 'ausschalten'],
        run: async () => setCourseViewEnabled(!await isCourseViewEnabled()),
    },
    {
        id: 'reload-opal',
        get title() { return t('commandReload'); },
        get subtitle() { return t('commandReloadHint'); },
        keywords: ['reload', 'refresh', 'neu laden', 'aktualisieren'],
        run: () => window.location.reload(),
    },
];

function commandActions(): CommandAction[] {
    return [...COMMAND_ACTIONS, ...tufastActions().map(a => ({ id: 'tufast-' + a.id, title: t('commandTufast', { label: a.label }), subtitle: a.disabled ? t('commandUnavailable') : a.title, keywords: ['tufast'], run: () => clickTufast(a.id) }))];
}
function actionToResult(action: CommandAction): SearchResult {
    return asResult({
        id: `__opal-action-${action.id}`,
        title: action.title,
        url: `opal-action:${action.id}`,
        type: 'action',
        courseId: '',
        parentId: null,
        lastVisited: 0,
        visitCount: 0,
        description: action.subtitle,
    }, 10_000);
}

export function parseCommandQuery(query: string): { commandMode: boolean; query: string } {
    const trimmed = query.trimStart();
    return { commandMode: trimmed.startsWith('>'), query: trimmed.startsWith('>') ? trimmed.slice(1).trim() : query.trim() };
}

function findCommandActions(query: string): SearchResult[] {
    const parsed = parseCommandQuery(query);
    if (!parsed.commandMode) return [];
    const q = parsed.query.toLowerCase();
    return commandActions().filter(action => [action.title, action.subtitle, ...action.keywords]
        .some(text => text.toLowerCase().includes(q))).map(actionToResult);
}

/** Muted second line: the ancestor path, else what the row is. */






/** Empty query: what the user opened recently, then recent searches. */


/** Render the drill-down header + sectioned results. */


/** Slim strip under the input while a crawler runs, and briefly after. */


/* ── Public API ───────────────────────────────────────────────── */

/** `initialQuery` prefills the field and searches right away (course view: "In ganz OPAL suchen"). */
const { highlightTokens, renderCmdResults, renderHome, renderDrillView, renderProgress } = createResultRenderer({ get explainRanking() { return explainRanking; }, isSyntheticNode });

export function openCommandCenter(initialQuery = ''): void {
    try {
        _openCommandCenter(initialQuery);
    } catch (err) {
        console.error('[OPAL] Command Center error:', err);
    }
}

function _openCommandCenter(initialQuery: string): void {
    if (document.getElementById('opal-cmd-overlay')) return;
    const courseId = getActiveCourseId();

    const overlay = document.createElement('div');
    overlay.id = 'opal-cmd-overlay';
    const s = overlay.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('top', '0', 'important');
    s.setProperty('right', '0', 'important');
    s.setProperty('bottom', '0', 'important');
    s.setProperty('left', '0', 'important');
    s.setProperty('z-index', '2147483647', 'important');
    s.setProperty('display', 'flex', 'important');
    s.setProperty('visibility', 'visible', 'important');
    s.setProperty('pointer-events', 'all', 'important');
    s.setProperty('align-items', 'flex-start', 'important');
    s.setProperty('justify-content', 'center', 'important');
    s.setProperty('padding-top', '12vh', 'important');
    s.setProperty('background', 'var(--color-opal-overlay)', 'important');
    overlay.innerHTML = `
        <div id="opal-cmd-panel" class="opal-cmd-panel" role="dialog" aria-modal="true" aria-label="${t('dialogLabel')}">
          <div class="opal-cmd-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input id="opal-cmd-input" class="opal-cmd-input" type="text" autocomplete="off" spellcheck="false"
                   aria-label="${t('inputLabel')}" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="opal-cmd-results"
                   placeholder="${t('inputPlaceholder')}"
                   style="outline:none;">
            <kbd class="opal-kbd">Esc</kbd>
          </div>
          <div id="opal-cmd-chips" role="radiogroup" aria-label="${t('materialLabel')}"></div>
          <div id="opal-cmd-progress" class="opal-cmd-progress" hidden></div>
          <div id="opal-cmd-results" class="opal-cmd-results" role="listbox" aria-label="${t('resultsLabel')}"></div>
          <div class="opal-cmd-footer">
            <span class="opal-cmd-hints">
              <span class="opal-cmd-hint"><kbd class="opal-kbd">↑↓</kbd> ${t('hintSelect')}</span>
              <span class="opal-cmd-hint"><kbd class="opal-kbd">↵</kbd> ${t('hintOpen')}</span>
              <span class="opal-cmd-hint"><kbd class="opal-kbd">⇧↵</kbd> ${t('hintFolder')}</span>
              <span class="opal-cmd-hint"><kbd class="opal-kbd">Tab</kbd> ${t('hintFilter')}</span>
            </span>
            <span class="opal-cmd-hints opal-cmd-hints-secondary">
              <span class="opal-cmd-hint"><kbd class="opal-kbd">&gt;</kbd> ${t('hintCommands')}</span>
              <span class="opal-cmd-hint"><kbd class="opal-kbd">/c</kbd> ${t('hintCourses')}</span>
              <span class="opal-cmd-hint"><kbd class="opal-kbd">/f</kbd> ${t('hintFiles')}</span>
            </span>
          </div>
        </div>`;

    document.body.appendChild(overlay);
    openSurface(overlay);

    const input      = document.getElementById('opal-cmd-input') as HTMLInputElement;
    const resultsEl  = document.getElementById('opal-cmd-results') as HTMLElement;
    const progressEl = document.getElementById('opal-cmd-progress') as HTMLElement;
    let allResults: SearchResult[] = [];
    let category = selectedChip(initialQuery);
    let solutionNodes: IndexNode[] = [];
    const openSolution = () => {
        const n = results[selectedIdx]?.node;
        const solution = n && pairedSolution(n, solutionNodes);
        if (!solution) return;
        void recordVisit(solution.id);
        void openFile(solution.url).then(handled => { if (!handled) window.location.assign(solution.url); });
        close();
    };
    let results: SearchResult[]   = [];
    let selectedIdx                = 0;
    let tokens: string[]           = [];
    let debounce: number | undefined;
    let closed = false;
    /** Bumped by every view change; an async reply for an older value is dropped. */
    let viewSeq = 0;

    // ── View state ────────────────────────────────────────────────
    type CmdMode = 'home' | 'search' | 'drill';
    let mode: CmdMode = 'home';
    let homeHistory: string[] = [];
    let drillCourse: IndexNode | null = null;
    let drillFileCount = 0;

    // ── Progress strip ────────────────────────────────────────────
    let progress: IndexProgress | null = null;
    let progressTimer: number | undefined;

    const updateProgress = () => {
        clearTimeout(progressTimer);
        const now = Date.now();
        renderProgress(progressEl, progress, now);
        // Re-check when the record turns stale or the "done" line should go.
        if (progress?.status === 'running') {
            progressTimer = window.setTimeout(() => {
                progress = readProgress(progress);
                updateProgress();
            }, Math.max(1000, progress.updatedAt + PROGRESS_STALE_MS - now + 50));
        } else if (progress?.status === 'done' && !progressEl.hidden) {
            progressTimer = window.setTimeout(updateProgress, Math.max(50, progress.updatedAt + PROGRESS_DONE_VISIBLE_MS - now + 50));
        }
    };

    const stopProgress = store.watch(keys.progress, value => {
        progress = readProgress(value);
        updateProgress();
    });
    store.get(keys.progress).then(value => {
        if (closed) return;
        progress = readProgress(value);
        updateProgress();
    }).catch(() => { });

    let releaseFocus: (() => void) | null = null;
    const close = () => {
        if (closed) return;
        closed = true;
        viewSeq++;
        clearTimeout(debounce);
        clearTimeout(progressTimer);
        stopProgress();
        input.setAttribute('aria-expanded', 'false');
        void closeSurface(overlay, () => releaseFocus?.());
    };

    let confirmingClear = false;
    const { openSelected, navigate } = createNavigation({ get confirmingClear() { return confirmingClear; },
        set confirmingClear(value) { confirmingClear = value; },
        get rerender() { return rerender; },
        get close() { return close; },
        get results() { return results; },
        set results(value) {
            allResults = value; results = filterMaterials(value, category);
            const ids = [...new Set(value.filter(r => r.node.category === 'exercise').map(r => r.node.courseId))];
            void Promise.all(ids.map(id => nodesByCourse(id, 'file'))).then(groups => {
                if (allResults !== value || closed) return;
                solutionNodes = groups.flat(); rerender();
            });
        },
        get selectedIdx() { return selectedIdx; },
        set selectedIdx(value) { selectedIdx = value; },
        get resultsEl() { return resultsEl; },
        get input() { return input; },
        get mode() { return mode; },
        set mode(value) { mode = value; },
        get enterDrillMode() { return enterDrillMode; },
        get COMMAND_ACTIONS() { return commandActions(); },
        get toggleRanking() { return toggleRanking; },
        get saveToHistory() { return saveToHistory; },
        get isSyntheticNode() { return isSyntheticNode; } });

    let firstResults = true;
    const rerender = () => {
        const options = availableChips(allResults);
        if (!options.some(([key]) => key === category)) category = 'all';
        results = filterMaterials(allResults, category);
        selectedIdx = Math.min(selectedIdx, Math.max(0, results.length - 1));
        const chipEl = document.getElementById('opal-cmd-chips')!;
        chipEl.innerHTML = mode === 'search' ? options.map(([key, label]) => `<button type="button" role="radio" aria-checked="${category === key}" tabindex="${category === key ? 0 : -1}" data-material="${key}">${label}</button>`).join('') : '';

        if (mode === 'drill' && drillCourse) {
            resultsEl.innerHTML = renderDrillView(drillCourse.title, results, selectedIdx, drillFileCount);
        } else if (mode === 'home') {
            resultsEl.innerHTML = renderHome(results, homeHistory, courseId, selectedIdx);
        } else {
            resultsEl.innerHTML = renderCmdResults(confirmingClear ? results.map(r => r.node.url === 'opal-action:clear-search-index'
                ? { ...r, node: { ...r.node, title: t('commandConfirmClear') } } : r) : results, courseId, selectedIdx, tokens);
        }
        results.forEach((r, i) => {
            if (!pairedSolution(r.node, solutionNodes)) return;
            const button = document.createElement('button'); button.type = 'button'; button.className = 'opal-btn'; button.textContent = t('solution'); button.title = t('solutionTitle');
            button.addEventListener('click', e => { e.stopPropagation(); selectedIdx = i; openSolution(); });
            resultsEl.querySelector(`#opal-cmd-option-${i}`)?.append(button);
        });
        if (firstResults) { firstResults = false; void enter(resultsEl); }
        const selected = resultsEl.querySelector<HTMLElement>(`#opal-cmd-option-${selectedIdx}`);
        if (selected) input.setAttribute('aria-activedescendant', selected.id);
        else input.removeAttribute('aria-activedescendant');

    };



    // ── Home view (empty query) ───────────────────────────────────

    const { showHome, enterDrillMode, runSearch } = createProviders({ get viewSeq() { return viewSeq; },
        set viewSeq(value) { viewSeq = value; },
        get closed() { return closed; },
        set closed(value) { closed = value; },
        get mode() { return mode; },
        set mode(value) { mode = value; },
        get tokens() { return tokens; },
        set tokens(value) { tokens = value; },
        get homeHistory() { return homeHistory; },
        set homeHistory(value) { homeHistory = value; },
        get results() { return results; },
        set results(value) {
            allResults = value; results = filterMaterials(value, category);
            const ids = [...new Set(value.filter(r => r.node.category === 'exercise').map(r => r.node.courseId))];
            void Promise.all(ids.map(id => nodesByCourse(id, 'file'))).then(groups => {
                if (allResults !== value || closed) return;
                solutionNodes = groups.flat(); rerender();
            });
        },
        get selectedIdx() { return selectedIdx; },
        set selectedIdx(value) { selectedIdx = value; },
        get rerender() { return rerender; },
        get debounce() { return debounce; },
        set debounce(value) { debounce = value; },
        get input() { return input; },
        get drillCourse() { return drillCourse; },
        set drillCourse(value) { drillCourse = value; },
        get drillFileCount() { return drillFileCount; },
        set drillFileCount(value) { drillFileCount = value; },
        get courseId() { return courseId; },
        get RECENTS_LIMIT() { return RECENTS_LIMIT; },
        get loadHistory() { return loadHistory; },
        get asResult() { return asResult; },
        get parseCommandQuery() { return parseCommandQuery; },
        get findCommandActions() { return findCommandActions; },
        get _favorites() { return _favorites; },
        set _favorites(value) { _favorites = value; },
        get highlightTokens() { return highlightTokens; } });

    // ── Drill-down enter / exit ───────────────────────────────────



    // ── Open selected item ────────────────────────────────────────



    // ── Input handler ─────────────────────────────────────────────



    input.addEventListener('input', () => {
        category = selectedChip(input.value);
        confirmingClear = false;
        clearTimeout(debounce);
        // Invalidate in-flight replies right away, not only when the debounce fires.
        viewSeq++;

        // Typing while in drill mode → leave it and search normally
        if (mode === 'drill') {
            mode = 'search';
            drillCourse = null;
            drillFileCount = 0;
        }

        debounce = window.setTimeout(() => {
            const q = input.value.trim();
            if (!q) void showHome();
            else void runSearch(q);
        }, SEARCH_DEBOUNCE_MS);
    });

    // ── Keyboard navigation ───────────────────────────────────────

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && mode === 'search') { const options = availableChips(allResults); e.preventDefault(); e.stopPropagation(); category = options[(options.findIndex(([key]) => key === category) + (e.shiftKey ? -1 : 1) + options.length) % options.length][0]; selectedIdx = 0; rerender(); return; }
        if (e.altKey && e.key === 'Enter') { e.preventDefault(); openSolution(); return; }
        if (e.altKey && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleRanking(); rerender(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); navigate(+1); }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); navigate(-1); }
        else if (e.key === 'Enter')     { e.preventDefault(); void openSelected(e.shiftKey); }
    });

    // ── Click handlers ────────────────────────────────────────────

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { close(); return; }
        const target = e.target as HTMLElement;
        const chip = target.closest<HTMLElement>('[data-material]');
        if (chip) { category = chip.dataset.material!; selectedIdx = 0; rerender(); input.focus(); return; }
        const historyItem = target.closest<HTMLElement>('.opal-cmd-history-item');
        if (historyItem) {
            input.value = historyItem.dataset.query ?? '';
            input.dispatchEvent(new Event('input'));
            input.focus();
            return;
        }
        const item = target.closest<HTMLElement>('.opal-cmd-result');
        if (item) {
            e.preventDefault();
            const idx = Array.from(resultsEl.querySelectorAll('.opal-cmd-result')).indexOf(item);
            if (idx >= 0) selectedIdx = idx;
            void openSelected(!!target.closest('[data-folder]'));
        }
    });

    releaseFocus = bindDialogKeyboard(overlay, () => {
        if (confirmingClear) { confirmingClear = false; rerender(); input.focus(); }
        else close();
    }, input);

    if (initialQuery) input.value = initialQuery;
    // Text typed before the palette finished opening must not be overwritten by the start view.
    if (input.value.trim()) void runSearch(input.value.trim());
    else void showHome();
    requestAnimationFrame(() => input.focus());
}

/** Register Ctrl+K shortcut. Pass the same favoriteCourses Map from main.ts (by reference). */
export function bindCommandCenter(favorites: Map<string, CourseItem>): void {
    _favorites = favorites;
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            e.stopPropagation();
            openCommandCenter();
        }
    }, true);
}

// Module registration also runs on course pages where dashboard binding is skipped.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.channel !== 'opal-command' || message.op !== 'open') return;
    openCommandCenter();
    reply({ ok: true });
});
