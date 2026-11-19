import { homeBlockTitle } from '../home/config.ts';
import { t } from '../../i18n/messages/course.ts';
import { formatDate } from '../../i18n/core.ts';
import { store } from '../../storage/store.ts';
import { keys, families } from '../../storage/registry.ts';
import { openFile, prefersDownload } from '../../core/file-opening';
import { isStableFileUrl } from '../../core/index-messages';
import { entriesSignature } from './snapshot';
import { snapshotIndexNodes } from '../index-nodes.ts';
import { upsertNode, flushUpserts } from '../../core/search-engine';
/* Owns controller for the course view. */
import { createHomePane } from './home-pane';
import { nodeIds } from './snapshot';
import { toElement, focusKey, byFocusKey, keepFocus, isEditable } from './focus';

import { createDrag } from './drag';
import { createKeyboard } from './keyboard';
import { createReconcile } from './reconcile';
import { createListPane } from './list-pane';
import { createSidebar } from './sidebar';
import { createEditMode } from './edit-mode';
import { createSearch } from './search';
import { createProgress } from './progress';
import type { CourseAnnouncement, CourseLoadHandle, CourseLoadState, CourseSection, CourseSnapshot } from '../types.ts';

import { loadCourse, LOGIN_ERROR, loadErrorMessage } from '../loader';
import { RELOGIN_URL } from '../../tufast';
import { rememberRootId, setPrefersOriginal } from '../route';
import { loadOpened, type Located, type OpenedMap } from '../find/index';
import {
    defaultLayout,
    normaliseLayout,
    normalisePrefs,
    type BrowseLayout,
    type BrowsePrefs,
    type ListModel,
    type NavBlock,
    type Sort,
    type SortKey,
} from '../browse/index';
import {
    defaultHome,
    normaliseProgress,
    toggleDone,
    setPointer,
    togglePin,
    moveBlock,
    updateBlock,
    addBlock,
    removeBlock,
    blockSelectionId,
    saveHome,
    loadProgress,
    saveProgress,
} from '../home/index';
import type { HomeConfig, HomeModel } from '../home/types.ts';

import { type HomeRenderState } from '../render/home-shared';

import { FIND_ID, LIST_ID } from '../render/find-field';
import { NAV_ID, NAV_TOGGLE_ID, selectableIds } from '../render/sidebar';
import { listColumns, nextSort, sortLabel } from '../render/list-head';
import { groupSignature } from '../render/list';

import { EDIT_BAR_ID } from '../render/edit-bar';

import { openThemeEditor } from '../../theme-editor';
import { confirmDialog } from '../../settings';

import { enter, exit, swap, collapse, slideIndicator, pressable, reorder } from '../../motion';
import { openCommandCenter } from '../../command-center';
import { sortable } from '../drag';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    courseId: string;
    prefsKey: (id: string) => string;
    LAYOUT_KEY: string;
    ORDER: Sort;
    bannerKey: (id: string) => string;
    current: { destroy(): void } | null;
    mounting: boolean;
    fail: (message: string) => void;
    teardown: () => void;
    showFab: (mode: 'link' | 'mount', error?: string) => void;
}

export function createController(context: Context) {
    prefersDownload(); // read the download setting now, so the first click already knows it
    function createView(root: HTMLElement) {
        const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`) as T;
        const titleEl = $('opal-course-title');
        const metaText = $('opal-course-meta-text');
        const progress = $('opal-course-progress');
        const progressFill = $('opal-course-progress-fill');
        const status = $('opal-course-status');
        const findInput = $<HTMLInputElement>(FIND_ID);
        const editBar = $(EDIT_BAR_ID);
        const nav = $(NAV_ID);
        const navToggle = $(NAV_TOGGLE_ID);
        const navToggleValue = $('opal-course-nav-toggle-v');
        const banner = $('opal-course-banner');
        const paneTitle = $('opal-course-pane-title');
        const paneSummary = $('opal-course-pane-summary');
        const globalSearch = $('opal-course-search-global');
        const table = $(LIST_ID);
        const thead = $('opal-course-thead');
        const emptyBox = $('opal-course-empty');
        const loadError = $('opal-course-load-error');
        const annBox = $('opal-course-anns');
        const docBox = $('opal-course-doc');
        /** Pages whose text the student unfolded (list intros and the page reader), remembered per course. */
        const introOpen = { has: (id: string) => !!prefs.open?.includes(id) };
        const pane = root.querySelector<HTMLElement>('.opal-course-pane') as HTMLElement;
        const paneHead = root.querySelector<HTMLElement>('.opal-course-pane-head') as HTMLElement;
        const indicator = document.createElement('span');
        indicator.className = 'opal-course-nav-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        let indicatorItem: string | undefined;
        const syncIndicator = () => {
            const selected = nav.querySelector<HTMLElement>('[aria-current="true"]');
            if (!selected) {
                indicator.remove();
                return;
            }
            const moved = indicatorItem !== selected.dataset.nav;
            const target = selected.getBoundingClientRect();
            if (indicator.isConnected && moved) {
                void slideIndicator(indicator, target, () => selected.parentElement?.append(indicator));
            } else selected.parentElement?.append(indicator);
            indicatorItem = selected.dataset.nav;
        };
        pressable(root);
        for (const el of [root.querySelector<HTMLElement>('.opal-course-header'), nav, pane]) if (el) void enter(el);
        const topbar = root.querySelector<HTMLElement>('.opal-topbar');

        /* Remembered: layout for all courses, prefs per course. */
        let layout: BrowseLayout = defaultLayout();
        let prefs: BrowsePrefs = { order: [], hidden: [], collapsed: [] };
        /** Stored prefs waiting for the node ids they are checked against. */
        let storedPrefs: unknown = null;
        let prefsIds = '';
        let bannerSeen = '';

        let snapshot: CourseSnapshot | null = null;
        let load: CourseLoadState | null = null;
        let lastPhase = '';
        let frame = 0;
        /** Last fetched state of each section: a refresh restarts sections as
         *  'pending', and the old content stays on screen until the new arrives. */
        const lastGood = new Map<string, CourseSection>();
        let lastAnnouncements: CourseAnnouncement[] = [];
        let located: Located[] = [];
        let locatedSig = '';
        let opened: OpenedMap = {};
        let navBlocks: NavBlock[] = [];
        let shown = 'home';
        let selected = 'home';
        let homeConfig: HomeConfig | null = null;
        let rawHome: unknown;
        let homeReady = false;
        let homeProgress = normaliseProgress(null);
        let homeModel: HomeModel = { blocks: [], hidden: [], addable: [], empty: true };
        const homeBox = $('opal-course-home-view');
        const hintKey = families.homeHintDismissed(context.courseId);
        let hint = false;
        let homeEntered = false;
        const homeState: HomeRenderState = {
            progress: homeProgress,
            expanded: new Set(),
            editing: false,
            rename: '',
            adding: false,
            previousVisit: 0,
        };
        const persistHome = () => {
            if (homeConfig) void saveHome(context.courseId, homeConfig);
        };
        const persistProgress = () => {
            void saveProgress(context.courseId, homeProgress);
        };

        let model: ListModel | null = null;
        let freshBanner: CourseAnnouncement | null = null;

        let editing = false;
        let navOpen = false;
        let navFocus = '';
        let query = '';
        /** Highlighted search hit (keyboard), by url so it survives updates. */
        let activeUrl = '';
        let savedScroll: number | null = null;
        let scrollAtFocus: number | null = null;
        let announceTimer = 0;
        const boxSigs: Record<string, string> = {};
        const groupSigs = new Map<string, string>();
        const annExpanded = new Set<string>();

        const announce = (text: string, delay = 0) => {
            clearTimeout(announceTimer);
            announceTimer = window.setTimeout(() => {
                status.textContent = text;
            }, delay);
        };

        const persistPrefs = () => {
            try {
                void store.set(families.prefs(context.courseId), prefs).catch(() => {});
            } catch {
                /* context gone */
            }
        };
        const persistLayout = () => {
            try {
                void store.set(keys.courseLayout, layout).catch(() => {});
            } catch {
                /* context gone */
            }
        };

        const { setBox, reconcileGroups } = createReconcile({
            get boxSigs() { return boxSigs; },
            get indicator() { return indicator; },
            get syncIndicator() { return syncIndicator; },
            get table() { return table; },
            get thead() { return thead; },
            get groupSigs() { return groupSigs; },
            get keepFocus() { return keepFocus; },
            get toElement() { return toElement; },
        });

        /** Keyed update of the table's rowgroups after the column header. */

        const effectiveSections = (snap: CourseSnapshot): CourseSection[] =>
            snap.sections.map((s) => {
                if (s.state !== 'pending' && s.state !== 'error') {
                    lastGood.set(s.nodeId, s);
                    return s;
                }
                const known = lastGood.get(s.nodeId);
                return known && s.state === 'error' ? { ...known, error: s.error, incomplete: true } : known ?? s;
            });

        /** Check the stored prefs against the course's node ids once they are known. */
        const ensurePrefs = (snap: CourseSnapshot) => {
            const ids = nodeIds(snap);
            const sig = ids.join(',');
            if (sig === prefsIds && storedPrefs === null) return;
            prefsIds = sig;
            prefs = normalisePrefs(storedPrefs ?? prefs, ids);
            storedPrefs = null;
        };

        const selection = (): string => {
            const wanted = selected;
            return selectableIds(navBlocks).includes(wanted) ? wanted : 'all';
        };

        /* ── Search highlight ── */
        const { hitRows, applyActive, markOpened, openActive, setQuery, resetFind } = createSearch({
            get table() { return table; },
            get query() { return query; },
            set query(value) { query = value; },
            get activeUrl() { return activeUrl; },
            set activeUrl(value) { activeUrl = value; },
            get opened() { return opened; },
            set opened(value) { opened = value; },
            get snapshot() { return snapshot; },
            set snapshot(value) { snapshot = value; },
            get navBlocks() { return navBlocks; },
            set navBlocks(value) { navBlocks = value; },
            get located() { return located; },
            set located(value) { located = value; },
            get prefs() { return prefs; },
            set prefs(value) { prefs = value; },
            get editing() { return editing; },
            set editing(value) { editing = value; },
            get setBox() { return setBox; },
            get nav() { return nav; },
            get shown() { return shown; },
            set shown(value) { shown = value; },
            get syncRoving() { return syncRoving; },
            get savedScroll() { return savedScroll; },
            set savedScroll(value) { savedScroll = value; },
            get scrollAtFocus() { return scrollAtFocus; },
            set scrollAtFocus(value) { scrollAtFocus = value; },
            get root() { return root; },
            get pane() { return pane; },
            get render() { return render; },
            get announce() { return announce; },
            get model() { return model; },
            set model(value) { model = value; },
            get findInput() { return findInput; },
            get selected() { return selected; },
            set selected(value) { selected = value; },
            get courseId() { return context.courseId; },
            set courseId(value) {
                context.courseId = value;
            },
        });

        /* ── Render ── */
        const { updateProgress } = createProgress({
            get load() { return load; },
            set load(value) { load = value; },
            get progress() { return progress; },
            get progressFill() { return progressFill; },
        });

        /** `headInTable` false keeps the pane title above a page's text instead of inside the column header. */
        const { renderAnnouncements, renderList } = createListPane({
            get setBox() { return setBox; },
            get thead() { return thead; },
            get paneHead() { return paneHead; },
            get docBox() { return docBox; },
            get pane() { return pane; },
            get table() { return table; },
            get model() { return model; },
            set model(value) { model = value; },
            get emptyBox() { return emptyBox; },
            get annBox() { return annBox; },
            get globalSearch() { return globalSearch; },
            get paneTitle() { return paneTitle; },
            get paneSummary() { return paneSummary; },
            get annExpanded() { return annExpanded; },
            get prefs() { return prefs; },
            set prefs(value) { prefs = value; },
            get located() { return located; },
            set located(value) { located = value; },
            get opened() { return opened; },
            set opened(value) { opened = value; },
            get query() { return query; },
            set query(value) { query = value; },
            get layout() { return layout; },
            set layout(value) { layout = value; },
            get introOpen() { return introOpen; },
            get reconcileGroups() { return reconcileGroups; },
            get boxSigs() { return boxSigs; },
            get homeConfig() { return homeConfig; },
            set homeConfig(value) { homeConfig = value; },
            get homeProgress() { return homeProgress; },
            set homeProgress(value) { homeProgress = value; },
            get applyActive() { return applyActive; },
            get ORDER() { return context.ORDER; },
        });

        const { render } = createHomePane({
            get frame() { return frame; },
            set frame(value) { frame = value; },
            get updateProgress() { return updateProgress; },
            get root() { return root; },
            get layout() { return layout; },
            set layout(value) { layout = value; },
            get snapshot() { return snapshot; },
            set snapshot(value) { snapshot = value; },
            get table() { return table; },
            get homeBox() { return homeBox; },
            get paneTitle() { return paneTitle; },
            get homeConfig() { return homeConfig; },
            set homeConfig(value) { homeConfig = value; },
            get effectiveSections() { return effectiveSections; },
            get lastAnnouncements() { return lastAnnouncements; },
            set lastAnnouncements(value) { lastAnnouncements = value; },
            get load() { return load; },
            set load(value) { load = value; },
            get locatedSig() { return locatedSig; },
            set locatedSig(value) { locatedSig = value; },
            get located() { return located; },
            set located(value) { located = value; },
            get ensurePrefs() { return ensurePrefs; },
            get titleEl() { return titleEl; },
            get findInput() { return findInput; },
            get metaText() { return metaText; },
            get homeReady() { return homeReady; },
            set homeReady(value) { homeReady = value; },
            get rawHome() { return rawHome; },
            set rawHome(value) { rawHome = value; },
            get persistHome() { return persistHome; },
            get homeModel() { return homeModel; },
            set homeModel(value) { homeModel = value; },
            get homeProgress() { return homeProgress; },
            set homeProgress(value) { homeProgress = value; },
            get opened() { return opened; },
            set opened(value) { opened = value; },
            get editing() { return editing; },
            set editing(value) { editing = value; },
            get homeState() { return homeState; },
            get navBlocks() { return navBlocks; },
            set navBlocks(value) { navBlocks = value; },
            get prefs() { return prefs; },
            set prefs(value) { prefs = value; },
            get selection() { return selection; },
            get shown() { return shown; },
            set shown(value) { shown = value; },
            get setBox() { return setBox; },
            get nav() { return nav; },
            get syncIndicator() { return syncIndicator; },
            get syncRoving() { return syncRoving; },
            get navToggleValue() { return navToggleValue; },
            get freshBanner() { return freshBanner; },
            set freshBanner(value) { freshBanner = value; },
            get bannerSeen() { return bannerSeen; },
            set bannerSeen(value) { bannerSeen = value; },
            get query() { return query; },
            set query(value) { query = value; },
            get banner() { return banner; },
            get pane() { return pane; },
            get paneHead() { return paneHead; },
            get paneSummary() { return paneSummary; },
            get emptyBox() { return emptyBox; },
            get annBox() { return annBox; },
            get docBox() { return docBox; },
            get globalSearch() { return globalSearch; },
            get hint() { return hint; },
            set hint(value) { hint = value; },
            get homeEntered() { return homeEntered; },
            set homeEntered(value) { homeEntered = value; },
            get renderAnnouncements() { return renderAnnouncements; },
            get renderList() { return renderList; },
            get savedScroll() { return savedScroll; },
            set savedScroll(value) { savedScroll = value; },
            get lastPhase() { return lastPhase; },
            set lastPhase(value) { lastPhase = value; },
            get announce() { return announce; },
        });

        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(render);
        };

        /* ── Sidebar: roving focus, selection, narrow popover ── */
        const { navItems, syncRoving, setNavOpen, dismissBanner, select } = createSidebar({
            get nav() { return nav; },
            get navFocus() { return navFocus; },
            set navFocus(value) { navFocus = value; },
            get navOpen() { return navOpen; },
            set navOpen(value) { navOpen = value; },
            get navToggle() { return navToggle; },
            get freshBanner() { return freshBanner; },
            set freshBanner(value) { freshBanner = value; },
            get bannerSeen() { return bannerSeen; },
            set bannerSeen(value) { bannerSeen = value; },
            get shown() { return shown; },
            set shown(value) { shown = value; },
            get prefs() { return prefs; },
            set prefs(value) { prefs = value; },
            get selected() { return selected; },
            set selected(value) { selected = value; },
            get persistPrefs() { return persistPrefs; },
            get root() { return root; },
            get activeUrl() { return activeUrl; },
            set activeUrl(value) { activeUrl = value; },
            get pane() { return pane; },
            get render() { return render; },
            get announce() { return announce; },
            get paneTitle() { return paneTitle; },
            get paneSummary() { return paneSummary; },
            get bannerKey() { return context.bannerKey; },
            get courseId() { return context.courseId; },
            set courseId(value) {
                context.courseId = value;
            },
        });

        const { editSection, sectionUnits, placeSectionRow, blockRows, placeHomeRow } = createDrag({
            get navItems() { return navItems; },
            get navBlocks() { return navBlocks; },
            set navBlocks(value) { navBlocks = value; },
            get snapshot() { return snapshot; },
            set snapshot(value) { snapshot = value; },
            get prefs() { return prefs; },
            set prefs(value) { prefs = value; },
            get announce() { return announce; },
            get persistPrefs() { return persistPrefs; },
            get render() { return render; },
            get nav() { return nav; },
            get homeConfig() { return homeConfig; },
            set homeConfig(value) { homeConfig = value; },
            get homeBox() { return homeBox; },
            get persistHome() { return persistHome; },
            get byFocusKey() { return byFocusKey; },
        });

        /* ── Drag to reorder (sidebar sections and overview blocks) ──
         * Keyboard steps go through the same unit model as a drag, so
         * one press always moves the row exactly one visible place. */

        /** Sidebar units: nested sections move among their group; top-level sections move among
         *  top-level sections and whole groups (a group's header and members travel together). */

        const stopNavSort = sortable({
            root: nav,
            grip: '[data-grip]',
            scroller: () => nav,
            row: (grip) => grip.closest<HTMLElement>('li[data-section]'),
            units: sectionUnits,
            onDrop: (row, from, to, tops) => placeSectionRow(row, from, to, tops),
            onStep: (row, delta) => {
                const from = sectionUnits(row).findIndex((u) => u.includes(row));
                placeSectionRow(row, from, from + delta);
            },
        });
        const stopHomeSort = sortable({
            root: homeBox,
            grip: '[data-grip]',
            scroller: () => root,
            row: (grip) => grip.closest<HTMLElement>('li[data-block]'),
            units: blockRows,
            onDrop: (row, from, to, tops) => placeHomeRow(row, from, to, tops),
            onStep: (row, delta) => {
                const from = blockRows(row).findIndex((u) => u.includes(row));
                placeHomeRow(row, from, from + delta);
            },
        });

        /* ── Customising ── */
        const { renderEditBarNow, setEditing } = createEditMode({
            get editBar() { return editBar; },
            get layout() { return layout; },
            set layout(value) { layout = value; },
            get root() { return root; },
            get editing() { return editing; },
            set editing(value) { editing = value; },
            get selected() { return selected; },
            set selected(value) { selected = value; },
            get render() { return render; },
            get announce() { return announce; },
            get paneTitle() { return paneTitle; },
            get keepFocus() { return keepFocus; },
            get toElement() { return toElement; },
        });
        /** Like the dashboard: while customising, the top bar carries Zurücksetzen, Darstellung and Fertig. */

        const onCustomize = () => setEditing(!editing);
        document.addEventListener('opal-customize', onCustomize);

        /* ── Opening entries ── */

        /* ── Search ── */

        /* ── Loader ── */
        let indexedSignature = '';
        const handle: CourseLoadHandle = loadCourse(context.courseId, (snap, state) => {
            if (!context.current && !context.mounting) return;
            if (state.stale) {
                const date = new Date(snap.fetchedAt || snap.partialAt || 0);
                loadError.textContent = t('staleSnapshot', { date: formatDate(date, { dateStyle: 'short', timeStyle: 'short' }) });
                const retry = document.createElement('button');
                retry.type = 'button'; retry.className = 'opal-btn'; retry.textContent = t('retry');
                retry.addEventListener('click', () => handle.refresh());
                loadError.append(retry); loadError.hidden = false;
            } else if (state.phase === 'error') {
                if (!snap.sections.length) {
                    // Defer: the loader may call back synchronously inside loadCourse().
                    queueMicrotask(() => context.fail(state.error ?? ''));
                    return;
                }
                loadError.textContent = state.error ? loadErrorMessage(state.error) : t('loadPartialError');
                if (state.error === LOGIN_ERROR) {
                    const login = document.createElement('a');
                    login.href = RELOGIN_URL;
                    login.textContent = t('relogin');
                    login.className = 'opal-btn';
                    loadError.append(' ', login);
                }
                loadError.hidden = false;
            } else if (state.phase === 'done' && snap.partial) {
                loadError.textContent = t('loadSectionsIncomplete');
                loadError.hidden = false;
            } else {
                loadError.hidden = true;
                loadError.textContent = '';
            }
            if (snap.tree?.kind === 'root' && snap.sections.length > 0) rememberRootId(context.courseId, snap.tree.id);
            if (state.phase === 'done' && !state.stale) {
                const signature = `${snap.courseId}:${snap.fetchedAt}:${entriesSignature(snap.sections)}`;
                if (signature !== indexedSignature) {
                    indexedSignature = signature;
                    for (const node of snapshotIndexNodes(snap)) void upsertNode(node);
                    void flushUpserts();
                }
            }
            snapshot = snap;
            load = state;
            schedule();
        });

        void Promise.all([
            store.get(families.home(context.courseId)),
            loadProgress(context.courseId),
            store.get(hintKey),
        ])
            .then(([config, progress, stored]) => {
                rawHome = config;
                homeProgress = normaliseProgress(progress);
                homeReady = true;
                hint = !config && !stored;
                schedule();
            })
            .catch(() => {
                homeReady = true;
                schedule();
            });
        /* Remembered state arrives after the first paint. */
        void loadOpened(context.courseId)
            .then((map) => {
                opened = { ...map, ...opened };
                schedule();
            })
            .catch(() => {});
        try {
            void Promise.all([store.get(keys.courseLayout), store.get(families.prefs(context.courseId)), store.get(families.announcementSeen(context.courseId))])
                .then(([savedLayout, savedPrefs, savedBanner]) => {
                    layout = normaliseLayout(savedLayout);
                    storedPrefs = savedPrefs;
                    prefsIds = '';
                    bannerSeen =
                        savedBanner;
                    if (editing) renderEditBarNow();
                    schedule();
                })
                .catch(() => {});
        } catch {
            /* extension context gone */
        }

        /* ── Events ── */
        const onRootClick = (e: MouseEvent) => {
            const target = e.target as Element | null;
            if (!target) return;
            const navItem = target.closest<HTMLElement>('[data-nav]');
            if (navItem && nav.contains(navItem)) {
                if (navItem.tagName === 'A') return; // an area: OPAL's page
                select(navItem.dataset.nav ?? 'all');
                return;
            }
            const edit = target.closest<HTMLElement>('[data-edit]');
            if (edit) {
                if (edit.getAttribute('aria-disabled') !== 'true')
                    editSection(edit.dataset.edit ?? '', edit.dataset.id ?? '');
                return;
            }
            if (target.closest(`#${NAV_TOGGLE_ID}`)) {
                setNavOpen(!navOpen);
                return;
            }
            const sortBtn = target.closest<HTMLElement>('[data-sort]');
            if (sortBtn) {
                const next = nextSort(prefs.sort ?? context.ORDER, sortBtn.dataset.sort as SortKey);
                prefs = { ...prefs, sort: next };
                persistPrefs();
                void swap(table, render);
                announce(
                    next.key === 'order'
                        ? sortLabel(next.key)
                        : t(next.dir === 'asc' ? 'sortAscending' : 'sortDescending', { label: sortLabel(next.key) }),
                );
                return;
            }
            // "Mehr" / "Weniger" on a page's text, in a list or above a page's files.
            const intro = target.closest<HTMLElement>('[data-intro], [data-doc-toggle]');
            if (intro) {
                const id = intro.dataset.intro ?? intro.dataset.docToggle ?? '';
                const key = focusKey(intro);
                const open = introOpen.has(id)
                    ? (prefs.open ?? []).filter((o) => o !== id)
                    : [...(prefs.open ?? []), id];
                prefs = { ...prefs, ...(open.length ? { open } : { open: undefined }) };
                persistPrefs();
                render();
                byFocusKey(root, key)?.focus({ preventScroll: true });
                announce(introOpen.has(id) ? t('introExpanded') : t('introCollapsed'));
                return;
            }
            const toggle = target.closest<HTMLElement>('[data-toggle-group]');
            if (toggle) {
                const id = toggle.dataset.toggleGroup ?? '';
                const collapsed = prefs.collapsed.includes(id)
                    ? prefs.collapsed.filter((c) => c !== id)
                    : [...prefs.collapsed, id];
                prefs = { ...prefs, collapsed };
                persistPrefs();
                const group = toggle.closest<HTMLElement>('.opal-course-group') as HTMLElement;
                const open = !collapsed.includes(id);
                toggle.setAttribute('aria-expanded', String(open));
                group.classList.toggle('is-collapsed', !open);
                const body = group.querySelector<HTMLElement>('.opal-course-group-body');
                if (body) void collapse(body, open);
                // Update the signature without replacing the animated rows on loader ticks.
                const g = model?.groups.find((g) => g.id === id);
                if (g && model) {
                    const ctx = {
                        key: group.dataset.group ?? '',
                        cols: listColumns(model, layout.columns),
                        grouped: model.grouped,
                        collapsed: !open,
                        introOpen: introOpen.has(g.id),
                    };
                    groupSigs.set(ctx.key, groupSignature(g, ctx));
                }
                return;
            }
            const openLink = target.closest<HTMLAnchorElement>('a[data-url]');
            if (openLink && (table.contains(openLink) || homeBox.contains(openLink) || docBox.contains(openLink))) {
                markOpened(openLink.dataset.url ?? '');
                // Without direct downloads the link itself opens the file in a new tab (inside the
                // click, so no popup blocker); with them the background downloads it.
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && isStableFileUrl(openLink.href) && prefersDownload()) {
                    e.preventDefault();
                    void openFile(openLink.href, { folder: false }).then(handled => { if (!handled) window.open(openLink.href, '_blank', 'noopener'); });
                }
                return;
            }
            const ann = target.closest<HTMLElement>('[data-ann-item]');
            if (ann && annBox.contains(ann) && !target.closest('a')) {
                const key = ann.dataset.annItem ?? '';
                const open = !annExpanded.has(key);
                if (open) annExpanded.add(key);
                else annExpanded.delete(key);
                const text = ann.querySelector<HTMLElement>('.opal-course-ann-text');
                ann.classList.toggle('is-open', open);
                if (text) {
                    text.hidden = true;
                    void collapse(text, true);
                }
                ann.querySelector('[data-ann]')?.setAttribute('aria-expanded', String(open));
                return;
            }
            const bannerBtn = target.closest<HTMLElement>('[data-banner]');
            if (bannerBtn) {
                if (bannerBtn.dataset.banner === 'read') {
                    dismissBanner();
                    select('ann');
                    render();
                    paneTitle.focus({ preventScroll: true });
                    return;
                }
                dismissBanner();
                void exit(banner).then((done) => {
                    if (done) render();
                });
                paneTitle.focus({ preventScroll: true });
                return;
            }
            const pin = target.closest<HTMLElement>('[data-pin]');
            if (pin) {
                const key = focusKey(pin),
                    hadFocus = document.activeElement === pin;
                homeProgress = togglePin(homeProgress, pin.dataset.pin ?? '');
                persistProgress();
                render();
                if (hadFocus)
                    (
                        byFocusKey(root, key) ??
                        homeBox.querySelector<HTMLElement>('[data-home="browse"]') ??
                        paneTitle
                    ).focus({ preventScroll: true });
                return;
            }
            const homeAction = target.closest<HTMLElement>('[data-home]');
            if (homeAction) {
                const action = homeAction.dataset.home,
                    id = homeAction.dataset.id ?? '';
                const config = homeConfig;
                const block = homeModel.blocks.find((b) => b.config.id === id);
                if (action === 'customize') {
                    setEditing(true);
                    return;
                }
                if (action === 'hint') {
                    hint = false;
                    void store.set(hintKey, true);
                    render();
                    return;
                }
                if (action === 'browse' && block) {
                    select(blockSelectionId(block.config));
                    return;
                }
                if (action === 'announcements') {
                    select('ann');
                    return;
                }
                if (action === 'expand' || action === 'unit') {
                    const oldBody =
                        action === 'unit'
                            ? homeAction
                                  .closest('.opal-course-home-unit')
                                  ?.querySelector<HTMLElement>('.opal-course-home-unit-body')
                            : id.startsWith('earlier:')
                              ? (homeAction.nextElementSibling as HTMLElement | null)
                              : null;
                    const open = !homeState.expanded.has(id);
                    if (action === 'unit')
                        for (const b of homeModel.blocks)
                            if (b.kind === 'series') for (const u of b.units) homeState.expanded.delete(u.key);
                    if (open) homeState.expanded.add(id);
                    else homeState.expanded.delete(id);
                    if (!open && oldBody) {
                        void collapse(oldBody, false).then(() => render());
                        return;
                    }
                    render();
                    const control = byFocusKey(homeBox, `fk:home:${action}:${id}`);
                    const body =
                        action === 'unit'
                            ? control
                                  ?.closest('.opal-course-home-unit')
                                  ?.querySelector<HTMLElement>('.opal-course-home-unit-body')
                            : (control?.nextElementSibling as HTMLElement | null);
                    if (body && open) {
                        body.hidden = true;
                        void collapse(body, true);
                    }
                    return;
                }
                if (action === 'done' || action === 'skip' || action === 'pointer' || action === 'restart') {
                    const key = homeAction.dataset.unit ?? '';
                    if (action === 'done') homeProgress = toggleDone(homeProgress, key, Date.now());
                    else if (action === 'restart') homeProgress = setPointer(homeProgress, id, null);
                    else if (action === 'pointer') homeProgress = setPointer(homeProgress, id, key);
                    else if (block?.kind === 'series') {
                        const next = block.units[block.units.findIndex((u) => u.key === key) + 1];
                        if (!next) {
                            announce(t('homeLastUnit'));
                            return;
                        }
                        homeProgress = setPointer(homeProgress, id, next.key);
                    }
                    persistProgress();
                    const section = homeAction.closest<HTMLElement>('[data-block]');
                    const update = () => {
                        render();
                        homeBox
                            .querySelector<HTMLElement>(
                                `[data-block="${CSS.escape(id)}"] [data-home="done"], [data-block="${CSS.escape(id)}"] [data-home="restart"]`,
                            )
                            ?.focus({ preventScroll: true });
                    };
                    if (section) void swap(section, update);
                    else update();
                    return;
                }
                if (!config) return;
                const c = config.blocks.find((b) => b.id === id);
                const before = new Map(
                    Array.from(homeBox.querySelectorAll<HTMLElement>('[data-block]')).map((b) => [
                        b.dataset.block,
                        b.getBoundingClientRect().top,
                    ]),
                );
                if (action === 'up' || action === 'down') homeConfig = moveBlock(config, id, action === 'up' ? -1 : 1);
                if (action === 'hide' && c) homeConfig = updateBlock(config, id, { hidden: !c.hidden });
                if (action === 'series' && c) homeConfig = updateBlock(config, id, { series: !c.series });
                if (action === 'color')
                    homeConfig = updateBlock(config, id, { color: Number(homeAction.dataset.color) });
                if (action === 'remove') homeConfig = removeBlock(config, id);
                if (action === 'rename') homeState.rename = id;
                if (action === 'add-menu') homeState.adding = !homeState.adding;
                if (action === 'add') {
                    const source = homeModel.addable.find((s) => s.id === id);
                    if (source) homeConfig = addBlock(config, source.source, source.title);
                }
                persistHome();
                render();
                if (action === 'rename') homeBox.querySelector<HTMLInputElement>('[data-home-rename]')?.focus();
                if (action === 'up' || action === 'down') {
                    for (const b of homeBox.querySelectorAll<HTMLElement>('[data-block]')) {
                        const top = before.get(b.dataset.block);
                        if (top !== undefined) void reorder(b, top - b.getBoundingClientRect().top);
                    }
                    announce(
                        t('movedPositionTotal', { title: c ? homeBlockTitle(c, snapshot) : t('homeBlock'), position: (homeConfig?.blocks.findIndex((b) => b.id === id) ?? 0) + 1, total: homeConfig?.blocks.length ?? 0 }),
                    );
                }
                return;
            }
            const columnToggle = target.closest<HTMLElement>('button[data-column]');
            if (columnToggle && editBar.contains(columnToggle)) {
                const key = columnToggle.dataset.column as keyof BrowseLayout['columns'];
                layout = { ...layout, columns: { ...layout.columns, [key]: !layout.columns[key] } };
                persistLayout();
                renderEditBarNow();
                render();
                return;
            }
            const density = target.closest<HTMLElement>('[data-density]');
            if (density && editBar.contains(density)) {
                layout = { ...layout, density: density.dataset.density === 'normal' ? 'normal' : 'compact' };
                persistLayout();
                renderEditBarNow();
                render();
                return;
            }
            if (target.closest('#opal-theme-btn')) {
                void openThemeEditor();
                return;
            }
            const barBtn = target.closest<HTMLElement>('[data-editbar], #opal-edit-toggle, #opal-reset-layout');
            if (barBtn) {
                if (barBtn.dataset.editbar === 'done' || barBtn.id === 'opal-edit-toggle') {
                    setEditing(false);
                    return;
                }
                void confirmDialog({
                    title: t('resetTitle'),
                    message:
                        t('resetBody'),
                    confirmLabel: t('reset'),
                    danger: true,
                }).then((sure) => {
                    if (!sure) return;
                    layout = defaultLayout();
                    prefs = {
                        order: [],
                        hidden: [],
                        collapsed: [],
                        ...(prefs.open ? { open: prefs.open } : {}),
                        ...(prefs.selected ? { selected: prefs.selected } : {}),
                    };
                    if (snapshot) {
                        homeConfig = defaultHome(snapshot, located);
                        persistHome();
                    }
                    persistLayout();
                    persistPrefs();
                    renderEditBarNow();
                    render();
                    announce(t('resetDone'));
                });
                return;
            }
            if (target.closest('#opal-course-search-all, #opal-course-search-global')) {
                openCommandCenter(query.trim());
                return;
            }
            if (target.closest('#opal-course-refresh')) {
                if (load) load = { ...load, phase: 'cache' };
                schedule();
                handle.refresh();
                return;
            }
            if (target.closest('#opal-course-original')) {
                setPrefersOriginal(context.courseId, true);
                context.teardown();
                context.showFab('mount');
            }
        };
        root.addEventListener('click', onRootClick);

        // Density is a radiogroup: the arrow keys pick the other choice and keep focus on it.
        editBar.addEventListener('keydown', (e) => {
            const radio = (e.target as Element).closest<HTMLElement>('[data-density]');
            if (!radio || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            const next = radio.dataset.density === 'compact' ? 'normal' : 'compact';
            layout = { ...layout, density: next };
            persistLayout();
            renderEditBarNow();
            render();
            editBar.querySelector<HTMLElement>(`[data-density="${next}"]`)?.focus({ preventScroll: true });
        });

        // Middle-click opens a tab too; count it.
        const onAuxClick = (e: MouseEvent) => {
            if (e.button !== 1) return;
            const link = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[data-url]');
            if (link && table.contains(link)) markOpened(link.dataset.url ?? '');
        };
        root.addEventListener('auxclick', onAuxClick);

        // Sidebar: one tab stop, arrows move, Home/End jump.
        nav.addEventListener('focusin', (e) => {
            const item = (e.target as Element).closest<HTMLElement>('[data-nav]');
            if (!item) return;
            navFocus = item.dataset.nav ?? '';
            syncRoving();
        });
        nav.addEventListener('focusout', (e) => {
            if (nav.contains(e.relatedTarget as Node | null)) return;
            navFocus = '';
            syncRoving();
            if (navOpen && !navToggle.contains(e.relatedTarget as Node | null)) setNavOpen(false);
        });
        nav.addEventListener('keydown', (e) => {
            const item = (e.target as Element).closest<HTMLElement>('[data-nav]');
            if (!item) return;
            const items = navItems();
            const i = items.indexOf(item);
            if (e.key === ' ' && item.tagName === 'A') {
                e.preventDefault();
                item.click();
                return;
            }
            let next: number;
            if (e.key === 'ArrowDown') next = Math.min(items.length - 1, i + 1);
            else if (e.key === 'ArrowUp') next = Math.max(0, i - 1);
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = items.length - 1;
            else return;
            e.preventDefault();
            items[next]?.focus();
        });

        const onDocClick = (e: MouseEvent) => {
            if (!navOpen) return;
            const t = e.target as Node;
            if (!nav.contains(t) && !navToggle.contains(t)) setNavOpen(false);
        };
        document.addEventListener('click', onDocClick);

        findInput.addEventListener('input', () => setQuery(findInput.value));
        findInput.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && query.trim()) {
                const rows = hitRows();
                if (!rows.length) return;
                e.preventDefault();
                const i = rows.findIndex((r) => r.dataset.url === activeUrl);
                const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
                activeUrl = rows[next].dataset.url ?? '';
                applyActive(true);
                const name = rows[next].querySelector('.opal-course-name')?.textContent?.trim() ?? '';
                const where = rows[next].querySelector('.c-loc')?.textContent?.trim() ?? '';
                announce(t(where ? 'resultPositionWithLocation' : 'resultPosition', { name, where, position: next + 1, total: rows.length }));
                return;
            }
            if (e.key === 'Enter') {
                if (!query.trim()) return;
                e.preventDefault();
                openActive();
                return;
            }
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            if (editing && !query) {
                e.preventDefault();
                setEditing(false);
                return;
            }
            if (query) {
                e.preventDefault();
                resetFind();
            } else findInput.blur();
        });
        findInput.addEventListener('blur', () => {
            if (!query.trim()) scrollAtFocus = null;
        });

        const { onKey } = createKeyboard({
            get setNavOpen() { return setNavOpen; },
            get setEditing() { return setEditing; },
            get resetFind() { return resetFind; },
            get homeConfig() { return homeConfig; },
            set homeConfig(value) { homeConfig = value; },
            get persistHome() { return persistHome; },
            get homeState() { return homeState; },
            get render() { return render; },
            get homeBox() { return homeBox; },
            get navOpen() { return navOpen; },
            set navOpen(value) { navOpen = value; },
            get editing() { return editing; },
            set editing(value) { editing = value; },
            get query() { return query; },
            set query(value) { query = value; },
            get scrollAtFocus() { return scrollAtFocus; },
            set scrollAtFocus(value) { scrollAtFocus = value; },
            get root() { return root; },
            get findInput() { return findInput; },
            get byFocusKey() { return byFocusKey; },
            get isEditable() { return isEditable; },
        });
        document.addEventListener('keydown', onKey);

        const sticky = () => {
            const top = root.getBoundingClientRect().top + (topbar?.offsetHeight ?? 0);
            thead.classList.toggle('is-stuck', root.scrollTop > 0 && thead.getBoundingClientRect().top <= top + 1);
            for (const head of table.querySelectorAll<HTMLElement>('.opal-course-ghead')) {
                head.classList.toggle('is-stuck', root.scrollTop > 0 && head.getBoundingClientRect().top <= top + 29);
            }
            for (const row of hitRows()) {
                const head = row.closest('.opal-course-group')?.querySelector('.opal-course-ghead');
                const edge = head
                    ? Math.max(thead.getBoundingClientRect().bottom, head.getBoundingClientRect().bottom)
                    : thead.getBoundingClientRect().bottom;
                const rect = row.getBoundingClientRect();
                row.classList.toggle('is-occluded', rect.top < edge && rect.bottom > edge);
            }
        };
        root.addEventListener('scroll', sticky, { passive: true });

        // Sticky offsets follow the real top bar height.
        const setTop = () => {
            if (topbar) root.style.setProperty('--course-top', `${topbar.offsetHeight}px`);
        };
        const resize = new ResizeObserver(setTop);
        if (topbar) resize.observe(topbar);
        setTop();

        schedule();

        return {
            destroy() {
                root.removeEventListener('scroll', sticky);
                stopNavSort();
                stopHomeSort();
                resize.disconnect();
                handle.cancel();
                cancelAnimationFrame(frame);
                clearTimeout(announceTimer);
                document.removeEventListener('keydown', onKey);
                document.removeEventListener('click', onDocClick);
                document.removeEventListener('opal-customize', onCustomize);
                root.removeEventListener('click', onRootClick);
                root.removeEventListener('auxclick', onAuxClick);
            },
        };
    }
    return { createView };
}
