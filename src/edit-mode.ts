/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Edit Mode
   Widget hide/show/config handlers and native settings modal.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { GridStack } from 'gridstack';
import type { DashboardState } from './types';
import { WIDGETS } from './widgets/index';
import { toggleWidgetVisibility, saveLayout } from './layout';
import { openNativeConfig, renderSettingsModal, applyAndSaveConfig, cancelNativeConfig, openCalendarSettings } from './settings';
import { ensurePortlet, removePortlet } from './portlet-manager';
import { openMensaSettings } from './mensa-modal';

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
function visiblePortletOrders(state: DashboardState, excludeId?: string): Set<string> {
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

/**
 * Bind hide/show/config button handlers for edit mode.
 * @param state         Dashboard state (modified in place for visibility toggles).
 * @param getGrid       Getter for the current GridStack instance.
 * @param render        Re-render callback.
 * @param onUpdate      Widget content refresh callback (used by mensa settings save).
 */
export function bindEditModeHandlers(
    state: DashboardState,
    getGrid: () => GridStack | null,
    render: () => void,
    onUpdate: () => void,
): void {
    // Hide buttons
    document.querySelectorAll<HTMLButtonElement>('.widget-hide-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const widgetId = btn.dataset.widgetId;
            if (!widgetId) return;

            // Remove from GridStack
            const item = document.querySelector(`.grid-stack-item[gs-id="${widgetId}"]`);
            const grid = getGrid();
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
                const stillNeeded = visiblePortletOrders(state); // widget is now hidden in state
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
            if (widget.id === 'mensa') { openMensaSettings(onUpdate); return; }

            // Native OPAL config
            const portletOrder = btn.dataset.portlet;
            if (!portletOrder) return;
            openNativeConfig(portletOrder);
            setTimeout(() => { showSettingsModal(portletOrder, widget.title, render); }, 500);
        });
    });
}

/* ── Native Settings Modal ────────────────────────────────────── */

/**
 * Show the native OPAL config modal for a widget.
 * @param render Re-render callback used after save/cancel.
 */
export function showSettingsModal(portletOrder: string, title: string, render: () => void): void {
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
