import { getAvailablePortletOrders, isWidgetAvailable } from './widget-availability';
/* ━━ Widget Grid Renderer (GridStack-compatible) ━━━━━━━━━━━━━ */

import type { Widget, LayoutEntry } from './types';
import { escapeAttr, escapeHtml } from './utils';
import { formatNumber } from './i18n/core.ts';
import { t } from './i18n/messages/shell.ts';

/** Build a single widget card's inner HTML */
function buildWidgetCardContent(
  widget: Widget,
  content: string,
  editMode: boolean
): string {
  return `
    <div class="widget-header">
      ${editMode ? `
        <div class="widget-grip" title="${t('gridDragHint')}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="4" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="12" cy="20" r="2"/>
          </svg>
        </div>
      ` : ''}
      <div class="widget-title">
        <span class="widget-icon" aria-hidden="true">${widget.icon}</span>
        <h3>${escapeHtml(widget.title)}</h3>
      </div>
      <div class="widget-actions">
        ${editMode ? `
          ${(widget.hasNativeConfig || widget.hasSettings) ? `
            <button type="button" class="widget-config-btn" data-portlet="${widget.opalPortletOrder}" data-widget-id="${widget.id}" title="${t('gridSettings')}" aria-label="${escapeAttr(t('gridWidgetSettings', { widget: widget.title }))}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          ` : ''}
          <button type="button" class="widget-hide-btn" data-widget-id="${widget.id}" title="${t('gridHide')}" aria-label="${escapeAttr(t('gridHideWidget', { widget: widget.title }))}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
        ` : ''}
      </div>
    </div>
    <div class="widget-content">
      ${content}
    </div>`;
}

/** Render the full widget grid for GridStack */
export function buildWidgetGrid(
  layout: LayoutEntry[],
  widgets: Map<string, Widget>,
  editMode: boolean
): string {
  const visibleEntries = layout.filter(e => !e.hidden);
  const availableOrders = getAvailablePortletOrders();
  const hiddenEntries = layout.filter(e => e.hidden && isWidgetAvailable(e.widgetId, availableOrders));

  const widgetItems = visibleEntries.map(entry => {
    const widget = widgets.get(entry.widgetId);
    if (!widget) return '';

    let content: string;
    try {
      const data = widget.scrape();
      content = widget.render(data, entry.h, entry.w);
    } catch (err) {
      console.warn(`[OPAL] Widget ${entry.widgetId} error:`, err);
      content = `<div class="opal-empty"><p class="opal-empty-title">${t('gridLoadFailed')}</p><p class="opal-empty-hint">${t('gridLoadRetry')}</p></div>`;
    }

    const cardContent = buildWidgetCardContent(widget, content, editMode);

    // GridStack item with gs-* attributes
    return `
        <div class="grid-stack-item"
             gs-id="${widget.id}" gs-x="${entry.x}" gs-y="${entry.y}" gs-w="${entry.w}" gs-h="${entry.h}"
             gs-min-w="${widget.minW ?? 2}" gs-min-h="${widget.minH ?? 2}">
          <div class="grid-stack-item-content widget-card ${editMode ? 'edit-mode-active' : ''}" data-widget-id="${widget.id}">
            ${cardContent}
          </div>
        </div>`;
  }).join('');

  // Hidden widgets panel (shown in edit mode)
  const hiddenPanel = editMode && hiddenEntries.length > 0 ? `
    <section id="opal-hidden-panel" class="mt-8 mx-3" aria-labelledby="opal-hidden-panel-title">
      <div class="flex items-baseline gap-2 mb-3">
        <h3 id="opal-hidden-panel-title" class="opal-section-title">${t('gridHidden')}</h3>
        <span class="opal-row-meta">${formatNumber(hiddenEntries.length)}</span>
      </div>
      <div class="grid gap-2 grid-cols-[repeat(auto-fill,minmax(224px,1fr))]">
        ${hiddenEntries.map(entry => {
    const widget = widgets.get(entry.widgetId);
    if (!widget) return '';
    return `
          <button type="button" class="widget-show-btn bento-card" data-widget-id="${entry.widgetId}" aria-label="${escapeAttr(t('gridShowWidget', { widget: widget.title }))}">
            <span class="flex flex-shrink-0" aria-hidden="true">${widget.icon}</span>
            <span class="opal-row-title">${escapeHtml(widget.title)}</span>
            <span class="opal-row-meta" aria-hidden="true">${t('gridShow')}</span>
          </button>`;
  }).join('')}
      </div>
    </section>` : '';

  return `
    <main class="w-full flex-1 p-6 md:p-8 max-w-7xl mx-auto">
      <div id="opal-widget-grid" class="grid-stack ${editMode ? 'edit-mode' : ''}">
        ${widgetItems}
      </div>
      ${hiddenPanel}
    </main>`;
}
