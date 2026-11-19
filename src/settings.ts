import { openSurface, closeSurface } from './motion';
import { localeTag } from './i18n/core.ts';
import { t } from './i18n/messages/shell.ts';
import { clickNativeComponent, NATIVE_COMPONENTS } from './native-controls';
/* ━━ Native OPAL Settings Bridge ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { escapeAttr, escapeHtml } from './utils';
import { setMatchThreshold } from './course-matcher';
/**
 * Integrates with OPAL's native portlet configuration system.
 * 
 * Flow:
 * 1. Find native portlet by data-portlet-order
 * 2. Click gear → Konfigurieren to open the native config form
 * 3. Scrape the form fields (inputs, selects, checkboxes)
 * 4. Present them in our styled modal
 * 5. On save → set values → click native Speichern button
 */

export interface ConfigField {
  type: 'number' | 'select' | 'checkbox-list';
  label: string;
  name: string;
  value: string | number | boolean[];
  options?: { value: string; label: string }[];
  items?: { label: string; checked: boolean; inputId: string }[];
  element: HTMLElement;
}

/** 
 * Safely clicks an element that might have a javascript: href.
 * Content scripts in Chrome can't execute javascript: URLs due to CSP.
 * We dispatch a CustomEvent to our MAIN world helper script (main-world.ts)
 * which runs in the page's JS context and can perform the click freely.
 */
export function safeClick(item: HTMLElement): void {
  // Give it a temporary ID so the MAIN world script can find it
  const originalId = item.id;
  const tempId = 'opal-click-' + Math.random().toString(36).substring(2, 9);
  if (!originalId) {
    item.id = tempId;
  }

  // Dispatch to MAIN world helper. Use a DOM attribute instead of
  // CustomEvent.detail because Firefox isolates event detail objects between
  // content-script and MAIN worlds.
  document.documentElement.setAttribute('data-opal-click-target', item.id);
  document.dispatchEvent(new CustomEvent('opal-safe-click'));

  // Restore original ID after a tick (MAIN world click is synchronous)
  setTimeout(() => {
    document.documentElement.removeAttribute('data-opal-click-target');
    if (!originalId) {
      item.removeAttribute('id');
    }
  }, 0);
}

/** Trigger OPAL's native "Konfigurieren" for a portlet */
export function openNativeConfig(portletOrder: string): boolean {
  const portlet = document.querySelector<HTMLElement>(
    `div[data-portlet-order="${portletOrder}"]`
  );
  if (!portlet) return false;

  if (portlet.querySelector('.panel-config')) return true;
  if (clickNativeComponent(NATIVE_COMPONENTS.configurePortlet, portlet)) return true;
  // Find the gear dropdown items
  const menuItems = portlet.querySelectorAll<HTMLAnchorElement>(
    '.panel-functions .dropdown-menu a'
  );

  // All configurable fixture portlets have hide then configure; never use a lone item.
  if (menuItems.length === 2) { safeClick(menuItems[1]); return true; }
  // German text is the last fallback.
  for (const item of menuItems) {
    const text = item.textContent?.trim() ?? '';
    if (text === 'Konfigurieren' || text === 'Konfigurieren beenden') {
      safeClick(item);
      return true;
    }
  }
  return false;
}

/** Scrape config form fields from a portlet's .panel-config */
export function scrapeConfigForm(portletOrder: string): ConfigField[] {
  const portlet = document.querySelector<HTMLElement>(
    `div[data-portlet-order="${portletOrder}"]`
  );
  if (!portlet) return [];

  const configPanel = portlet.querySelector<HTMLElement>('.panel-config');
  if (!configPanel) return [];

  const fields: ConfigField[] = [];

  // Number inputs (e.g. "Anzahl der Elemente")
  configPanel.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(input => {
    const label = configPanel.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);
    fields.push({
      type: 'number',
      label: label?.textContent?.trim() ?? t('nativeSettingsAmount'),
      name: input.name,
      value: parseInt(input.value, 10) || 0,
      element: input,
    });
  });

  // Select dropdowns (e.g. "Sortierung")
  configPanel.querySelectorAll<HTMLSelectElement>('select').forEach(select => {
    const label = configPanel.querySelector<HTMLLabelElement>(`label[for="${select.id}"]`);
    const options = [...select.options].map(opt => ({
      value: opt.value,
      label: opt.textContent?.trim() ?? '',
    }));
    fields.push({
      type: 'select',
      label: label?.textContent?.trim() ?? t('nativeSettingsSelect'),
      name: select.name,
      value: select.value,
      options,
      element: select,
    });
  });

  // Checkbox lists (e.g. "Sichtbare Einträge auswählen")
  const checkboxItems: ConfigField['items'] = [];
  configPanel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
    const labelEl = document.getElementById(cb.getAttribute('aria-labelledby') ?? '');
    checkboxItems.push({
      label: labelEl?.textContent?.trim() ?? cb.value,
      checked: cb.checked,
      inputId: cb.id,
    });
  });
  if (checkboxItems.length > 0) {
    fields.push({
      type: 'checkbox-list',
      label: t('nativeSettingsVisibleEntries'),
      name: 'checkboxes',
      value: checkboxItems.map(i => i.checked),
      items: checkboxItems,
      element: configPanel,
    });
  }

  return fields;
}

/** Apply values back to native OPAL form and submit */
export function applyAndSaveConfig(portletOrder: string, values: Record<string, unknown>): void {
  const portlet = document.querySelector<HTMLElement>(
    `div[data-portlet-order="${portletOrder}"]`
  );
  if (!portlet) return;

  const configPanel = portlet.querySelector<HTMLElement>('.panel-config');
  if (!configPanel) return;

  // Set number inputs
  for (const [name, value] of Object.entries(values)) {
    if (name === 'checkboxes') continue;
    const input = configPanel.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (input) {
      input.value = String(value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      continue;
    }
    const select = configPanel.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
    if (select) {
      select.value = String(value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // Set checkboxes
  if (values.checkboxes && Array.isArray(values.checkboxes)) {
    (values.checkboxes as { inputId: string; checked: boolean }[]).forEach(item => {
      const cb = document.getElementById(item.inputId) as HTMLInputElement | null;
      if (cb) cb.checked = item.checked;
    });
  }

  // Click the native "Speichern" button
  const saveBtn = configPanel.querySelector<HTMLButtonElement>('button[type="submit"][name$=":field:btn"]')
    ?? configPanel.querySelector<HTMLButtonElement>('button[title="Speichern"]');
  if (saveBtn) {
    safeClick(saveBtn);
  }
}

/** Cancel native OPAL config without saving */
export function cancelNativeConfig(portletOrder: string): void {
  const portlet = document.querySelector<HTMLElement>(
    `div[data-portlet-order="${portletOrder}"]`
  );
  if (!portlet) return;

  const configPanel = portlet.querySelector<HTMLElement>('.panel-config');
  if (!configPanel) return;

  // Try finding the Abbrechen button directly
  // Fixture cancel has no name; it follows the named submit button.
  const submit = configPanel.querySelector('button[type="submit"][name$=":field:btn"]');
  const sibling = submit?.nextElementSibling;
  // Live OPAL wraps each button in its own field container, so also accept the
  // first plain button that comes after the submit button in document order.
  const buttons = Array.from(configPanel.querySelectorAll<HTMLButtonElement>('button'));
  const afterSubmit = submit
    ? buttons.slice(buttons.indexOf(submit as HTMLButtonElement) + 1).find(b => b.type === 'button') ?? null
    : null;
  const cancelBtn = (sibling?.matches('button[type="button"]') ? sibling as HTMLButtonElement : null)
    ?? afterSubmit
    ?? configPanel.querySelector<HTMLButtonElement>('button[title="Abbrechen"]');
  if (cancelBtn) {
    safeClick(cancelBtn);
    return;
  }

  if (clickNativeComponent(NATIVE_COMPONENTS.configurePortlet, portlet)) return;
  const configItems = portlet.querySelectorAll<HTMLElement>('.panel-functions .dropdown-menu a');
  if (configItems.length === 2) { safeClick(configItems[1]); return; }
  // Fallback: click configure from the gear dropdown
  const menuItems = portlet.querySelectorAll<HTMLAnchorElement>(
    '.panel-functions .dropdown-menu a'
  );
  for (const item of menuItems) {
    const text = item.textContent?.trim() ?? '';
    if (text === 'Konfigurieren beenden') {
      safeClick(item);
      return;
    }
  }
}

/* ── Dialog keyboard handling ─────────────────────────────── */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour shared by the extension's own dialogs: focus moves into
 * the dialog, Tab and Shift+Tab stay inside it and Escape calls `onEscape`.
 * Call the returned function when the dialog closes; it removes the handler
 * and gives focus back to the control that opened the dialog (or to
 * `fallback()` when that control has been re-rendered in the meantime).
 */
export function bindDialogKeyboard(
  overlay: HTMLElement,
  onEscape: () => void,
  initialFocus?: HTMLElement | null,
): (fallback?: () => HTMLElement | null) => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusables = (): HTMLElement[] =>
    Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(el => el.getClientRects().length > 0);

  // A dialog opened on top of this one (a confirmation) owns the keyboard until it closes.
  const covered = (): boolean => {
    const stack = Array.from(document.querySelectorAll('.settings-overlay'));
    const mine = overlay.closest('.settings-overlay') ?? overlay;
    const at = stack.indexOf(mine);
    return at >= 0 && at < stack.length - 1;
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!overlay.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
    if (covered()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = !!active && overlay.contains(active);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);

  const start = initialFocus
    ?? overlay.querySelector<HTMLElement>('.settings-modal-body :is(input, select, textarea, button)')
    ?? focusables()[0];
  start?.focus();

  return (fallback) => {
    document.removeEventListener('keydown', onKey, true);
    const target = opener && opener.isConnected ? opener : fallback?.() ?? null;
    target?.focus();
  };
}

export const CLOSE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ── Shared dialog pieces ─────────────────────────────────────
 * Every widget dialog has the same frame: the card's title and a close X on
 * top (.widget-settings-close), Abbrechen and Speichern at the bottom
 * (.widget-settings-close, .widget-settings-save). Actions that act at once
 * (import, delete) report in a status line next to them. */

/** Title row with the close X. `subtitle` is already escaped. */
export function dialogHeader(titleId: string, title: string, subtitle = ''): string {
  return `<div class="settings-modal-header">
        <div class="min-w-0">
          <h2 id="${titleId}" class="settings-modal-title">${escapeHtml(title)}</h2>${subtitle ? `
          <p class="settings-modal-subtitle">${subtitle}</p>` : ''}
        </div>
        <button type="button" class="widget-settings-close settings-close-btn" aria-label="${t('close')}">${CLOSE_ICON}</button>
      </div>`;
}

/** Footer with Abbrechen and Speichern; `start` (already HTML) sits on the left, e.g. a danger action. */
export function dialogFooter(start = ''): string {
  return `<div class="settings-modal-footer">${start}
        <button type="button" class="opal-btn widget-settings-close">${t('cancel')}</button>
        <button type="button" class="opal-btn opal-btn-primary widget-settings-save">${t('save')}</button>
      </div>`;
}

/** One row of a switch list: label (and description) left, the shared switch right. 44px minimum. */
export function switchRow(o: { id: string; label: string; description?: string; checked: boolean; inputAttrs?: string }): string {
  const descId = `${o.id}-desc`;
  return `<div class="settings-switch-row">
        <label class="settings-switch-text" for="${o.id}">
          <span class="opal-set-label">${escapeHtml(o.label)}</span>${o.description ? `
          <span class="opal-set-desc" id="${descId}">${escapeHtml(o.description)}</span>` : ''}
        </label>
        <label class="opal-switch opal-switch-sm"><input type="checkbox" role="switch" id="${o.id}"${o.checked ? ' checked' : ''}${o.description ? ` aria-describedby="${descId}"` : ''} ${o.inputAttrs ?? ''}><span class="opal-switch-track" aria-hidden="true"></span><span class="opal-switch-thumb" aria-hidden="true"></span></label>
      </div>`;
}

/**
 * Ask before something that cannot be undone. Resolves true on the confirm
 * button, false on Abbrechen, Escape or a click on the scrim. Focus starts on
 * Abbrechen and returns to the control that opened the dialog.
 */
export function confirmDialog(o: { title: string; message?: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    document.getElementById('opal-confirm-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'opal-confirm-modal';
    overlay.className = 'settings-overlay';
    overlay.lang = localeTag();
    overlay.innerHTML = `
      <div class="widget-settings-modal" role="alertdialog" aria-modal="true" aria-labelledby="opal-confirm-title"${o.message ? ' aria-describedby="opal-confirm-text"' : ''}>
        <div class="settings-modal-header">
          <h2 id="opal-confirm-title" class="settings-modal-title">${escapeHtml(o.title)}</h2>
        </div>${o.message ? `
        <div class="settings-modal-body"><p id="opal-confirm-text" class="settings-confirm-text">${escapeHtml(o.message)}</p></div>` : ''}
        <div class="settings-modal-footer">
          <button type="button" class="opal-btn" data-confirm="no">${t('cancel')}</button>
          <button type="button" class="opal-btn ${o.danger ? 'opal-btn-danger' : 'opal-btn-primary'}" data-confirm="yes">${escapeHtml(o.confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    openSurface(overlay);
    let release: ReturnType<typeof bindDialogKeyboard> | null = null;
    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      void closeSurface(overlay, () => release?.());
      resolve(answer);
    };
    overlay.addEventListener('click', e => {
      const target = e.target as Element;
      if (target === overlay) finish(false);
      else if (target.closest('[data-confirm="yes"]')) finish(true);
      else if (target.closest('[data-confirm="no"]')) finish(false);
    });
    release = bindDialogKeyboard(overlay, () => finish(false), overlay.querySelector<HTMLElement>('[data-confirm="no"]'));
  });
}

/** Render a styled settings modal for a widget's native config */
export function renderSettingsModal(portletOrder: string, title: string, loading = false): string {
  const fields = scrapeConfigForm(portletOrder);
  const header = dialogHeader('opal-native-settings-title', title);
  const dialogAttrs = `class="widget-settings-modal" data-portlet="${escapeAttr(portletOrder)}" role="dialog" aria-modal="true" aria-labelledby="opal-native-settings-title"`;

  if (loading) return `<div ${dialogAttrs}>${header}<div class="settings-modal-body"><p class="opal-caption" role="status">${t('nativeSettingsLoading')}</p></div></div>`;

  if (fields.length === 0) {
    return `
    <div ${dialogAttrs}>
      ${header}
      <div class="settings-modal-body">
        <div class="opal-empty">
          <p class="opal-empty-title">${t('nativeSettingsFailed')}</p>
          <p class="opal-empty-hint">${t('nativeSettingsMissingForm')}</p>
        </div>
      </div>
      <div class="settings-modal-footer">
        <button type="button" class="opal-btn widget-settings-close">${t('close')}</button>
      </div>
    </div>`;
  }

  const fieldsHtml = fields.map((f, i) => {
    const fieldId = `opal-native-field-${i}`;
    switch (f.type) {
      case 'number':
        return `
          <div class="settings-field">
            <label class="settings-field-label" for="${fieldId}">${escapeHtml(f.label)}</label>
            <div class="settings-input-wrap">
              <input type="number" id="${fieldId}" class="settings-number-input" value="${escapeAttr(String(f.value))}" data-name="${escapeAttr(f.name)}" />
            </div>
          </div>`;
      case 'select':
        return `
          <div class="settings-field">
            <label class="settings-field-label" for="${fieldId}">${escapeHtml(f.label)}</label>
            <div class="settings-input-wrap">
              <select id="${fieldId}" class="settings-select-input" data-name="${escapeAttr(f.name)}">
                ${f.options?.map(o => `<option value="${escapeAttr(o.value)}"${o.value === String(f.value) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('') ?? ''}
              </select>
              <svg class="settings-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            </div>
          </div>`;
      case 'checkbox-list':
        return `
          <fieldset class="settings-field">
            <legend class="settings-field-label">${escapeHtml(f.label)}</legend>
            <div class="settings-switch-list">
              ${f.items?.map((item, j) => switchRow({ id: `${fieldId}-${j}`, label: item.label, checked: item.checked, inputAttrs: `data-input-id="${escapeAttr(item.inputId)}"` })).join('') ?? ''}
            </div>
          </fieldset>`;
      default:
        return '';
    }
  }).join('');

  return `
    <div ${dialogAttrs}>
      ${header}
      <div class="settings-modal-body">
        ${fieldsHtml}
      </div>
      ${dialogFooter()}
    </div>`;
}

/* ── Calendar Settings Modal ──────────────────────────────── */

import {
  importICSFile,
  loadCalendarEvents,
  clearCalendarEvents,
  loadCalendarSettings,
  saveCalendarSettings,
} from './calendar-store';
import { refreshCalendarEvents } from './widgets/calendar';

const FILE_ICON = '<svg class="opal-row-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

/** Imported calendars as hairline rows: file name and event count. */
function renderCalendarSourceList(sources: Map<string, number>): string {
  if (sources.size === 0) {
    return `<p class="opal-caption">${t('calendarNoImports')}</p>`;
  }
  return [...sources.entries()].map(([name, count]) => `
        <div class="opal-row cal-source-row">
          ${FILE_ICON}
          <span class="opal-row-title">${name === 'Manual Entry' ? t('calendarManualEntries') : escapeHtml(name)}</span>
          <span class="opal-row-meta">${t('calendarEventCount', { count })}</span>
        </div>`).join('');
}

export async function openCalendarSettings(): Promise<void> {
  if (document.getElementById('opal-cal-settings-modal')) return;
  // Load current data
  const events = await loadCalendarEvents();
  const settings = await loadCalendarSettings();

  // Group events by source file
  const sourceFiles = new Map<string, number>();
  events.forEach(ev => {
    const src = ev.sourceFile || 'OPAL';
    sourceFiles.set(src, (sourceFiles.get(src) || 0) + 1);
  });

  const matchPct = Math.round((1 - (settings.matchThreshold ?? 0.4)) * 100);
  const savedFavorites = !!settings.showFavoritesAsEvents;

  if (document.getElementById('opal-cal-settings-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'opal-cal-settings-modal';
  modal.className = 'settings-overlay';
  modal.lang = localeTag();
  modal.innerHTML = `
    <div class="widget-settings-modal" role="dialog" aria-modal="true" aria-labelledby="cal-settings-title">
      ${dialogHeader('cal-settings-title', t('calendarTitle'), `<span id="cal-settings-count">${t('calendarSavedCount', { count: events.length })}</span>`)}

      <div class="settings-modal-body">
        <div class="settings-field">
          <p class="settings-field-label">${t('calendarImport')}</p>
          <label class="opal-btn cal-import-btn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            ${t('calendarChooseFile')}
            <input type="file" accept=".ics,.vcs,.ical" id="cal-ics-input" class="sr-only" aria-describedby="cal-import-hint">
          </label>
          <p id="cal-import-hint" class="opal-caption mt-1.5">${t('calendarImportHint')}</p>
          <p id="cal-import-status" class="opal-caption mt-1.5 hidden" role="status" aria-live="polite"></p>
        </div>

        <div class="settings-field">
          <p class="settings-field-label">${t('calendarImported')}</p>
          <div id="cal-file-list" class="cal-source-list">${renderCalendarSourceList(sourceFiles)}</div>
          <p id="cal-clear-status" class="opal-caption mt-1.5 hidden" role="status" aria-live="polite"></p>
        </div>

        <div class="settings-field">
          <div class="settings-switch-list">${switchRow({ id: 'cal-show-favorites', label: t('calendarShowFavorites'), description: t('calendarShowFavoritesHint'), checked: savedFavorites })}</div>
        </div>

        <div class="settings-field">
          <div class="cal-field-head">
            <label class="settings-field-label" for="cal-match-threshold">${t('calendarCourseMatching')}</label>
            <span id="cal-match-value" class="text-[13px] text-opal-text tabular-nums">${t('calendarMatchPercent', { percent: matchPct })}</span>
          </div>
          <p class="opal-caption mb-2" id="cal-match-hint">${t('calendarMatchHint')}</p>
          <input type="range" id="cal-match-threshold" min="30" max="100" step="5" value="${matchPct}"
            aria-describedby="cal-match-hint" class="w-full accent-opal-accent">
          <div class="flex justify-between mt-1 text-[11px] text-opal-text-muted" aria-hidden="true">
            <span>${t('calendarMatchLoose')}</span>
            <span>${t('calendarMatchStrict')}</span>
          </div>
        </div>
      </div>

      ${dialogFooter(`<button type="button" id="cal-clear-all" class="opal-btn opal-btn-danger mr-auto">${t('calendarClear')}</button>`)}
    </div>`;

  document.body.appendChild(modal);
  openSurface(modal);

  // Close: the calendar re-reads its events either way (an import or a delete may have happened).
  let releaseFocus: ReturnType<typeof bindDialogKeyboard> | null = null;
  const closeModal = () => {
    void closeSurface(modal, () => releaseFocus?.());
    refreshCalendarEvents();
  };

  modal.querySelectorAll('.widget-settings-close').forEach(btn => btn.addEventListener('click', closeModal));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  releaseFocus = bindDialogKeyboard(modal, closeModal);

  const fileList = modal.querySelector('#cal-file-list') as HTMLElement;
  const countEl = modal.querySelector('#cal-settings-count') as HTMLElement;
  const showSources = async () => {
    const current = await loadCalendarEvents();
    const sources = new Map<string, number>();
    current.forEach(ev => {
      const src = ev.sourceFile || 'OPAL';
      sources.set(src, (sources.get(src) || 0) + 1);
    });
    fileList.innerHTML = renderCalendarSourceList(sources);
    countEl.textContent = t('calendarSavedCount', { count: current.length });
  };

  // ICS import acts at once and reports next to the button.
  const fileInput = modal.querySelector('#cal-ics-input') as HTMLInputElement;
  const statusEl = modal.querySelector('#cal-import-status') as HTMLElement;

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    statusEl.textContent = t('calendarImporting', { file: file.name });
    statusEl.className = 'opal-caption mt-1.5';

    try {
      const count = await importICSFile(file);
      statusEl.textContent = t('calendarImportSuccess', { count, file: file.name });
      statusEl.className = 'text-xs text-opal-success mt-1.5';
      await showSources();
    } catch (err) {
      statusEl.textContent = t('calendarImportFailed', { error: (err as Error).message });
      statusEl.className = 'text-xs text-opal-danger mt-1.5';
    }
  });

  // Delete asks first, then acts at once.
  const clearStatus = modal.querySelector('#cal-clear-status') as HTMLElement;
  modal.querySelector('#cal-clear-all')?.addEventListener('click', async () => {
    const sure = await confirmDialog({
      title: t('calendarClearTitle'),
      message: t('calendarClearMessage'),
      confirmLabel: t('calendarConfirmClear'),
      danger: true,
    });
    if (!sure) return;
    await clearCalendarEvents();
    await showSources();
    clearStatus.textContent = t('calendarCleared');
    clearStatus.className = 'opal-caption mt-1.5';
  });

  // Match threshold slider
  const thresholdSlider = modal.querySelector('#cal-match-threshold') as HTMLInputElement;
  const thresholdLabel = modal.querySelector('#cal-match-value') as HTMLElement;
  thresholdSlider?.addEventListener('input', () => {
    thresholdLabel.textContent = t('calendarMatchPercent', { percent: parseInt(thresholdSlider.value) });
  });

  // The switch and the slider are settings: they are kept on Speichern.
  const favToggle = modal.querySelector('#cal-show-favorites') as HTMLInputElement;
  modal.querySelector('.widget-settings-save')?.addEventListener('click', async () => {
    const pct = parseInt(thresholdSlider.value);
    // Map 30-100% → 0.7-0.0 Fuse threshold (inverted: higher % = stricter = lower threshold)
    const fuseThreshold = (100 - pct) / 100;
    if (favToggle.checked !== savedFavorites || pct !== matchPct) {
      if (pct !== matchPct) setMatchThreshold(fuseThreshold);
      const current = await loadCalendarSettings();
      await saveCalendarSettings({
        ...current,
        showFavoritesAsEvents: favToggle.checked,
        ...(pct !== matchPct ? { matchThreshold: fuseThreshold } : {}),
      });
    }
    closeModal();
  });
}
