import { t } from '../i18n/messages/course.ts';
import { localeTag } from '../i18n/core.ts';
import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import { createController } from './view/controller';

import { adaptTopbar, shellHtml } from './view/shell';

/* ━━ Course view: mount, state, events ━━━━━━━━━━━━━━━━━━━━━━━━━
 * Takes over a course's start page (opt-in) with a two-pane file
 * browser. Lives inside #opal-modern-ui so the top bar, theme tokens
 * and scoped styles are the dashboard's own.
 *
 *   top bar      the search slot IS the course find field
 *   header       title, semester and count, "Aktualisieren", "Originalansicht"
 *   sidebar      what is shown (browse/buildNav): overview, Art, Kursinhalt,
 *                Weitere Bereiche; one tab stop, arrow keys move
 *   list pane    one aligned table (browse/buildList) of the selection,
 *                or the search hits, or the announcements
 *
 * Customising is opened from the avatar menu ("Kursansicht anpassen",
 * the `opal-customize` event) and happens in place: a slim bar above
 * the panes and eye / up / down controls in the sidebar.
 *
 * Way back: "Originalansicht" unmounts the overlay (OPAL's page was
 * only hidden, never touched) and remembers the choice for this tab;
 * a small floating "Kursansicht" button returns. Course node pages get
 * the same button as a link to the view.
 *
 * Rendering is incremental: onUpdate fires several times a second while
 * loading, so each part compares a cheap signature and only changed
 * parts are replaced (list rowgroups by key). locate() reruns only when
 * entries change; query, selection, focus and scroll survive updates.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { courseIdFromUrl, isCourseViewEnabled, LOGIN_ERROR, loadErrorMessage } from './loader';
import { RELOGIN_URL } from '../tufast';
import { isCourseStartPath, parseCoursePath, prefersOriginal, rootFromMenuScript, setPrefersOriginal, storedRootId, writeEnabledMirror } from './route';

import { type Sort } from './browse/index';

import { esc, href } from './render/format';

import { buildTopbar, scrapeUserInfo } from '../topbar';

import { applyTheme, loadTheme } from '../theme';

export interface CourseViewDeps {
    isExtensionEnabled(): Promise<boolean>;
    /** Wire the shared top bar: search trigger, user menu, login. */
    bindTopbar(): void;
    /** Ctrl+K palette. Called at most once per page. */
    bindPalette(): void;
}

const ROOT_ID = 'opal-modern-ui';
const FAB_ID = 'opal-course-fab';
/** chrome.storage.local: layout for all courses, prefs and the dismissed banner per course. */
const LAYOUT_KEY = 'opalCourseLayout';
const prefsKey = (id: string) => `opalCoursePrefs_${id}`;
const bannerKey = (id: string) => `opalCourseAnnSeen_${id}`;
const ORDER: Sort = { key: 'order', dir: 'asc' };

let deps: CourseViewDeps | null = null;
let courseId = '';
let current: { destroy(): void } | null = null;
let mounting = false;
let paletteBound = false;

/* ── Mirror for early.js ──────────────────────────────────────── */

/** Keep the page-origin copy of the switch in step with chrome.storage.
 *  Called by the content script on every OPAL page. */
export function syncCourseViewMirror(): void {
    try {
        const refresh = () => { void Promise.all([store.get(keys.enabled), store.get(keys.courseView)]).then(([master, course]) => writeEnabledMirror(master && course)); };
        refresh();
        store.watch(keys.enabled, refresh);
        store.watch(keys.courseView, refresh);
    } catch { /* extension context gone */ }
}

/* ── Page detection ───────────────────────────────────────────── */

let menuRoot: { id: string; title: string } | null | undefined;
/** Root node of the course from OPAL's inline menu script, read once. */
function domMenuRoot(): { id: string; title: string } | null {
    if (menuRoot !== undefined) return menuRoot;
    menuRoot = null;
    for (const script of Array.from(document.scripts)) {
        const text = script.textContent ?? '';
        if (!text.includes('icon-root')) continue;
        menuRoot = rootFromMenuScript(text);
        if (menuRoot) break;
    }
    return menuRoot;
}

function isStartPage(): boolean {
    return isCourseStartPath(location.pathname, id => storedRootId(id) ?? (id === courseId ? domMenuRoot()?.id ?? null : null));
}

function courseStartHref(): string {
    return location.pathname.replace(/(\/RepositoryEntry\/\d+).*$/i, '$1');
}

/** Drop the first-paint gate unless the view is on screen. */
function releaseGate(): void {
    if (current) return;
    document.documentElement.classList.remove('opal-modern-pending', 'opal-course-pending');
    document.documentElement.removeAttribute('data-opal-course-active');
    document.body?.classList.remove('opal-mod-active');
}

/* ── Entry point ──────────────────────────────────────────────── */

export async function initCoursePage(d: CourseViewDeps): Promise<void> {
    deps = d;
    try {
        const parsed = parseCoursePath(location.pathname);
        const id = courseIdFromUrl(location.href);
        if (!parsed || !id || parsed.courseId !== id) { releaseGate(); return; }
        if (!await d.isExtensionEnabled()) { releaseGate(); return; }
        courseId = id;
        store.watch(keys.enabled, () => { void reconsider(); });
        store.watch(keys.courseView, () => { void reconsider(); });
        await reconsider();
    } catch (err) {
        console.warn('[OPAL] Course view failed to start:', err);
        teardown();
        releaseGate();
    }
}

/** Decide what this page shows; runs at start and whenever the switch changes. */
async function reconsider(): Promise<void> {
    const on = deps ? (await deps.isExtensionEnabled()) && (await isCourseViewEnabled()) : false;
    if (!on) {
        teardown();
        removeFab();
        releaseGate();
        return;
    }
    if (!isStartPage()) {
        releaseGate();
        showFab('link');
        return;
    }
    if (prefersOriginal(courseId)) {
        releaseGate();
        showFab('mount');
        return;
    }
    await mount();
}

/* ── Mount / unmount ──────────────────────────────────────────── */

async function mount(): Promise<void> {
    if (current || mounting || !deps) return;
    mounting = true;
    document.documentElement.setAttribute('data-opal-course-active', '');
    try {
        removeFab();
        applyTheme(await loadTheme());
        let root = document.getElementById(ROOT_ID);
        if (!root) {
            root = document.createElement('div');
            root.id = ROOT_ID;
            document.body.prepend(root);
        }
        root.classList.add('opal-course-mode');
        root.lang = localeTag();
        const title = domMenuRoot()?.title || t('course');
        root.innerHTML = buildTopbar(scrapeUserInfo(), false, { customizeLabel: t('customizeCourse') }) + shellHtml(title);
        adaptTopbar(root, domMenuRoot()?.title || '');
        document.body.classList.add('opal-mod-active');
        document.documentElement.classList.add('opal-modern-pending', 'opal-course-pending');
        deps.bindTopbar();
        if (!paletteBound) { paletteBound = true; deps.bindPalette(); }
        current = createView(root);
        document.dispatchEvent(new Event('opal-dashboard-ready'));
    } catch (err) {
        console.warn('[OPAL] Course view failed to mount:', err);
        fail('');
    } finally {
        mounting = false;
    }
}

function teardown(): void {
    current?.destroy();
    current = null;
    document.getElementById(ROOT_ID)?.remove();
    document.documentElement.classList.remove('opal-modern-pending', 'opal-course-pending');
    document.documentElement.removeAttribute('data-opal-course-active');
    document.body?.classList.remove('opal-mod-active');
}

/** Never leave a blank page: show OPAL's own page plus a short error line. */
function fail(message: string): void {
    teardown();
    showFab('mount', message || t('mountError'));
}



/* ── Floating "Kursansicht" button ────────────────────────────── */

function removeFab(): void {
    document.getElementById(FAB_ID)?.remove();
}

/** 'mount' brings the view back in place; 'link' navigates to the start page. */
function showFab(mode: 'mount' | 'link', error = ''): void {
    removeFab();
    void loadTheme().then(applyTheme).catch(() => { });
    const fab = document.createElement('div');
    fab.id = FAB_ID;
    fab.lang = localeTag();
    const label = `<span>${t('courseView')}</span>`;
    const button = mode === 'link'
        ? `<a class="opal-course-fab-btn" href="${href(courseStartHref())}" title="${t('courseViewHint')}">${label}</a>`
        : `<button type="button" class="opal-course-fab-btn" title="${t('courseViewHint')}">${label}</button>`;
    fab.innerHTML = `${error ? `<p class="opal-course-fab-error" role="status">${esc(loadErrorMessage(error))}</p>` : ''}${button}${error === LOGIN_ERROR ? `<a class="opal-course-fab-btn" href="${RELOGIN_URL}">${t('relogin')}</a>` : ''}`;
    fab.querySelector('.opal-course-fab-btn')?.addEventListener('click', e => {
        setPrefersOriginal(courseId, false);
        if (mode === 'link') return;
        e.preventDefault();
        void mount();
    });
    document.body.appendChild(fab);
}

/* ── Helpers ──────────────────────────────────────────────────── */







/* ── The view ─────────────────────────────────────────────────── */

const { createView } = createController({ get courseId() { return courseId; },
        set courseId(value) { courseId = value; },
        get prefsKey() { return prefsKey; },
        get LAYOUT_KEY() { return LAYOUT_KEY; },
        get ORDER() { return ORDER; },
        get bannerKey() { return bannerKey; },
        get current() { return current; },
        set current(value) { current = value; },
        get mounting() { return mounting; },
        set mounting(value) { mounting = value; },
        get fail() { return fail; },
        get teardown() { return teardown; },
        get showFab() { return showFab; } });
