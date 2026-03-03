/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Modular Dashboard
   Entry Point (GridStack-powered)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { DashboardState, CourseItem } from './types';
import { loadLayout, saveLayout, getDefaultLayout, toggleWidgetVisibility } from './layout';
import { scrapeUserInfo, buildTopbar } from './topbar';
import { buildWidgetGrid } from './grid';
import { openNativeConfig, renderSettingsModal, applyAndSaveConfig, openCalendarSettings, safeClick, cancelNativeConfig } from './settings';
import { WIDGETS } from './widgets/index';
import { GridStack } from 'gridstack';
import { updateCalendarHeight } from './widgets/calendar';
import { updateCourseIndex, setMatchThreshold } from './course-matcher';
import { loadCalendarSettings } from './calendar-store';
import { ensurePortlet, removePortlet } from './portlet-manager';
import { initMensa, loadMensaSettings, saveMensaSettings, toggleMensaFavorite, getMensaSettings, setViewDate, setViewCanteen, toggleFavoritesView, initFavoritesView, CANTEENS } from './mensa-store';
import { initSearchEngine, searchNodes } from './core/search-engine';
import type { SearchResult } from './core/search-engine';
import { indexCurrentPage, bootstrapFromDashboard, indexFilesOnPage, checkAndHighlightFile } from './indexer';
import { db } from './core/index-db';

/* ── Globals ──────────────────────────────────────────────────── */
let state: DashboardState = {
    layout: [],
    editMode: false,
};
let grid: GridStack | null = null;
let isGridBusy = false;

const ROOT_ID = 'opal-modern-ui';

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
        bindEditModeHandlers();
    }

    // Bind reset layout button
    const resetBtn = document.getElementById('opal-reset-layout');
    resetBtn?.addEventListener('click', async () => {
        state.layout = getDefaultLayout();
        await saveLayout(state.layout);
        render();
    });

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
    }

    // State A auto-detect: if page loaded already showing the Wicket login dialog,
    // immediately replace it with our styled overlay (no click needed)
    if (document.querySelector('button[name*="shibLogin"]')) {
        injectStyledLoginDialog();
    }
}

/* ── Styled Login Overlay ─────────────────────────────────────── */

/** Hide OPAL's jQuery UI login dialog and show a styled replacement. */
function injectStyledLoginDialog(): void {
    if (document.getElementById('opal-login-overlay')) return;

    const shibSubmit  = document.querySelector<HTMLButtonElement>('button[name*="shibLogin"]');
    const nativeSelect = document.querySelector<HTMLSelectElement>('select[name*="wayfselection"]');
    const nativeDialog = document.querySelector<HTMLElement>('.ui-dialog');

    if (!shibSubmit || !nativeSelect) return;

    // Hide the native jQuery UI dialog (but keep it in DOM so safeClick still works)
    if (nativeDialog) nativeDialog.style.display = 'none';

    // Mirror institution options from the native select
    const options = Array.from(nativeSelect.options).map(opt =>
        `<option value="${opt.value}"${opt.selected ? ' selected' : ''}>${opt.text}</option>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.id = 'opal-login-overlay';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:10000',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:var(--color-opal-overlay)', 'backdrop-filter:blur(6px)',
    ].join(';');

    overlay.innerHTML = `
        <div style="background:var(--color-opal-surface);border:1px solid var(--color-opal-glass-border);border-radius:20px;
                    padding:2rem;width:380px;max-width:calc(100vw - 2rem);
                    box-shadow:0 32px 80px var(--color-opal-shadow)">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:1.5rem">
                <span style="font-size:1.5rem;font-weight:900;color:var(--color-opal-text);letter-spacing:-0.05em">OPAL</span>
                <div style="width:6px;height:6px;border-radius:50%;background:var(--color-opal-accent);margin-left:2px"></div>
                <span style="font-size:0.75rem;color:var(--color-opal-text-muted);margin-left:auto">Anmelden</span>
            </div>
            <p style="font-size:0.8125rem;color:var(--color-opal-text-muted);margin-bottom:1.25rem;line-height:1.5">
                Melden Sie sich mit Ihrem Hochschul-Login an.
            </p>
            <label style="display:block;font-size:0.6875rem;font-weight:700;
                          color:var(--color-opal-text-muted);text-transform:uppercase;
                          letter-spacing:0.06em;margin-bottom:0.5rem">Institution</label>
            <select id="opal-login-institution"
                    style="width:100%;background:var(--color-opal-bg);border:1px solid var(--color-opal-glass-highlight);
                           border-radius:10px;color:var(--color-opal-text);padding:0.625rem 0.875rem;font-size:0.875rem;
                           margin-bottom:1.5rem;outline:none;cursor:pointer;
                           appearance:auto;-webkit-appearance:auto">
                ${options}
            </select>
            <button id="opal-login-submit"
                    style="width:100%;background:var(--color-opal-accent);color:var(--color-opal-on-accent);border:none;border-radius:10px;
                           padding:0.8rem;font-size:0.875rem;font-weight:600;cursor:pointer;
                           letter-spacing:0.01em;transition:opacity 0.15s">
                Mit Hochschule anmelden →
            </button>
        </div>`;

    document.body.appendChild(overlay);

    const submitBtn = document.getElementById('opal-login-submit');
    submitBtn?.addEventListener('mouseover', () => { (submitBtn as HTMLElement).style.opacity = '0.85'; });
    submitBtn?.addEventListener('mouseout',  () => { (submitBtn as HTMLElement).style.opacity = '1'; });
    submitBtn?.addEventListener('click', () => {
        const sel = document.getElementById('opal-login-institution') as HTMLSelectElement;
        nativeSelect.value = sel.value;
        safeClick(shibSubmit);
    });
}

/** Watch for OPAL's Wicket login dialog to appear, then style it. */
function watchForLoginDialog(): void {
    const obs = new MutationObserver(() => {
        if (document.querySelector('button[name*="shibLogin"]')) {
            obs.disconnect();
            injectStyledLoginDialog();
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 5000); // give up after 5 s
}


/* ── Portlet order helpers ────────────────────────────────────── */

/** Normalize opalPortletOrder (string or string[]) to an array. */
function getPortletOrders(widget: { opalPortletOrder: string | string[] }): string[] {
    return Array.isArray(widget.opalPortletOrder)
        ? widget.opalPortletOrder
        : [widget.opalPortletOrder];
}

/**
 * Returns the set of portlet orders that are currently claimed by at least
 * one VISIBLE widget (optionally excluding one widget by id).
 * Used to avoid removing a portlet that another widget still needs.
 */
function visiblePortletOrders(excludeId?: string): Set<string> {
    return new Set(
        state.layout
            .filter(e => !e.hidden && e.widgetId !== excludeId)
            .flatMap(e => {
                const w = WIDGETS.get(e.widgetId);
                return w ? getPortletOrders(w) : [];
            })
    );
}

/* ── Edit Mode Event Handlers ─────────────────────────────────── */
function bindEditModeHandlers(): void {
    // Hide buttons
    document.querySelectorAll<HTMLButtonElement>('.widget-hide-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const widgetId = btn.dataset.widgetId;
            if (!widgetId) return;

            // Remove from GridStack
            const item = document.querySelector(`.grid-stack-item[gs-id="${widgetId}"]`);
            if (item && grid) {
                grid.removeWidget(item as HTMLElement, false);
            }

            state.layout = toggleWidgetVisibility(state.layout, widgetId);
            saveLayout(state.layout);
            render();

            // Only remove portlets not still needed by another visible widget.
            // Run sequentially — removePortlet uses the same dropdown per portlet,
            // parallel calls would race on OPAL's Wicket UI.
            const widget = [...WIDGETS.values()].find(w => w.id === widgetId);
            if (widget) {
                const stillNeeded = visiblePortletOrders(); // widget is now hidden in state
                (async () => {
                    for (const order of getPortletOrders(widget)) {
                        if (!stillNeeded.has(order)) {
                            try { await removePortlet(order); }
                            catch (err) { console.warn('[OPAL] removePortlet failed silently:', err); }
                        }
                    }
                })();
            }
        });
    });

    // Show buttons (hidden widgets panel)
    document.querySelectorAll<HTMLButtonElement>('.widget-show-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const widgetId = btn.dataset.widgetId;
            if (!widgetId) return;

            state.layout = toggleWidgetVisibility(state.layout, widgetId);
            saveLayout(state.layout);
            render();

            // Ensure all portlet orders for this widget sequentially —
            // OPAL's "Add Portlets" dialog can only handle one add at a time,
            // so parallel calls would race and both time out waiting for the dialog to close.
            const widget = [...WIDGETS.values()].find(w => w.id === widgetId);
            if (widget) {
                (async () => {
                    for (const order of getPortletOrders(widget)) {
                        try { await ensurePortlet(order); }
                        catch (err) { console.warn('[OPAL] ensurePortlet failed silently:', err); }
                    }
                })();
            }
        });
    });

    // Config buttons — handle both native OPAL and custom settings widgets
    document.querySelectorAll<HTMLButtonElement>('.widget-config-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const widgetId = btn.dataset.widgetId;
            const widget = widgetId ? WIDGETS.get(widgetId) : undefined;
            if (!widget) return;

            // Custom settings modals (non-OPAL)
            if (widget.id === 'calendar') { openCalendarSettings(); return; }
            if (widget.id === 'mensa')    { openMensaSettings();    return; }

            // Native OPAL config
            const portletOrder = btn.dataset.portlet;
            if (!portletOrder) return;
            openNativeConfig(portletOrder);
            setTimeout(() => { showSettingsModal(portletOrder, widget.title); }, 500);
        });
    });
}

/* ── Settings Modal ───────────────────────────────────────────── */

function showSettingsModal(portletOrder: string, title: string): void {
    document.getElementById('opal-settings-modal')?.remove();

    const modalHtml = renderSettingsModal(portletOrder, title);

    const overlay = document.createElement('div');
    overlay.id = 'opal-settings-modal';
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
    <div class="settings-modal-container">
      ${modalHtml}
    </div>`;

    document.body.appendChild(overlay);

    const closeModal = () => {
        cancelNativeConfig(portletOrder);
        overlay.remove();
        setTimeout(() => render(), 500); // Re-render to show restored widget content
    };

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Close buttons (X and Abbrechen)
    overlay.querySelectorAll('.widget-settings-close').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    // Save button
    overlay.querySelector('.widget-settings-save')?.addEventListener('click', () => {
        const values: Record<string, unknown> = {};

        overlay.querySelectorAll<HTMLInputElement>('input[type="number"][data-name]').forEach(input => {
            values[input.dataset.name!] = parseInt(input.value, 10);
        });

        overlay.querySelectorAll<HTMLSelectElement>('select[data-name]').forEach(select => {
            values[select.dataset.name!] = select.value;
        });

        const checkboxes: { inputId: string; checked: boolean }[] = [];
        overlay.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-input-id]').forEach(cb => {
            checkboxes.push({ inputId: cb.dataset.inputId!, checked: cb.checked });
        });
        if (checkboxes.length > 0) {
            values.checkboxes = checkboxes;
        }

        applyAndSaveConfig(portletOrder, values);
        overlay.remove();
        setTimeout(() => render(), 1000);
    });
}

/* ── Mensa Settings Modal ─────────────────────────────────────── */
function buildFavMealList(names: string[]): string {
    return names.length > 0
        ? names.map(name => `
            <div class="flex items-center justify-between gap-2 py-1">
              <span class="text-xs text-opal-text truncate">${name}</span>
              <button class="mensa-settings-unfav text-opal-text-muted hover:text-opal-danger transition-colors text-[10px]"
                      data-meal-name="${encodeURIComponent(name)}">✕</button>
            </div>`).join('')
        : '<p class="text-xs text-opal-text-muted">Keine Favoriten gespeichert.</p>';
}

function openMensaSettings(): void {
    document.getElementById('opal-settings-modal')?.remove();

    const current = getMensaSettings();
    const favIds = new Set(current.favoriteCanteenIds);

    const canteenChecks = CANTEENS.map(c => `
        <label class="flex items-center gap-2.5 py-1 cursor-pointer group">
          <input type="checkbox" class="mensa-canteen-check accent-opal-accent w-3.5 h-3.5 cursor-pointer"
                 value="${c.id}" ${favIds.has(c.id) ? 'checked' : ''}>
          <span class="text-xs text-opal-text group-hover:text-white transition-colors">
            ${c.name}
            <span class="text-opal-text-muted ml-1">${c.location}</span>
          </span>
        </label>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'opal-settings-modal';
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
    <div class="settings-modal-container">
      <div class="widget-settings-modal" style="max-width:420px;width:calc(100vw - 2rem)">
      <div class="settings-modal-header">
        <div class="settings-modal-title-row">
          <h2 class="settings-modal-title">Mensa Einstellungen</h2>
        </div>
        <button class="widget-settings-close settings-modal-close-btn" title="Schließen">✕</button>
      </div>
      <div class="settings-modal-body" style="padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:1.25rem;">
        <div>
          <label class="text-xs font-bold text-opal-text-muted uppercase tracking-wider block mb-2">Favorite Mensen</label>
          <p class="text-[10px] text-opal-text-muted/60 mb-2">Markierte Mensen können im Widget mit den Pfeilen durchgewechselt werden.</p>
          <div id="mensa-canteen-list" class="space-y-0.5" style="max-height:220px;overflow-y:auto;">
            ${canteenChecks}
          </div>
        </div>
        <div>
          <label class="text-xs font-bold text-opal-text-muted uppercase tracking-wider block mb-2">Gemerkte Gerichte</label>
          <div id="mensa-fav-list" style="max-height:120px;overflow-y:auto;">${buildFavMealList(current.favoriteNames)}</div>
        </div>
      </div>
      <div class="settings-modal-footer">
        <button class="settings-save-btn widget-settings-save">Speichern</button>
      </div>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.widget-settings-close')?.addEventListener('click', close);

    // Unfav meal buttons — refresh list in-place
    overlay.querySelector('#mensa-fav-list')?.addEventListener('click', async (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.mensa-settings-unfav');
        if (!btn) return;
        const name = decodeURIComponent(btn.dataset.mealName ?? '');
        if (!name) return;
        await toggleMensaFavorite(name);
        const list = overlay.querySelector('#mensa-fav-list');
        if (list) list.innerHTML = buildFavMealList(getMensaSettings().favoriteNames);
    });

    // Save: collect checked canteens → save → re-fetch → re-render
    overlay.querySelector('.widget-settings-save')?.addEventListener('click', async () => {
        const checks = overlay.querySelectorAll<HTMLInputElement>('.mensa-canteen-check:checked');
        const newIds = Array.from(checks).map(cb => parseInt(cb.value, 10));
        // Require at least one canteen
        const ids = newIds.length > 0 ? newIds : [4];
        await saveMensaSettings({ ...getMensaSettings(), favoriteCanteenIds: ids });
        await initMensa(true);
        updateWidgetsContent();
        close();
    });
}

/* ── Mensa Nav + Favourite Event Delegation ───────────────────── */
document.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    // Date navigation
    const dateBtn = target.closest<HTMLButtonElement>('.mensa-nav-date');
    if (dateBtn) {
        setViewDate(parseInt(dateBtn.dataset.delta ?? '0', 10));
        await initMensa(true);
        updateWidgetsContent();
        return;
    }

    // Canteen navigation
    const canteenBtn = target.closest<HTMLButtonElement>('.mensa-nav-canteen');
    if (canteenBtn) {
        setViewCanteen(parseInt(canteenBtn.dataset.delta ?? '0', 10));
        await initMensa(true);
        updateWidgetsContent();
        return;
    }

    // Favorites view toggle (star button)
    const favViewBtn = target.closest<HTMLButtonElement>('.mensa-toggle-favview');
    if (favViewBtn) {
        toggleFavoritesView();
        await initFavoritesView();
        updateWidgetsContent();
        return;
    }

    // Meal favouriting
    const favBtn = target.closest<HTMLButtonElement>('.mensa-fav-btn');
    if (favBtn) {
        const name = decodeURIComponent(favBtn.dataset.mealName ?? '');
        if (name) {
            await toggleMensaFavorite(name);
            // If in favorites view, refresh the cross-canteen cache too
            await initFavoritesView();
            updateWidgetsContent();
        }
    }
});

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
    }
}

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

/* ── Command Center ───────────────────────────────────────────── */

/** Derive active course ID from the page breadcrumb (empty on home). */
function getActiveCourseId(): string {
    if (isHomePage()) return '';
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

const TYPE_ICON: Record<string, string> = {
    course: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    file:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    folder: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    action: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
};
const TYPE_COLOR: Record<string, string> = {
    course: 'var(--color-opal-accent)',
    file:   'var(--color-opal-warning)',
    folder: 'var(--color-opal-success)',
    action: 'var(--color-opal-text-muted)',
};

function renderCmdResults(results: SearchResult[], courseId: string, selectedIdx: number): string {
    if (results.length === 0) {
        return `<div style="padding:2rem 1rem;text-align:center;font-size:0.875rem;color:var(--color-opal-text-muted);">Keine Ergebnisse gefunden.</div>`;
    }
    return results.map((r, i) => {
        const n = r.node;
        const isSelected = i === selectedIdx;
        const isContextual = !!courseId && n.courseId === courseId;
        const color = TYPE_COLOR[n.type] ?? TYPE_COLOR.action;
        const ext = n.fileExtension ? ` · .${n.fileExtension.toUpperCase()}` : '';
        const bg = isSelected ? 'var(--color-opal-divider)' : 'transparent';
        return `<a class="opal-cmd-result" href="${n.url}" data-url="${n.url}" data-idx="${i}"
                   style="display:flex;align-items:center;gap:12px;padding:10px 16px;
                          cursor:pointer;text-decoration:none;background:${bg};transition:background 0.1s;">
              <span style="color:${color};flex-shrink:0;">${TYPE_ICON[n.type] ?? TYPE_ICON.action}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.875rem;font-weight:500;color:var(--color-opal-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n.title}</div>
                <div style="font-size:0.6875rem;color:var(--color-opal-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${n.type}${ext}</div>
              </div>
              ${isContextual ? `<span style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-opal-accent);background:var(--color-opal-accent-soft);padding:2px 6px;border-radius:4px;flex-shrink:0;">Aktuell</span>` : ''}
              <svg style="flex-shrink:0;color:var(--color-opal-text-muted);opacity:0.4;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </a>`;
    }).join('');
}

function openCommandCenter(): void {
    try {
        _openCommandCenter();
    } catch (err) {
        console.error('[OPAL] Command Center error:', err);
    }
}

function _openCommandCenter(): void {
    if (document.getElementById('opal-cmd-overlay')) return;
    const courseId = getActiveCourseId();

    const overlay = document.createElement('div');
    overlay.id = 'opal-cmd-overlay';
    // Use setProperty with 'important' priority so OPAL's !important CSS rules cannot override us
    const s = overlay.style;
    s.setProperty('position',        'fixed',             'important');
    s.setProperty('top',             '0',                 'important');
    s.setProperty('right',           '0',                 'important');
    s.setProperty('bottom',          '0',                 'important');
    s.setProperty('left',            '0',                 'important');
    s.setProperty('z-index',         '2147483647',        'important');
    s.setProperty('display',         'flex',              'important');
    s.setProperty('visibility',      'visible',           'important');
    s.setProperty('opacity',         '1',                 'important');
    s.setProperty('pointer-events',  'all',               'important');
    s.setProperty('align-items',     'flex-start',        'important');
    s.setProperty('justify-content', 'center',            'important');
    s.setProperty('padding-top',     '12vh',              'important');
    s.setProperty('background',      'var(--color-opal-overlay)',   'important');
    s.setProperty('backdrop-filter', 'blur(4px)',         'important');
    overlay.innerHTML = `
        <div id="opal-cmd-panel" style="width:100%;max-width:580px;margin:0 1rem;
             background:var(--color-opal-surface);border:1px solid var(--color-opal-glass-border);
             border-radius:16px;overflow:hidden;box-shadow:0 32px 80px var(--color-opal-shadow);">
          <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;
                      border-bottom:1px solid var(--color-opal-divider);">
            <svg style="color:var(--color-opal-text-muted);flex-shrink:0;" width="16" height="16" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input id="opal-cmd-input" type="text" autocomplete="off" spellcheck="false"
                   placeholder="Kurse, Dateien, Ordner suchen… (/c Kurse · /f Dateien)"
                   style="flex:1;background:transparent;border:none;outline:none;
                          color:var(--color-opal-text);font-size:0.9375rem;min-width:0;font-family:inherit;">
            <kbd style="font-size:10px;padding:2px 6px;border-radius:5px;
                        background:var(--color-opal-divider);border:1px solid var(--color-opal-divider);
                        color:var(--color-opal-text-muted);font-family:monospace;flex-shrink:0;">Esc</kbd>
          </div>
          <div id="opal-cmd-results" style="max-height:380px;overflow-y:auto;padding:6px 0;"></div>
          <div style="display:flex;justify-content:space-between;padding:8px 16px;
                      border-top:1px solid var(--color-opal-divider);">
            <span style="font-size:10px;color:var(--color-opal-text-muted);">/c Kurse &nbsp;·&nbsp; /f Dateien</span>
            <span style="font-size:10px;color:var(--color-opal-text-muted);">↑↓ navigieren &nbsp;·&nbsp; ↵ öffnen &nbsp;·&nbsp; Esc schließen</span>
          </div>
        </div>`;

    document.body.appendChild(overlay);

    const input    = document.getElementById('opal-cmd-input') as HTMLInputElement;
    const resultsEl = document.getElementById('opal-cmd-results')!;
    let results: SearchResult[] = [];
    let selectedIdx = 0;
    let debounce: number | undefined;

    const close = () => overlay.remove();

    const rerender = () => {
        resultsEl.innerHTML = renderCmdResults(results, courseId, selectedIdx);
    };

    const navigate = (delta: number) => {
        selectedIdx = Math.max(0, Math.min(results.length - 1, selectedIdx + delta));
        rerender();
        resultsEl.querySelectorAll<HTMLElement>('.opal-cmd-result')[selectedIdx]
            ?.scrollIntoView({ block: 'nearest' });
    };

    const openSelected = async () => {
        const result = results[selectedIdx];
        if (!result) return;
        const { node } = result;
        close();

        // For files: navigate to parent folder and highlight the file row
        if (node.type === 'file' && node.parentId) {
            const parent = await db.nodes.get(node.parentId);
            if (parent?.url) {
                chrome.storage.local.set({ opalHighlightFile: { title: node.title, url: node.url } });
                location.href = parent.url;
                return;
            }
        }
        // Default: direct navigation
        location.href = node.url;
    };

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        selectedIdx = 0;
        debounce = window.setTimeout(async () => {
            const q = input.value.trim();
            if (!q) { resultsEl.innerHTML = ''; return; }
            results = await searchNodes(q, courseId);
            rerender();
        }, 120);
    });

    input.addEventListener('keydown', (e) => {
        if      (e.key === 'Escape')    { e.preventDefault(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); navigate(+1); }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); navigate(-1); }
        else if (e.key === 'Enter')     { e.preventDefault(); openSelected(); }
    });

    // Close on backdrop click; navigate on result click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { close(); return; }
        const item = (e.target as HTMLElement).closest<HTMLElement>('.opal-cmd-result');
        if (item) {
            e.preventDefault();
            // Find the matching result to use the same file-navigation logic
            const idx = Array.from(resultsEl.querySelectorAll('.opal-cmd-result')).indexOf(item);
            if (idx >= 0) { selectedIdx = idx; }
            openSelected();
        }
    });

    requestAnimationFrame(() => input.focus());
}

/** Register Cmd+K shortcut (one-time; button click is bound directly in render()). */
function bindCommandCenter(): void {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            e.stopPropagation();
            openCommandCenter();
        }
    }, true);
}

/* ── Bootstrap ────────────────────────────────────────────────── */
async function init(): Promise<void> {
    if (!isHomePage()) return;

    state.layout = await loadLayout();

    // Load saved match threshold before rendering
    const calSettings = await loadCalendarSettings();
    setMatchThreshold(calSettings.matchThreshold ?? 0.4);

    // Load mensa settings (canteen choice + favourites) before fetching meals
    await loadMensaSettings();

    // Pre-fetch Mensa meals so mensa widget scrape() has data on first render
    await initMensa();

    render();
    bindCommandCenter();
    initObserver();

    // Initialise the smart search engine (Orama + Dexie) and seed from dashboard portlets
    initSearchEngine().then(() => bootstrapFromDashboard()).catch(console.warn);

    // Detect extension context invalidation (e.g. extension reloaded via chrome://extensions).
    // When the context is gone, chrome.runtime.id becomes undefined — trigger a hard reload
    // so the fresh content script can re-inject cleanly.
    const aliveCheck = setInterval(() => {
        if (!chrome.runtime?.id) {
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
