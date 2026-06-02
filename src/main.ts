/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Modular Dashboard
   Entry Point (GridStack-powered)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { DashboardState, CourseItem } from './types';
import { loadLayout, saveLayout, getDefaultLayout } from './layout';
import { scrapeUserInfo, buildTopbar } from './topbar';
import { buildWidgetGrid } from './grid';
import { safeClick } from './settings';
import { WIDGETS } from './widgets/index';
import { GridStack } from 'gridstack';
import { updateCalendarHeight } from './widgets/calendar';
import { updateCourseIndex, setMatchThreshold } from './course-matcher';
import { loadCalendarSettings } from './calendar-store';
import { initMensa, loadMensaSettings } from './mensa-store';
import { initSearchEngine } from './core/search-engine';
import { indexCurrentPage, bootstrapFromDashboard, indexFilesOnPage, checkAndHighlightFile, indexCourseCatalog, loadCatalogSettings, saveCatalogSettings, getCatalogLastRun, isCatalogStale, indexUpcomingCourses, indexFavoriteCourses, loadActiveIndexSettings, saveActiveIndexSettings, getActiveIndexLastRun } from './indexer';
import { loadTheme, applyTheme } from './theme';
import { openThemeEditor } from './theme-editor';
import { injectStyledLoginDialog, watchForLoginDialog } from './login';
import { bindEditModeHandlers } from './edit-mode';
import { registerMensaClickHandlers } from './mensa-modal';
import { openCommandCenter, bindCommandCenter } from './command-center';

/* ── Globals ──────────────────────────────────────────────────── */
const state: DashboardState = {
    layout: [],
    editMode: false,
};
let grid: GridStack | null = null;
let isGridBusy = false;

/** Normalised URL pathname → CourseItem for the user's favorite/enrolled courses.
 *  Populated from the Favorites & Courses widgets on every scrape cycle. */
const favoriteCourses = new Map<string, CourseItem>();

const ROOT_ID = 'opal-modern-ui';
const ENABLED_STORAGE_KEY = 'opalRedesignEnabled';

/** Popup-controlled master switch. Defaults to enabled for existing installs. */
async function isExtensionEnabled(): Promise<boolean> {
    return new Promise(resolve => {
        if (typeof chrome === 'undefined' || !chrome.storage) {
            resolve(true);
            return;
        }
        chrome.storage.local.get({ [ENABLED_STORAGE_KEY]: true }, result => {
            resolve(result[ENABLED_STORAGE_KEY] !== false);
        });
    });
}

/* ── Page detection ───────────────────────────────────────────── */
function isHomePage(): boolean {
    return (
        location.pathname.startsWith('/opal/home') ||
        location.pathname === '/opal/' ||
        location.pathname === '/opal'
    );
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

/* ── Main render ──────────────────────────────────────────────── */
function render(): void {
    // Destroy old GridStack instance if it exists
    if (grid) {
        grid.destroy(false);
        grid = null;
    }

    /** Update the inline-styled toggle slider appearance based on checked state. */
    function updateToggleVisual(input: HTMLInputElement): void {
        const label = input.parentElement;
        if (!label) return;
        const track = label.children[1] as HTMLElement | undefined;
        const thumb = label.children[2] as HTMLElement | undefined;
        if (track) track.style.background = input.checked ? 'var(--color-opal-accent)' : 'var(--color-opal-divider)';
        if (thumb) thumb.style.transform = input.checked ? 'translateX(16px)' : 'translateX(0)';
    }

    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        document.body.prepend(root);
        document.body.classList.add('opal-mod-active');
    }

    const user = scrapeUserInfo();
    const topbar = buildTopbar(user, state.editMode);
    const gridHtml = buildWidgetGrid(state.layout, WIDGETS, state.editMode);

    root.innerHTML = topbar + gridHtml;

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
        });

        // Guard: suppress MutationObserver during drag/resize
        grid.on('dragstart resizestart', () => { isGridBusy = true; });
        grid.on('dragstop', () => {
            setTimeout(() => { isGridBusy = false; }, 300);
        });
        grid.on('resizestop', (_event: Event, el: any) => {
            setTimeout(() => { isGridBusy = false; }, 300);
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
        state.editMode = !state.editMode;
        render();
    });

    // Bind edit mode buttons
    if (state.editMode) {
        bindEditModeHandlers(state, () => grid, render, updateWidgetsContent);
    }

    // Bind reset layout button
    const resetBtn = document.getElementById('opal-reset-layout');
    resetBtn?.addEventListener('click', async () => {
        state.layout = getDefaultLayout();
        await saveLayout(state.layout);
        render();
    });

    // Bind theme editor button (edit mode only)
    document.getElementById('opal-theme-btn')?.addEventListener('click', () => openThemeEditor());

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

    // Bind user avatar → toggle our custom dropdown
    const userBtn = document.getElementById('opal-user-btn');
    const userDropdown = document.getElementById('opal-user-dropdown');
    if (userBtn && userDropdown) {
        userBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = userDropdown.style.display !== 'none';
            userDropdown.style.display = open ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!userDropdown.contains(e.target as Node) && e.target !== userBtn) {
                userDropdown.style.display = 'none';
            }
        });

        // "Dashboard anpassen" / "Bearbeitung beenden" item
        userDropdown.querySelector('[data-action="customize"]')?.addEventListener('click', () => {
            userDropdown.style.display = 'none';
            state.editMode = !state.editMode;
            render();
        });

        // OPAL native menu items — find the matching <a> in OPAL's header dropdown and click it
        userDropdown.querySelectorAll<HTMLElement>('[data-opal-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                userDropdown.style.display = 'none';
                const itemTitle = btn.getAttribute('title') ?? '';

                // The <a> elements exist in the DOM even when the dropdown is closed.
                // Find by title and click directly — no need to open the Bootstrap dropdown first.
                const match = document.querySelector<HTMLElement>(
                    `.header-functions-user .dropdown-menu a[title="${itemTitle}"]`
                );
                if (match) {
                    safeClick(match);
                }
            });
        });

        // ── Catalog toggle + refresh button ───────────────────────
        const catalogToggle = document.getElementById('opal-catalog-toggle') as HTMLInputElement | null;
        const catalogStatus = document.getElementById('opal-catalog-status');
        const catalogRefresh = document.getElementById('opal-catalog-refresh');

        // Initialise toggle state + status text
        if (catalogToggle && catalogStatus) {
            loadCatalogSettings().then(s => {
                catalogToggle.checked = s.enabled;
                updateToggleVisual(catalogToggle);
            });
            getCatalogLastRun().then(last => {
                if (last === 0) {
                    catalogStatus.textContent = 'Noch nie indexiert';
                } else {
                    const ago = Math.round((Date.now() - last) / (1000 * 60));
                    if (ago < 60) catalogStatus.textContent = `Aktualisiert vor ${ago} Min.`;
                    else if (ago < 1440) catalogStatus.textContent = `Aktualisiert vor ${Math.round(ago / 60)} Std.`;
                    else catalogStatus.textContent = `Aktualisiert vor ${Math.round(ago / 1440)} Tagen`;
                }
            });

            catalogToggle.addEventListener('change', async () => {
                const enabled = catalogToggle.checked;
                updateToggleVisual(catalogToggle);
                await saveCatalogSettings({ enabled });
                if (enabled && await isCatalogStale()) {
                    catalogStatus.textContent = 'Indexierung läuft…';
                    indexCourseCatalog()
                        .then(() => { catalogStatus.textContent = 'Indexierung abgeschlossen ✓'; })
                        .catch(() => { catalogStatus.textContent = 'Fehler bei der Indexierung'; });
                }
            });
        }

        if (catalogRefresh) {
            catalogRefresh.addEventListener('click', () => {
                userDropdown.style.display = 'none';
                if (catalogStatus) catalogStatus.textContent = 'Indexierung läuft…';
                indexCourseCatalog(true)
                    .then(() => { if (catalogStatus) catalogStatus.textContent = 'Indexierung abgeschlossen ✓'; })
                    .catch(() => { if (catalogStatus) catalogStatus.textContent = 'Fehler bei der Indexierung'; });
            });
        }

        // ── Active index toggle (upcoming courses) ────────────
        const activeToggle = document.getElementById('opal-active-index-toggle') as HTMLInputElement | null;
        const activeStatus = document.getElementById('opal-active-index-status');

        if (activeToggle && activeStatus) {
            loadActiveIndexSettings().then(s => {
                activeToggle.checked = s.enabled;
                updateToggleVisual(activeToggle);
            });
            getActiveIndexLastRun().then(last => {
                if (last === 0) {
                    activeStatus.textContent = 'Noch nie indexiert';
                } else {
                    const ago = Math.round((Date.now() - last) / (1000 * 60));
                    if (ago < 60) activeStatus.textContent = `Aktualisiert vor ${ago} Min.`;
                    else if (ago < 1440) activeStatus.textContent = `Aktualisiert vor ${Math.round(ago / 60)} Std.`;
                    else activeStatus.textContent = `Aktualisiert vor ${Math.round(ago / 1440)} Tagen`;
                }
            });

            activeToggle.addEventListener('change', async () => {
                updateToggleVisual(activeToggle);
                await saveActiveIndexSettings({ enabled: activeToggle.checked });
                if (activeToggle.checked) {
                    activeStatus.textContent = 'Indexierung läuft…';
                    indexUpcomingCourses()
                        .then(() => { activeStatus.textContent = 'Indexierung abgeschlossen ✓'; })
                        .catch(() => { activeStatus.textContent = 'Fehler bei der Indexierung'; });
                }
            });
        }

        const activeRefresh = document.getElementById('opal-active-index-refresh');
        if (activeRefresh && activeStatus) {
            activeRefresh.addEventListener('click', () => {
                userDropdown.style.display = 'none';
                activeStatus.textContent = 'Indexierung läuft…';
                // Manual refresh: index all favorites (not just calendar-matched ones), force=true
                indexFavoriteCourses(favoriteCourses, true)
                    .then(() => { activeStatus.textContent = 'Indexierung abgeschlossen ✓'; })
                    .catch(() => { activeStatus.textContent = 'Fehler bei der Indexierung'; });
            });
        }
    }

    // State A auto-detect: if page loaded already showing the Wicket login dialog,
    // immediately replace it with our styled overlay (no click needed)
    if (document.querySelector('button[name*="shibLogin"]')) {
        injectStyledLoginDialog();
    }
}

/* ── Dynamic Content Updates ──────────────────────────────────── */
function updateWidgetsContent(): void {
    if (!grid) return;

    // Collect courses/favorites for the fuzzy matcher
    const allCourses: CourseItem[] = [];
    const items = grid.getGridItems();

    items.forEach(item => {
        const widgetId = item.getAttribute('gs-id');
        if (!widgetId) return;
        const widget = [...WIDGETS.values()].find(w => w.id === widgetId);
        if (!widget) return;

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
            if (contentDiv && contentDiv.innerHTML !== newContent) {
                contentDiv.innerHTML = newContent;
            }
        } catch (err) {
            console.warn(`[OPAL] Failed to update widget ${widgetId}:`, err);
        }
    });

    // Update the Fuse.js index with fresh course data
    if (allCourses.length > 0) {
        updateCourseIndex(allCourses);

        // Keep favoriteCourses in sync so Command Center can prioritise them
        favoriteCourses.clear();
        for (const c of allCourses) {
            try { favoriteCourses.set(new URL(c.href, location.origin).pathname.replace(/\/$/, ''), c); }
            catch { /* skip malformed */ }
        }
    }
}

/* ── DOM Observer ─────────────────────────────────────────────── */
function initObserver(): void {
    let debounceTimer: number | null = null;
    const observer = new MutationObserver((mutations) => {
        // Skip while GridStack is actively dragging/resizing
        if (isGridBusy) return;

        // Ignore mutations inside our own overlay to avoid infinite loops
        const isOwnMutation = mutations.every(m => {
            const target = m.target as HTMLElement;
            return target.closest?.('#opal-modern-ui') || target.closest?.('#opal-settings-modal');
        });
        if (isOwnMutation) return;

        if (debounceTimer) window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
            updateWidgetsContent();
        }, 500);
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: false });
}

/* ── Bootstrap ────────────────────────────────────────────────── */
async function init(): Promise<void> {
    // Never run our dashboard inside hidden iframes (e.g. catalog indexer)
    if (window.self !== window.top) return;

    if (!await isExtensionEnabled()) return;

    if (!isHomePage()) return;

    // Apply saved theme before any rendering to avoid flash
    applyTheme(await loadTheme());

    state.layout = await loadLayout();

    // Load saved match threshold before rendering
    const calSettings = await loadCalendarSettings();
    setMatchThreshold(calSettings.matchThreshold ?? 0.4);

    // Load mensa settings (canteen choice + favourites) before fetching meals
    await loadMensaSettings();

    // Pre-fetch Mensa meals so mensa widget scrape() has data on first render
    await initMensa();

    render();
    bindCommandCenter(favoriteCourses);
    initObserver();
    registerMensaClickHandlers(() => updateWidgetsContent());

    // Initialise the smart search engine (Orama + Dexie), seed from dashboard portlets.
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
        fetch(location.origin + '/opal/home', { method: 'HEAD', credentials: 'include', cache: 'no-store' })
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
