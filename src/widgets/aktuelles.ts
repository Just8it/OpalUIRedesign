/* ━━ Aktuelles Widget (SysinfoMessages) ━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';
import { escapeHtml } from '../utils';

interface AktuellesData {
    available: boolean;
    text: string;
}

export const aktuellesWidget: Widget = {
    id: 'aktuelles',
    opalPortletOrder: 'SysinfoMessages',
    title: 'Aktuelles',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    defaultW: 4,
    defaultH: 3,
    hasNativeConfig: false,

    scrape(): AktuellesData {
        const portlet = document.querySelector(
            'div[data-portlet-order="SysinfoMessages"] section.panel.portlet'
        );
        if (!portlet) return { available: false, text: '' };
        const content = portlet.querySelector('.panel-content')?.textContent?.trim() || '';
        return { available: true, text: content };
    },

    render(data: unknown): string {
        const aktuelles = data as AktuellesData;

        if (!aktuelles.available) {
            return `
        <div class="text-center py-4">
          <svg class="mx-auto mb-3 text-slate-600" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          <p class="text-sm text-slate-500">Portlet nicht verfügbar.</p>
          <p class="text-xs text-slate-600 mt-1">Zum OPAL Startseiten-Menü, "Portlets hinzufügen".</p>
        </div>`;
        }

        if (!aktuelles.text) {
            return `<p class="text-sm text-slate-500">Keine aktuellen Meldungen.</p>`;
        }

        return `
      <div class="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
        <p class="text-xs text-slate-300">${escapeHtml(aktuelles.text)}</p>
      </div>`;
    },
};
