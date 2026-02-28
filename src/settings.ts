/* ━━ Native OPAL Settings Bridge ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { escapeHtml } from './utils';
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

  // Dispatch to MAIN world helper
  document.dispatchEvent(new CustomEvent('opal-safe-click', {
    detail: { tempId: item.id },
  }));

  // Restore original ID after a tick (MAIN world click is synchronous)
  setTimeout(() => {
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

  // Find the gear dropdown items
  const menuItems = portlet.querySelectorAll<HTMLAnchorElement>(
    '.panel-functions .dropdown-menu a'
  );

  // Click "Konfigurieren" (the second menu item, or find by text)
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
      label: label?.textContent?.trim() ?? 'Anzahl',
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
      label: label?.textContent?.trim() ?? 'Auswahl',
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
      label: 'Sichtbare Einträge',
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
    const checkboxes = configPanel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    (values.checkboxes as { inputId: string; checked: boolean }[]).forEach(item => {
      const cb = document.getElementById(item.inputId) as HTMLInputElement | null;
      if (cb) cb.checked = item.checked;
    });
  }

  // Click the native "Speichern" button
  const saveBtn = configPanel.querySelector<HTMLButtonElement>('button[title="Speichern"]');
  if (saveBtn) {
    saveBtn.click();
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
  const cancelBtn = configPanel.querySelector<HTMLButtonElement>('button[title="Abbrechen"]');
  if (cancelBtn) {
    cancelBtn.click();
    return;
  }

  // Fallback: click "Konfigurieren beenden" from the gear dropdown
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

/** Render a styled settings modal for a widget's native config */
export function renderSettingsModal(portletOrder: string, title: string): string {
  const fields = scrapeConfigForm(portletOrder);

  if (fields.length === 0) {
    return `
      <div class="widget-settings-modal" data-portlet="${portletOrder}">
        <div class="p-8 text-center">
          <div class="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/5 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-slate-500"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </div>
          <p class="text-sm font-medium text-slate-400">Keine Einstellungen verfügbar.</p>
          <p class="text-xs text-slate-600 mt-1">Das Widget hat keine konfigurierbaren Optionen.</p>
        </div>
      </div>`;
  }

  const fieldsHtml = fields.map(f => {
    switch (f.type) {
      case 'number':
        return `
          <div class="settings-field">
            <label class="settings-field-label">${f.label}</label>
            <div class="settings-input-wrap">
              <input type="number" class="settings-number-input" value="${f.value}" data-name="${f.name}" />
            </div>
          </div>`;
      case 'select':
        return `
          <div class="settings-field">
            <label class="settings-field-label">${f.label}</label>
            <div class="settings-input-wrap">
              <select class="settings-select-input" data-name="${f.name}">
                ${f.options?.map(o => `<option value="${o.value}" ${o.value === String(f.value) ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
              <svg class="settings-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </div>
          </div>`;
      case 'checkbox-list':
        return `
          <div class="settings-field">
            <label class="settings-field-label">${f.label}</label>
            <div class="settings-checkbox-list">
              ${f.items?.map(item => `
                <label class="settings-checkbox-item">
                  <div class="settings-toggle-wrap">
                    <input type="checkbox" ${item.checked ? 'checked' : ''} data-input-id="${item.inputId}" class="settings-toggle-input" />
                    <div class="settings-toggle-track">
                      <div class="settings-toggle-thumb"></div>
                    </div>
                  </div>
                  <span class="settings-checkbox-label">${item.label}</span>
                </label>
              `).join('')}
            </div>
          </div>`;
      default:
        return '';
    }
  }).join('');

  return `
    <div class="widget-settings-modal" data-portlet="${portletOrder}">
      <div class="settings-modal-header">
        <div class="settings-modal-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6264f4" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </div>
        <div>
          <h3 class="settings-modal-title">${title}</h3>
          <p class="settings-modal-subtitle">Widget Einstellungen</p>
        </div>
        <button class="widget-settings-close settings-close-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="settings-modal-body">
        ${fieldsHtml}
      </div>

      <div class="settings-modal-footer">
        <button class="widget-settings-save settings-save-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Speichern
        </button>
      </div>
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

export async function openCalendarSettings(): Promise<void> {
  // Load current data
  const events = await loadCalendarEvents();
  const settings = await loadCalendarSettings();

  // Group events by source file
  const sourceFiles = new Map<string, number>();
  events.forEach(ev => {
    const src = ev.sourceFile || 'OPAL';
    sourceFiles.set(src, (sourceFiles.get(src) || 0) + 1);
  });

  const fileList = sourceFiles.size > 0
    ? [...sourceFiles.entries()].map(([name, count]) =>
      `<div class="flex items-center justify-between py-2 px-3 bg-white/3 rounded-lg border border-white/5">
        <div class="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-slate-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="text-xs text-white font-medium">${escapeHtml(name)}</span>
        </div>
        <span class="text-[10px] text-slate-500">${count} Termine</span>
      </div>`
    ).join('')
    : '<p class="text-xs text-slate-500 py-2">Keine Kalender importiert.</p>';

  const modal = document.createElement('div');
  modal.id = 'opal-cal-settings-modal';
  modal.className = 'settings-overlay';
  modal.innerHTML = `
    <div class="settings-modal-container w-full max-w-md bg-[#0e1117] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
      <div class="relative p-5 border-b border-white/10 bg-gradient-to-r from-[#6264f4]/5 to-transparent flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-[#6264f4]/15 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6264f4" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-bold text-white">Kalender Einstellungen</h3>
            <p class="text-[10px] text-slate-500">${events.length} Termine gespeichert</p>
          </div>
        </div>
        <button id="cal-settings-close" class="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 text-slate-400 hover:text-white transition-all cursor-pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
        <!-- Import ICS -->
        <div>
          <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-3">ICS/VCS Importieren</h4>
          <label class="flex items-center gap-3 p-3 border border-dashed border-white/15 rounded-xl cursor-pointer hover:border-[#6264f4]/40 hover:bg-[#6264f4]/5 transition-all">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6264f4" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div>
              <p class="text-xs font-bold text-white">Datei auswählen</p>
              <p class="text-[10px] text-slate-500">.ics oder .vcs Datei von z.B. stundenplan.mw.tu-dresden.de</p>
            </div>
            <input type="file" accept=".ics,.vcs,.ical" id="cal-ics-input" class="hidden">
          </label>
          <p id="cal-import-status" class="text-[10px] text-slate-500 mt-2 hidden"></p>
        </div>

        <!-- Imported calendars -->
        <div>
          <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-3">Importierte Kalender</h4>
          <div class="space-y-2" id="cal-file-list">${fileList}</div>
        </div>

        <!-- Favorites toggle -->
        <div>
          <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-3">Favoriten</h4>
          <label class="flex items-center justify-between p-3 bg-white/3 rounded-xl border border-white/5 cursor-pointer">
            <div>
              <p class="text-xs font-medium text-white">Favoriten im Kalender anzeigen</p>
              <p class="text-[10px] text-slate-500">Gebookmarkte Kurse als Termine anzeigen</p>
            </div>
            <input type="checkbox" id="cal-show-favorites" class="accent-[#6264f4]" ${settings.showFavoritesAsEvents ? 'checked' : ''}>
          </label>
        </div>

        <!-- Match Sensitivity Slider -->
        <div>
          <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-3">Kurs-Erkennung</h4>
          <div class="p-3 bg-white/3 rounded-xl border border-white/5">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-medium text-white">Übereinstimmung</p>
              <span id="cal-match-value" class="text-xs font-bold text-[#6264f4]">${Math.round((1 - (settings.matchThreshold ?? 0.4)) * 100)}%</span>
            </div>
            <p class="text-[10px] text-slate-500 mb-3">Wie genau müssen Kalender-Termine mit Kursnamen übereinstimmen?</p>
            <input type="range" id="cal-match-threshold" min="30" max="100" step="5"
              value="${Math.round((1 - (settings.matchThreshold ?? 0.4)) * 100)}"
              class="w-full h-1.5 rounded-full appearance-none bg-white/10 accent-[#6264f4] cursor-pointer">
            <div class="flex justify-between mt-1">
              <span class="text-[9px] text-slate-600">Locker</span>
              <span class="text-[9px] text-slate-600">Streng</span>
            </div>
          </div>
        </div>
      </div>

      <div class="p-5 pt-2 border-t border-white/10 bg-black/20 flex gap-3">
        <button id="cal-clear-all" class="flex-1 py-2.5 bg-white/5 text-slate-400 text-xs font-bold rounded-xl hover:bg-red-500/10 hover:text-red-400 transition-all cursor-pointer">
          Alle löschen
        </button>
        <button id="cal-settings-done" class="flex-1 py-2.5 bg-gradient-to-r from-[#6264f4] to-[#7f81f5] text-white text-xs font-bold rounded-xl shadow-lg shadow-[#6264f4]/20 hover:shadow-[#6264f4]/40 hover:-translate-y-0.5 transition-all cursor-pointer">
          Fertig
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // Close
  const closeModal = () => {
    modal.remove();
    refreshCalendarEvents();
  };

  modal.querySelector('#cal-settings-close')?.addEventListener('click', closeModal);
  modal.querySelector('#cal-settings-done')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // ICS Import
  const fileInput = modal.querySelector('#cal-ics-input') as HTMLInputElement;
  const statusEl = modal.querySelector('#cal-import-status') as HTMLElement;

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    statusEl.classList.remove('hidden');
    statusEl.textContent = `Importiere ${file.name}...`;
    statusEl.className = 'text-[10px] text-[#6264f4] mt-2';

    try {
      const count = await importICSFile(file);
      statusEl.textContent = `✓ ${count} neue Termine aus ${file.name} importiert!`;
      statusEl.className = 'text-[10px] text-emerald-400 mt-2';

      // Refresh file list
      const updatedEvents = await loadCalendarEvents();
      const newSources = new Map<string, number>();
      updatedEvents.forEach(ev => {
        const src = ev.sourceFile || 'OPAL';
        newSources.set(src, (newSources.get(src) || 0) + 1);
      });
      const listEl = modal.querySelector('#cal-file-list');
      if (listEl) {
        listEl.innerHTML = [...newSources.entries()].map(([name, cnt]) =>
          `<div class="flex items-center justify-between py-2 px-3 bg-white/3 rounded-lg border border-white/5">
            <div class="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-slate-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span class="text-xs text-white font-medium">${escapeHtml(name)}</span>
            </div>
            <span class="text-[10px] text-slate-500">${cnt} Termine</span>
          </div>`
        ).join('');
      }
    } catch (err) {
      statusEl.textContent = `✕ Fehler: ${(err as Error).message}`;
      statusEl.className = 'text-[10px] text-red-400 mt-2';
    }
  });

  // Favorites toggle
  const favToggle = modal.querySelector('#cal-show-favorites') as HTMLInputElement;
  favToggle?.addEventListener('change', async () => {
    const current = await loadCalendarSettings();
    await saveCalendarSettings({ ...current, showFavoritesAsEvents: favToggle.checked });
  });

  // Match threshold slider
  const thresholdSlider = modal.querySelector('#cal-match-threshold') as HTMLInputElement;
  const thresholdLabel = modal.querySelector('#cal-match-value') as HTMLElement;
  thresholdSlider?.addEventListener('input', () => {
    const pct = parseInt(thresholdSlider.value);
    thresholdLabel.textContent = `${pct}%`;
  });
  thresholdSlider?.addEventListener('change', async () => {
    const pct = parseInt(thresholdSlider.value);
    // Map 30-100% → 0.7-0.0 Fuse threshold (inverted: higher % = stricter = lower threshold)
    const fuseThreshold = (100 - pct) / 100;
    setMatchThreshold(fuseThreshold);
    const current = await loadCalendarSettings();
    await saveCalendarSettings({ ...current, matchThreshold: fuseThreshold });
  });

  // Clear all
  modal.querySelector('#cal-clear-all')?.addEventListener('click', async () => {
    if (confirm('Alle importierten Termine wirklich löschen?')) {
      await clearCalendarEvents();
      closeModal();
    }
  });
}
