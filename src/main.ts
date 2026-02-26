/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Modular Dashboard
   Entry Point (GridStack-powered)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { DashboardState, LayoutEntry } from './types';
import { loadLayout, saveLayout, getDefaultLayout, toggleWidgetVisibility } from './layout';
import { scrapeUserInfo, buildTopbar } from './topbar';
import { buildWidgetGrid } from './grid';
import { openNativeConfig, renderSettingsModal, applyAndSaveConfig, openCalendarSettings } from './settings';
import { WIDGETS } from './widgets/index';
import { GridStack } from 'gridstack';
import { updateCalendarHeight } from './widgets/calendar';

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
            margin: 10,
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
        });
    });

    // Show buttons (hidden widgets panel)
    document.querySelectorAll<HTMLButtonElement>('.widget-show-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const widgetId = btn.dataset.widgetId;
            if (widgetId) {
                state.layout = toggleWidgetVisibility(state.layout, widgetId);
                saveLayout(state.layout);
                render();
            }
        });
    });

    // Config buttons
    document.querySelectorAll<HTMLButtonElement>('.widget-config-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const portletOrder = btn.dataset.portlet;
            if (!portletOrder) return;

            const widget = [...WIDGETS.values()].find(w => w.opalPortletOrder === portletOrder);
            if (!widget) return;

            // Calendar gets its own custom settings
            if (widget.id === 'calendar') {
                openCalendarSettings();
                return;
            }

            // Open native config first
            openNativeConfig(portletOrder);

            // Wait for OPAL to render the config form, then scrape and show our modal
            setTimeout(() => {
                showSettingsModal(portletOrder, widget.title);
            }, 500);
        });
    });
}

/* ── Settings Modal ───────────────────────────────────────────── */
import { cancelNativeConfig } from './settings';

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

/* ── Dynamic Content Updates ──────────────────────────────────── */
function updateWidgetsContent(): void {
    if (!grid) return;
    const items = grid.getGridItems();
    items.forEach(item => {
        const widgetId = item.getAttribute('gs-id');
        if (!widgetId) return;
        const widget = [...WIDGETS.values()].find(w => w.id === widgetId);
        if (!widget) return;

        try {
            const data = widget.scrape();
            const gsH = parseInt(item.getAttribute('gs-h') || '0') || undefined;
            const newContent = widget.render(data, gsH);
            const contentDiv = item.querySelector('.widget-content');
            if (contentDiv && contentDiv.innerHTML !== newContent) {
                contentDiv.innerHTML = newContent;
            }
        } catch (err) {
            console.warn(`[OPAL] Failed to update widget ${widgetId}:`, err);
        }
    });
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

/* ── Bootstrap ────────────────────────────────────────────────── */
async function init(): Promise<void> {
    if (!isHomePage()) return;

    console.log('[OPAL Redesign] Loading modular dashboard v2 (GridStack)...');

    state.layout = await loadLayout();
    render();
    initObserver();

    console.log(`[OPAL Redesign] Dashboard ready — ${WIDGETS.size} widgets, ${state.layout.filter(l => !l.hidden).length} visible`);
}

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
} else {
    init();
}
