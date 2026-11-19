import { openSurface, closeSurface } from './motion';
import { localeTag } from './i18n/core.ts';
import { t } from './i18n/messages/shell.ts';
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Edit Mode
   Widget hide/show/config handlers and native settings modal.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { GridStack } from 'gridstack';
import type { DashboardState } from './types';
import { WIDGETS } from './widgets/index';
import { toggleWidgetVisibility, saveLayout } from './layout';
import { openNativeConfig, renderSettingsModal, applyAndSaveConfig, cancelNativeConfig, openCalendarSettings, bindDialogKeyboard } from './settings';
import { ensurePortlet } from './portlet-manager';
import { openMensaSettings } from './mensa-modal';
import { openWhatsNewSettings } from './widgets/whats-new';

/* ── Portlet order helpers ────────────────────────────────────── */

/** Normalize opalPortletOrder (string or string[]) to an array. */
function getPortletOrders(widget: { opalPortletOrder: string | string[] }): string[] {
    return (Array.isArray(widget.opalPortletOrder)
        ? widget.opalPortletOrder
        : [widget.opalPortletOrder]).filter(Boolean);
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

            // Visibility is local; native portlets stay mounted to keep data flowing.

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
            if (widget.id === 'whats-new') { openWhatsNewSettings(onUpdate); return; }

            // Native OPAL config
            const portletOrder = btn.dataset.portlet;
            if (!portletOrder) return;
            showSettingsModal(portletOrder, widget.title, render, true);
            openNativeConfig(portletOrder);

        });
    });
}

/**
 * Resolves once the portlet's native config form has a field in it, or after
 * `timeoutMs` so the dialog can say that nothing arrived.
 */
function waitForConfigForm(portletOrder: string, timeoutMs = 6000): Promise<void> {
    return new Promise(resolve => {
        const start = Date.now();
        const check = () => {
            const form = document.querySelector(
                `div[data-portlet-order="${CSS.escape(portletOrder)}"] .panel-config`
            );
            if (form?.querySelector('input, select') || Date.now() - start > timeoutMs) {
                resolve();
                return;
            }
            setTimeout(check, 100);
        };
        check();
    });
}

/* ── Native Settings Modal ────────────────────────────────────── */

/**
 * Show the native OPAL config modal for a widget.
 * @param render Re-render callback used after save/cancel.
 */
export function showSettingsModal(portletOrder: string, title: string, render: () => void, loading = false): void {
    document.getElementById('opal-settings-modal')?.remove();

    const modalHtml = renderSettingsModal(portletOrder, title, loading);

    const overlay = document.createElement('div');
    overlay.id = 'opal-settings-modal';
    overlay.className = 'settings-overlay';
    overlay.lang = localeTag();
    overlay.innerHTML = `
    <div class="settings-modal-container">
      ${modalHtml}
    </div>`;

    document.body.appendChild(overlay);
    openSurface(overlay);

    let releaseFocus: (() => void) | null = null;
    let saving = false;
    const closeModal = () => {
        if (saving) return;
        cancelNativeConfig(portletOrder);
        void closeSurface(overlay, () => releaseFocus?.());
        setTimeout(() => {
            render(); // Re-render to show restored widget content
            // The grid was rebuilt, so the button that opened the dialog is gone: focus its replacement.
            if (document.activeElement && document.activeElement !== document.body) return;
            document.querySelector<HTMLElement>(`.widget-config-btn[data-portlet="${CSS.escape(portletOrder)}"]`)?.focus();
        }, 500);
    };

    // Focus moves into the dialog, Tab stays inside, Escape cancels.
    releaseFocus = bindDialogKeyboard(overlay, closeModal);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    if (loading) void waitForConfigForm(portletOrder).then(() => {
        if (!overlay.isConnected) return;
        const container = overlay.querySelector('.settings-modal-container');
        if (container) container.innerHTML = renderSettingsModal(portletOrder, title);
        overlay.querySelector<HTMLElement>('input, select, button')?.focus();
    });

    overlay.addEventListener('click', (event) => {
        const target = event.target as Element;
        if (target.closest('.widget-settings-close')) { closeModal(); return; }
        if (!target.closest('.widget-settings-save') || saving) return;
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

        saving = true;
        overlay.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
        const status = document.createElement('p');
        status.className = 'opal-caption'; status.role = 'status'; status.textContent = t('editSaving');
        overlay.querySelector('.settings-modal-footer')?.append(status);
        const panel = document.querySelector(`div[data-portlet-order="${CSS.escape(portletOrder)}"] .panel-config`);
        applyAndSaveConfig(portletOrder, values);
        const started = Date.now();
        const finish = () => {
            // OPAL normally removes the form after save. Keep the old timed close as fallback.
            if (!panel?.isConnected || Date.now() - started >= 3000) {
                void closeSurface(overlay, () => releaseFocus?.()); setTimeout(render, 1000); return;
            }
            setTimeout(finish, 100);
        };
        finish();
    });
}
