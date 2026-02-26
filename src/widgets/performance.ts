/* ━━ Performance Widget (Leistungsnachweis) ━━━━━━━━━━━━━━━━━ */

import type { Widget, EfficiencyData } from '../types';
import { escapeHtml } from '../utils';

export const performanceWidget: Widget = {
  id: 'performance',
  opalPortletOrder: 'EfficiencyStatements',
  title: 'Leistungsnachweis',
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  defaultW: 4,
  defaultH: 3,
  hasNativeConfig: true,

  scrape(): EfficiencyData {
    const portlet = document.querySelector(
      'div[data-portlet-order="EfficiencyStatements"] section.panel.portlet.efficiencystatements'
    );
    if (!portlet) return { hasData: false, text: '' };
    const content = portlet.querySelector('.panel-content');
    const text = content?.textContent?.trim() || '';
    const hasData = !text.includes('Keine Inhalte');
    return { hasData, text };
  },

  render(data: unknown): string {
    const perf = data as EfficiencyData;

    if (!perf.hasData) {
      return `
        <div class="text-center py-4">
          <svg class="mx-auto mb-3 text-slate-600" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <p class="text-sm text-slate-500">Keine Leistungsnachweise.</p>
        </div>`;
    }

    return `
      <div class="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
        <p class="text-xs text-slate-300">${escapeHtml(perf.text)}</p>
      </div>`;
  },
};
