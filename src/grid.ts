/* ━━ Widget Grid Renderer (GridStack-compatible) ━━━━━━━━━━━━━ */

import type { Widget, LayoutEntry } from './types';
import { escapeHtml } from './utils';

/** Build a single widget card's inner HTML */
function buildWidgetCardContent(
  widget: Widget,
  content: string,
  editMode: boolean
): string {
  return `
    <div class="widget-header">
      ${editMode ? `
        <div class="widget-grip" title="Drag to reorder">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="4" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="5" cy="20" r="2"/><circle cx="12" cy="20" r="2"/>
          </svg>
        </div>
      ` : ''}
      <div class="widget-title">
        <span class="widget-icon">${widget.icon}</span>
        <h3>${escapeHtml(widget.title)}</h3>
      </div>
      <div class="widget-actions">
        ${editMode ? `
          ${(widget.hasNativeConfig || widget.hasSettings) ? `
            <button class="widget-config-btn" data-portlet="${widget.opalPortletOrder}" data-widget-id="${widget.id}" title="Einstellungen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          ` : ''}
          <button class="widget-hide-btn" data-widget-id="${widget.id}" title="Verstecken">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
  const hiddenEntries = layout.filter(e => e.hidden);

  const widgetItems = visibleEntries.map((entry, idx) => {
    const widget = widgets.get(entry.widgetId);
    if (!widget) return '';

    let content: string;
    try {
      const data = widget.scrape();
      content = widget.render(data, entry.h, entry.w);
    } catch (err) {
      console.warn(`[OPAL] Widget ${entry.widgetId} error:`, err);
      content = `<p class="text-sm text-slate-500">Widget konnte nicht geladen werden.</p>`;
    }

    const delay = idx < 8 ? `opal-delay-${idx + 1}` : '';
    const cardContent = buildWidgetCardContent(widget, content, editMode);

    // GridStack item with gs-* attributes
    return `
        <div class="grid-stack-item opal-anim-in ${delay}" 
             gs-id="${widget.id}" gs-x="${entry.x}" gs-y="${entry.y}" gs-w="${entry.w}" gs-h="${entry.h}"
             gs-min-w="${widget.minW ?? 2}" gs-min-h="${widget.minH ?? 2}">
          <div class="grid-stack-item-content widget-card ${editMode ? 'edit-mode-active' : ''}" data-widget-id="${widget.id}">
            ${cardContent}
          </div>
        </div>`;
  }).join('');

  // Hidden widgets panel (shown in edit mode)
  const hiddenPanel = editMode && hiddenEntries.length > 0 ? `
    <div id="opal-hidden-panel" style="margin-top: 2rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;">
        <h3 class="text-xs font-bold uppercase tracking-widest text-slate-500">Versteckte Widgets</h3>
        <span class="text-[10px] text-slate-600">${hiddenEntries.length}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.75rem;">
        ${hiddenEntries.map(entry => {
    const widget = widgets.get(entry.widgetId);
    if (!widget) return '';
    return `
            <button class="widget-show-btn bento-card" style="padding:1rem;text-align:left;cursor:pointer;" data-widget-id="${entry.widgetId}">
              <div style="display:flex;align-items:center;gap:0.5rem;">
                <span style="font-size:1.25rem;">${widget.icon}</span>
                <div>
                  <p class="text-xs font-bold text-white">${escapeHtml(widget.title)}</p>
                  <p class="text-[10px] text-slate-500">Klick zum Anzeigen</p>
                </div>
              </div>
            </button>`;
  }).join('')}
      </div>
    </div>` : '';

  return `
    <main class="w-full flex-1 p-6 md:p-8 max-w-7xl mx-auto">
      <div id="opal-widget-grid" class="grid-stack ${editMode ? 'edit-mode' : ''}">
        ${widgetItems}
      </div>
      ${hiddenPanel}
      <footer class="mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
        <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">\u00A9 OPAL Redesigned.</p>
      </footer>
    </main>`;
}
