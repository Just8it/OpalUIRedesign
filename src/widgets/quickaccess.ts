/* ━━ Quick Access Widget (Erste Schritte) ━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';

export const quickaccessWidget: Widget = {
  id: 'quickaccess',
  opalPortletOrder: 'FirstStepsPortlet',
  title: 'Schnellzugriff',
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  defaultW: 4,
  defaultH: 3,
  hasNativeConfig: false,

  scrape() {
    // Quick access items are static UI — no scraping needed
    return null;
  },

  render(): string {
    const actions = [
      { label: 'Suche', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', color: 'blue' },
      { label: 'Gruppen', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', color: 'emerald' },
      { label: 'ePortfolio', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', color: 'violet' },
    ];

    return `
      <div class="grid grid-cols-3 gap-2">
        ${actions.map(a => `
          <button class="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/5 hover:border-white/10 transition-all cursor-pointer group">
            <div class="w-9 h-9 rounded-lg bg-${a.color}-500/10 border border-${a.color}-500/20 flex items-center justify-center text-${a.color}-400 group-hover:scale-110 transition-transform">
              ${a.icon}
            </div>
            <span class="text-[10px] font-medium text-slate-400 group-hover:text-white transition-colors">${a.label}</span>
          </button>
        `).join('')}
      </div>`;
  },
};
