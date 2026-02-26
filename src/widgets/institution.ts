/* ━━ Institution Widget ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';
import { escapeHtml } from '../utils';

interface InstitutionData {
  name: string;
  text: string;
  available: boolean;
}

export const institutionWidget: Widget = {
  id: 'institution',
  opalPortletOrder: 'InstitutionPortlet',
  title: 'Meine Institution',
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  defaultW: 4,
  defaultH: 3,
  hasNativeConfig: false,

  scrape(): InstitutionData {
    const portlet = document.querySelector(
      'div[data-portlet-order="InstitutionPortlet"] section.panel.portlet'
    );
    if (!portlet) return { name: '', text: '', available: false };
    const heading = portlet.querySelector('.panel-heading')?.textContent?.trim() || 'Meine Institution';
    const content = portlet.querySelector('.panel-content')?.textContent?.trim() || '';
    return { name: heading, text: content, available: true };
  },

  render(data: unknown): string {
    const inst = data as InstitutionData;
    if (!inst.available) {
      return `
        <div class="text-center py-4">
          <svg class="mx-auto mb-3 text-slate-600" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <p class="text-sm text-slate-500">Portlet nicht verfügbar.</p>
          <p class="text-xs text-slate-600 mt-1">Zum OPAL Startseiten-Menü, "Portlets hinzufügen".</p>
        </div>`;
    }

    return `
      <div class="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
        <p class="text-xs text-slate-300">${escapeHtml(inst.text)}</p>
      </div>`;
  },
};
