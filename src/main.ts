import { bindTufastMenu } from './tufast';
import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
import { opal } from './opal/gateway';
import { getAvailablePortletOrders, waitForPortletOrders } from './widget-availability';
import { openExtensionOptions } from './extension-options';
import { staggerIn, enter, exit, pop, pressable } from './motion';
import { startOnboarding } from './onboarding';
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Modular Dashboard
   Entry Point (GridStack-powered)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { DashboardState, CourseItem } from './types';
import { loadLayout, saveLayout, getDefaultLayout, revealWhatsNew } from './layout.ts';
import { scrapeUserInfo, buildTopbar } from './topbar';
import { buildWidgetGrid } from './grid';
import { safeClick, confirmDialog } from './settings';
import { clickNativeComponent, NATIVE_COMPONENTS } from './native-controls';
import { WIDGETS } from './widgets/index';
import { initNews } from './widgets/neuigkeiten';
import { initWhatsNew } from './widgets/whats-new';
import { GridStack } from 'gridstack';
import { updateCalendarHeight } from './widgets/calendar';
import { fitFavorites } from './widgets/favorites';
import { updateCourseIndex, setMatchThreshold } from './course-matcher';
import { loadCalendarSettings } from './calendar-store';
import { initMensa, loadMensaSettings } from './mensa-store';
import { initSearchEngine } from './core/search-engine';
import { takeCustomizeRequest } from './customize-requests';
import { indexCurrentPage, bootstrapFromDashboard, indexFilesOnPage, checkAndHighlightFile, indexCourseCatalog, loadCatalogSettings, isCatalogStale, indexUpcomingCourses } from './indexer';
import { startIndexRequestWatchers } from './index-requests';
import { loadTheme, applyTheme } from './theme';
import { openThemeEditor } from './theme-editor';
import { autoInjectLoginDialog, injectStyledLoginDialog, watchForLoginDialog } from './login';
import { bindEditModeHandlers } from './edit-mode';
import { registerMensaClickHandlers } from './mensa-modal';
import { openCommandCenter, bindCommandCenter } from './command-center';
import { initCoursePage, syncCourseViewMirror, type CourseViewDeps } from './course/view';
import { initLocale, localeTag } from './i18n/index.ts';
import { t } from './i18n/messages/shell.ts';

/* ── Globals ──────────────────────────────────────────────────── */
const state: DashboardState = {
    layout: [],
    editMode: false,
};
let grid: GridStack | null = null;
let isGridBusy = false;
let dashboardEntered = false;
let editEntered = false;

/** Last markup each widget's render() produced, so a refresh can tell a real
 *  change from a class the page adjusted afterwards (the favourites density). */
const lastRendered = new WeakMap<Element, string>();

/** Re-pick the favourites density once layout has settled. */
let fitFrame = 0;
function scheduleFitFavorites(): void {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => fitFavorites());
}
window.addEventListener('resize', scheduleFitFavorites);

// Any control marked data-opal-open-search opens the command center. Delegated
// once here so it keeps working when widgets re-render.
document.addEventListener('click', (e) => {
    const trigger = (e.target as Element | null)?.closest?.('[data-opal-open-search]');
    if (!trigger) return;
    e.preventDefault();
    openCommandCenter();
});

/** Normalised URL pathname → CourseItem for the user's favorite courses.
 *  Populated from the Favorites widget on every scrape cycle. */
const favoriteCourses = new Map<string, CourseItem>();

const ROOT_ID = 'opal-modern-ui';
const NATIVE_USER_MENU_ALIASES: Record<string, string[]> = {
    'profil': ['profil', 'profileinstellungen'],
    'einstellungen': ['einstellungen', 'systemeinstellungen'],
    'anzeige': ['anzeige', 'anzeigeeinstellungen'],
    'neuigkeiten': ['neuigkeiten', 'abonnements'],
    'persönlicher kalender': ['persönlicher kalender', 'persoenlicher kalender', 'kalender'],
};

/** Popup-controlled master switch. Defaults to enabled for existing installs. */
async function isExtensionEnabled(): Promise<boolean> {
    return store.get(keys.enabled);
}

/* ── Page detection ───────────────────────────────────────────── */
function isHomePage(): boolean {
    return (
        location.pathname.startsWith('/opal/home') ||
        location.pathname === '/opal/' ||
        location.pathname === '/opal'
    );
}

function normalizeMenuText(text: string): string {
    return text
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/\s+/g, ' ')
        .trim();
}

function findNativeUserMenuItem(action: string, fallbackTitle: string): HTMLElement | null {
    const base = normalizeMenuText(action);
    const aliases = [
        base,
        normalizeMenuText(fallbackTitle),
        ...(NATIVE_USER_MENU_ALIASES[base] ?? []),
    ].filter(Boolean);

    if (base === 'abmelden') {
        const logout = document.querySelector<HTMLElement>('.header-functions-user .icon-logout')?.closest<HTMLElement>('a');
        if (logout) return logout;
    }
    const items = document.querySelectorAll<HTMLElement>(
        '.header-functions-user .dropdown-menu a, .header-functions-user a[title]'
    );
    return Array.from(items).find(item => {
        const haystack = normalizeMenuText(`${item.textContent ?? ''} ${item.getAttribute('title') ?? ''}`);
        return aliases.some(alias => haystack.includes(normalizeMenuText(alias)));
    }) ?? null;
}

/* ── Sync GridStack positions back to layout state ────────────── */
function syncLayoutFromGrid(changedItems?: { id?: string | number; x?: number; y?: number; w?: number; h?: number }[]): void {
    if (!grid) return;

    const nodes = changedItems ?? grid.getGridItems().map(el => el.gridstackNode).filter(Boolean);
    nodes.forEach(node => {
        if (!node) return;
        const id = node.id as string;
        const entry = state.layout.find(e => e.widgetId === id);
        if (entry) {
            entry.x = node.x ?? entry.x;
            entry.y = node.y ?? entry.y;
            entry.w = node.w ?? entry.w;
            entry.h = node.h ?? entry.h;
        }
    });
    saveLayout(state.layout);
}

/* ── Top bar controls ─────────────────────────────────────────── */
/** Login, search trigger and user menu of buildTopbar(); shared by the
 *  dashboard and the course view. */
function bindTopbarControls(onCustomize: () => void): void {
    bindTufastMenu();
    // Bind login button (shown when session expired / not logged in)
    // Two states:
    //   A) Page refreshed while logged out → OPAL auto-opens a jQuery UI dialog;
    //      we immediately replace it with our styled overlay (user can change institution).
    //   B) Session expired mid-session → dialog not open yet; click header link to
    //      trigger Wicket, then watch for dialog to appear and style it.
    const loginBtn = document.getElementById('opal-login-btn');
    loginBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // If our overlay is already showing, do nothing
        if (document.getElementById('opal-login-overlay')) return;

        // State A: Wicket dialog already in DOM
        if (document.querySelector('button[name*="shibLogin"]')) {
            injectStyledLoginDialog();
            return;
        }

        // State B: click header link to open dialog, then style it when it appears
        const headerLogin = document.querySelector<HTMLAnchorElement>(
            '.header-functions-user a[title="Login"], .header-functions-user a[title="Anmelden"]'
        );
        if (headerLogin) {
            safeClick(headerLogin);
            watchForLoginDialog();
            return;
        }

        window.location.reload();
    });

    // Bind Command Center trigger button directly (most reliable — same pattern as edit/login)
    const cmdTrigger = document.getElementById('opal-cmd-trigger');
    if (cmdTrigger) {
        cmdTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openCommandCenter();
        });
    }

    // Bind user avatar → toggle our custom dropdown (role="menu", roving focus)
    const userBtn = document.getElementById('opal-user-btn');
    const userDropdown = document.getElementById('opal-user-dropdown');
    if (userBtn && userDropdown) {
        const menuItems = () => Array.from(userDropdown.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
        const focusItem = (item: HTMLElement | undefined) => { item?.focus(); };
        const setMenuOpen = (open: boolean, focus: 'first' | 'last' | null = null) => {
            if (open) {
                userDropdown.style.display = 'block'; void pop(userDropdown);
                if (focus) focusItem(focus === 'first' ? menuItems()[0] : menuItems().slice(-1)[0]);
            }
            else if (userBtn.getAttribute('aria-expanded') === 'true') void exit(userDropdown).then(done => {
                if (done && userBtn.getAttribute('aria-expanded') !== 'true') userDropdown.style.display = 'none';
            });
            userBtn.setAttribute('aria-expanded', String(open));
        };
        userDropdown.querySelector('[data-action="extension-options"]')?.addEventListener('click', () => {
            setMenuOpen(false); void openExtensionOptions();
        });
        userDropdown.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); setMenuOpen(false); userBtn.focus(); return;
            }
            if (event.key === 'Tab') { setMenuOpen(false); userBtn.focus(); return; }
            const items = menuItems();
            const at = items.indexOf(document.activeElement as HTMLElement);
            const next = event.key === 'ArrowDown' ? items[(at + 1) % items.length]
                : event.key === 'ArrowUp' ? items[(at - 1 + items.length) % items.length]
                : event.key === 'Home' ? items[0]
                : event.key === 'End' ? items[items.length - 1] : undefined;
            if (!next) return;
            event.preventDefault(); event.stopPropagation(); focusItem(next);
        });
        userBtn.addEventListener('keydown', event => {
            if (event.key === 'Escape') { setMenuOpen(false); userBtn.focus(); }
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault(); setMenuOpen(true, event.key === 'ArrowDown' ? 'first' : 'last');
            }
        });
        userBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = userBtn.getAttribute('aria-expanded') === 'true';
            // detail 0 is a keyboard activation: move into the menu like the arrow keys do.
            setMenuOpen(!open, !open && e.detail === 0 ? 'first' : null);
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!userDropdown.contains(e.target as Node) && !userBtn.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        });

        // A keyboard activation closes the menu: put focus back on the avatar instead of a hidden row.
        userDropdown.addEventListener('click', e => { if (e.detail === 0 && (e.target as Element).closest('[role="menuitem"]')) userBtn.focus(); });

        // "Startseite anpassen" / "Anpassen beenden" item
        userDropdown.querySelector('[data-action="customize"]')?.addEventListener('click', () => {
            setMenuOpen(false);
            document.dispatchEvent(new CustomEvent('opal-customize'));
            onCustomize();
        });

        // OPAL native menu items — find the matching <a> in OPAL's header dropdown and click it
        userDropdown.querySelectorAll<HTMLElement>('[data-opal-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                setMenuOpen(false);
                const action = btn.dataset.opalAction ?? '';
                const fallbackTitle = btn.dataset.opalTitle ?? '';

                // TUfast listens on this exact anchor to suppress automatic re-login.
                if (normalizeMenuText(action) === 'abmelden') {
                    const logout = document.querySelector<HTMLElement>('a[title="Abmelden"]');
                    if (logout) { safeClick(logout); return; }
                }
                if (clickNativeComponent(NATIVE_COMPONENTS[normalizeMenuText(action)] ?? [])) return;
                const match = findNativeUserMenuItem(action, fallbackTitle);
                if (match) {
                    safeClick(match);
                    return;
                }

                const nativeToggle = document.querySelector<HTMLElement>(
                    '.header-functions-user [data-bs-toggle="dropdown"], .header-functions-user [data-toggle="dropdown"], .header-functions-user .dropdown-toggle'
                );
                if (!nativeToggle) return;

                safeClick(nativeToggle);
                window.setTimeout(() => {
                    if (clickNativeComponent(NATIVE_COMPONENTS[normalizeMenuText(action)] ?? [])) return;
                    const lateMatch = findNativeUserMenuItem(action, fallbackTitle);
                    if (lateMatch) safeClick(lateMatch);
                }, 150);
            });
        });

    }
}

/* ── Main render ──────────────────────────────────────────────── */
function render(): void {
    // Destroy old GridStack instance if it exists
    if (grid) {
        grid.destroy(false);
        grid = null;
    }

    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        document.body.prepend(root);
        document.body.classList.add('opal-mod-active');
        document.documentElement.classList.add('opal-modern-pending');
    }

    const user = scrapeUserInfo();
    const topbar = buildTopbar(user, state.editMode);
    const gridHtml = buildWidgetGrid(state.layout, WIDGETS, state.editMode);

    root.lang = localeTag();
    root.innerHTML = topbar + gridHtml;
    pressable(root);
    if (!dashboardEntered) { dashboardEntered = true; void staggerIn(root.querySelectorAll<HTMLElement>('.widget-card')); }
    if (state.editMode && !editEntered) root.querySelectorAll<HTMLElement>('.widget-actions, #opal-hidden-panel').forEach(el => { void enter(el); });
    editEntered = state.editMode;

    // Try to extract CSP nonce from the page to allow GridStack to inject CSS
    const nonce = document.querySelector('style[nonce]')?.getAttribute('nonce') ||
        document.querySelector('script[nonce]')?.getAttribute('nonce') || undefined;

    // Initialize GridStack on the grid element
    const gridEl = document.querySelector('#opal-widget-grid') as HTMLElement;
    if (gridEl) {
        grid = GridStack.init({
            nonce: nonce,
            column: 12,
            cellHeight: 60,
            margin: '16 12',  // vertical horizontal — GridStack JS applies these as insets on grid-stack-item-content
            animate: true,
            float: false,
            disableResize: !state.editMode,
            disableDrag: !state.editMode,
            draggable: {
                handle: '.widget-grip',
            },
            resizable: {
                handles: 'e, se, s, sw, w',
            },
            minRow: 1,
            columnOpts: {
                breakpointForWindow: true,
                breakpoints: [
                    { w: 700, c: 1 },
                    { w: 950, c: 6 },
                    { w: 1100, c: 12 },
                ],
            },
        }, gridEl);

        // Save layout whenever items are moved or resized
        grid.on('change', (_event: Event, items: any[]) => {
            syncLayoutFromGrid(items);
            scheduleFitFavorites();
        });
        scheduleFitFavorites();

        // Guard: suppress MutationObserver during drag/resize
        grid.on('dragstart resizestart', () => { isGridBusy = true; });
        grid.on('dragstop', () => {
            setTimeout(() => { isGridBusy = false; }, 300);
        });
        grid.on('resizestop', (_event: Event, el: any) => {
            setTimeout(() => { isGridBusy = false; }, 300);
            scheduleFitFavorites();
            // Update calendar view if it was resized
            if (el) {
                const widgetId = el.getAttribute?.('gs-id') || el.gridstackNode?.id;
                const newH = parseInt(el.getAttribute?.('gs-h') || '0') || el.gridstackNode?.h;
                if (widgetId === 'calendar' && newH) {
                    updateCalendarHeight(newH);
                }
            }
        });
    }

    // Bind edit toggle
    const editBtn = document.getElementById('opal-edit-toggle');
    editBtn?.addEventListener('click', () => {
        void toggleEditMode();
    });

    // Bind edit mode buttons
    if (state.editMode) {
        bindEditModeHandlers(state, () => grid, render, updateWidgetsContent);
    }

    // Bind reset layout button
    const resetBtn = document.getElementById('opal-reset-layout');
    resetBtn?.addEventListener('click', async () => {
        const sure = await confirmDialog({
            title: t('editResetTitle'),
            message: t('editResetMessage'),
            confirmLabel: t('editConfirmReset'),
            danger: true,
        });
        if (!sure) return;
        state.layout = getDefaultLayout(getAvailablePortletOrders());
        await saveLayout(state.layout);
        render();
    });

    // Bind theme editor button (edit mode only)
    document.getElementById('opal-theme-btn')?.addEventListener('click', () => openThemeEditor());

    bindTopbarControls(() => {
        void toggleEditMode();
    });

    // State A auto-detect: if page loaded already showing the Wicket login dialog,
    // immediately replace it with our styled overlay (no click needed)
    if (document.querySelector('button[name*="shibLogin"]')) {
        autoInjectLoginDialog();
    }
}

/* ── Dynamic Content Updates ──────────────────────────────────── */
function updateWidgetsContent(affected?: Set<string>): void {
    if (!grid) return;

    // Collect courses/favorites for the fuzzy matcher
    const allCourses: CourseItem[] = [];
    const items = grid.getGridItems();

    items.forEach(item => {
        const widgetId = item.getAttribute('gs-id');
        if (!widgetId) return;
        const widget = [...WIDGETS.values()].find(w => w.id === widgetId);
        if (!widget || (affected && !affected.has(widgetId))) return;

        // While a portlet shows its native config form its content is gone from
        // the page; scraping it then would wipe the widget ("keine Favoriten").
        // Keep what is on screen until the form closes.
        const orders = [widget.opalPortletOrder].flat().filter(Boolean);
        if (orders.some(o => document.querySelector(`div[data-portlet-order="${CSS.escape(o)}"] .panel-config`))) return;

        try {
            const data = widget.scrape();

            // Collect course data for the matcher
            if (widgetId === 'favorites' || widgetId === 'courses') {
                const courses = data as CourseItem[];
                allCourses.push(...courses);
            }

            const gsH = parseInt(item.getAttribute('gs-h') || '0') || undefined;
            const gsW = parseInt(item.getAttribute('gs-w') || '0') || undefined;
            const newContent = widget.render(data, gsH, gsW);
            const contentDiv = item.querySelector('.widget-content');
            if (contentDiv) {
                // No record yet means the content came from the initial render;
                // compare against the DOM once, then against the record.
                const previous = lastRendered.get(contentDiv) ?? contentDiv.innerHTML;
                if (previous !== newContent) contentDiv.innerHTML = newContent;
                lastRendered.set(contentDiv, newContent);
            }
        } catch (err) {
            console.warn(`[OPAL] Failed to update widget ${widgetId}:`, err);
        }
    });

    scheduleFitFavorites();

    // Update the Fuse.js index with fresh course data
    const courseSourceInConfig = !!document.querySelector(
        'div[data-portlet-order="Bookmarks"] .panel-config, div[data-portlet-order="RepositoryPortletStudent"] .panel-config'
    );
    if (!courseSourceInConfig && (!affected || affected.has('favorites') || affected.has('courses'))) {
        allCourses.length = 0;
        for (const id of ['favorites', 'courses']) {
            allCourses.push(...(WIDGETS.get(id)?.scrape() as CourseItem[] ?? []));
        }
        updateCourseIndex(allCourses);

        // Keep favoriteCourses in sync so Command Center can prioritise them
        favoriteCourses.clear();
        for (const c of (WIDGETS.get('favorites')?.scrape() as CourseItem[] ?? [])) {
            try { favoriteCourses.set(new URL(c.href, location.origin).pathname.replace(/\/$/, ''), c); }
            catch { /* skip malformed */ }
        }
        void bootstrapFromDashboard().catch(console.warn);
    }
}

/* ── DOM Observer ─────────────────────────────────────────────── */
function initObserver(): void {
    let debounceTimer: number | null = null;
    const pending = new Set<string>();
    const ownRoots = '#opal-modern-ui, #opal-settings-modal, #opal-cmd-overlay, #opal-theme-editor, #opal-theme-backdrop, #opal-login-overlay, #opal-cal-settings-modal, #opal-confirm-modal, #opal-add-event-modal';
    const collect = (node: Node, descendants = false) => {
        const el = node instanceof Element ? node : node.parentElement;
        if (!el || el.closest(ownRoots)) return;
        const orders = new Set<string>();
        const parent = el.closest('[data-portlet-order]');
        if (parent) orders.add(parent.getAttribute('data-portlet-order') ?? '');
        if (descendants) el.querySelectorAll('[data-portlet-order]').forEach(p => orders.add(p.getAttribute('data-portlet-order') ?? ''));
        for (const widget of WIDGETS.values()) {
            // Stats is synthetic in the registry, but reads these two native portlets.
            const deps = widget.id === 'stats' ? ['Bookmarks', 'RepositoryPortletStudent'] :
                [widget.opalPortletOrder].flat().filter(Boolean);
            if (deps.some(order => orders.has(order))) pending.add(widget.id);
        }
    };
    const observer = new MutationObserver(mutations => {
        if (isGridBusy) return;
        for (const mutation of mutations) {
            const el = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
            if (el?.closest(ownRoots)) continue;
            collect(mutation.target);
            mutation.addedNodes.forEach(node => collect(node, true));
            mutation.removedNodes.forEach(node => collect(node, true));
        }
        if (!pending.size) return;
        if (debounceTimer) window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
            if (isGridBusy) return;
            const affected = new Set(pending);
            pending.clear();
            updateWidgetsContent(affected);
        }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: false });
}

/* ── Bootstrap ────────────────────────────────────────────────── */
/** Opt-in course view on course pages; it owns the first-paint gate there. */
const courseViewDeps: CourseViewDeps = {
    isExtensionEnabled,
    bindTopbar: () => bindTopbarControls(() => {}),
    bindPalette: () => bindCommandCenter(favoriteCourses),
};
if (window.self === window.top) syncCourseViewMirror();

async function init(): Promise<void> {
    if (window.self === window.top && !isHomePage()) {
        await initLocale({ live: false });
        await initCoursePage(courseViewDeps);
        return;
    }
    let ready = false;
    try {
        // Never run our dashboard inside hidden iframes (e.g. catalog indexer)
        if (window.self !== window.top) return;

        if (!await isExtensionEnabled()) return;

        if (!isHomePage()) return;

        // Apply saved theme before any rendering to avoid flash
        const localeReady = initLocale({ live: false });
        applyTheme(await loadTheme());
        await localeReady;

        state.layout = await loadLayout(await waitForPortletOrders());
        await initNews(() => updateWidgetsContent(new Set(['neuigkeiten'])));
        initWhatsNew(() => updateWidgetsContent(new Set(['whats-new'])));
        // Reveal "Neu in deinen Kursen" once the index holds a new file (checked until it did).
        let whatsNewTimer = 0;
        const checkWhatsNew = async () => {
            if (await store.get(keys.whatsNewRevealed)) { window.clearInterval(whatsNewTimer); return; }
            const { getNewFiles } = await import('./core/search-engine');
            const items = await getNewFiles(14, 1);
            if (await store.get(keys.whatsNewRevealed)) return;
            const next = revealWhatsNew(state.layout, false, items.length > 0);
            if (next === state.layout) return;
            state.layout = next;
            await saveLayout(next);
            await store.set(keys.whatsNewRevealed, true);
            window.clearInterval(whatsNewTimer);
            render();
        };

        // Load saved match threshold before rendering
        const calSettings = await loadCalendarSettings();
        setMatchThreshold(calSettings.matchThreshold ?? 0.4);

        // Load mensa settings (canteen choice + favourites) before fetching meals
        await loadMensaSettings();

        // Pre-fetch Mensa meals so mensa widget scrape() has data on first render
        await initMensa();

        render();
        ready = true;
        void checkWhatsNew().catch(console.warn);
        whatsNewTimer = window.setInterval(() => { void checkWhatsNew().catch(console.warn); }, 30000);
        document.dispatchEvent(new Event('opal-dashboard-ready'));
        startIndexRequestWatchers();
        // The options page asks the background script for edit mode (and the Darstellung panel). The request
        // names one tab; every tab asks, the background hands it to that tab only and drops it after two minutes.
        const consumeCustomize = async () => {
            const request = await takeCustomizeRequest();
            if (!request) return;
            if (!state.editMode) await toggleEditMode();
            if (request === 'appearance') document.getElementById('opal-theme-btn')?.click();
        };
        store.watch(keys.customizeRequested, value => { if (value) void consumeCustomize(); });
        void consumeCustomize();
        void startOnboarding(async () => { state.layout = await loadLayout(getAvailablePortletOrders()); render(); });
        bindCommandCenter(favoriteCourses);
        initObserver();
        registerMensaClickHandlers(() => updateWidgetsContent());

        // Migrate the old page-origin index once, then seed from dashboard portlets.
        // If catalog indexing is enabled and data is missing/stale, auto-trigger.
        initSearchEngine()
            .then(() => bootstrapFromDashboard())
            .then(async () => {
                const catSettings = await loadCatalogSettings();
                if (catSettings.enabled && await isCatalogStale()) {
                    console.log('[OPAL] Auto-indexing catalog (enabled + stale/missing)');
                    indexCourseCatalog().catch(console.warn);
                }
            })
            .catch(console.warn);

        // Detect extension context invalidation (e.g. extension reloaded via chrome://extensions
        // or about:debugging in Firefox). When the context is gone, runtime.id becomes undefined
        // — trigger a hard reload so the fresh content script can re-inject cleanly.
        const aliveCheck = setInterval(() => {
            try {
                // Both Chrome and Firefox expose chrome.runtime.id; in Firefox the chrome
                // namespace is a compat alias for browser. If the extension context is
                // invalidated the property access throws or returns undefined.
                if (!chrome.runtime?.id) {
                    clearInterval(aliveCheck);
                    window.location.reload();
                }
            } catch {
                clearInterval(aliveCheck);
                window.location.reload();
            }
        }, 1000);

        // Keep the OPAL session alive by pinging the home page every 15 minutes.
        // Without this, OPAL's Wicket session times out while the user reads/works,
        // forcing a full login after returning to the tab.
        setInterval(() => {
            opal.fetchHtml(location.origin + '/opal/home', { method: 'HEAD', priority: 'view', stateful: true, cache: 'no-store' })
                .catch(() => { /* ignore network errors */ });
        }, 15 * 60 * 1000);

        // OPAL loads portlet content via Wicket AJAX, which may not be ready
        // when our script first runs. Poll every 5s for 30s to catch late-
        // loading content. The MutationObserver handles updates after that.
        const scrapeInterval = setInterval(() => updateWidgetsContent(), 5000);
        setTimeout(() => clearInterval(scrapeInterval), 30_000);

        // Active pre-indexer: fires at 8 s so the first widget scrape (5 s) has had
        // time to populate the Fuse.js course index used by matchEventToCourse().
        setTimeout(() => indexUpcomingCourses().catch(console.warn), 8000);

        console.log(`[OPAL Redesign] Dashboard ready — ${WIDGETS.size} widgets, ${state.layout.filter(l => !l.hidden).length} visible`);
    } catch (error) {
        ready = false;
        console.warn('[OPAL] Dashboard initialization failed:', error);
    } finally {
        if (!ready) {
            document.documentElement.classList.remove('opal-modern-pending');
            document.body?.classList.remove('opal-mod-active');
            document.getElementById(ROOT_ID)?.remove();
        }
    }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
} else {
    init();
}

// Passive indexer: runs on every OPAL page (not just home) to build the search index.
// On non-home pages the dashboard is not rendered, but we still record the visited node.
(async () => {
    if (isHomePage()) return; // home page indexing is handled inside init() via bootstrapFromDashboard
    try {
        if (!await isExtensionEnabled()) return;
        await initSearchEngine();
        if (window.self === window.top) startIndexRequestWatchers();
        await indexCurrentPage();

        // Check if we arrived here via Command Center file navigation — highlight the target row
        await checkAndHighlightFile();

        // Watch for Wicket AJAX table updates (e.g. navigating into subfolders).
        // When OPAL replaces the table body, re-scrape the new file rows.
        let fileDebounce: number | null = null;
        const fileObserver = new MutationObserver(() => {
            if (fileDebounce) window.clearTimeout(fileDebounce);
            fileDebounce = window.setTimeout(() => {
                indexFilesOnPage().catch(console.warn);
            }, 600);
        });
        // Observe the whole body for subtree changes — OPAL may replace entire
        // container divs, not just tbody rows, so a narrow target would break.
        fileObserver.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
        console.warn('[Search] Passive indexer error:', e);
    }
})();

let togglingEdit = false;
async function toggleEditMode(): Promise<void> {
    if (togglingEdit) return;
    togglingEdit = true;
    if (state.editMode) await Promise.all([...document.querySelectorAll<HTMLElement>('#opal-modern-ui .widget-actions, #opal-hidden-panel')].map(exit));
    state.editMode = !state.editMode;
    render();
    togglingEdit = false;
}
