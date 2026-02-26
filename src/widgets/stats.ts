/* ━━ Stats Widget ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';

interface StatsData {
  favCount: number;
  courseCount: number;
}

export const statsWidget: Widget = {
  id: 'stats',
  opalPortletOrder: '', // Synthetic — no native portlet
  title: 'Statistiken',
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  defaultW: 4,
  defaultH: 3,
  hasNativeConfig: false,

  scrape(): StatsData {
    // Count favorites
    const favPortlet = document.querySelector('div[data-portlet-order="Bookmarks"]');
    const favCount = favPortlet?.querySelectorAll('li.list-group-item').length ?? 0;

    // Count enrolled courses
    const coursePortlet = document.querySelector('div[data-portlet-order="RepositoryPortletStudent"]');
    const courseCount = coursePortlet?.querySelectorAll('li.list-group-item').length ?? 0;

    return { favCount, courseCount };
  },

  render(data: unknown): string {
    const stats = data as StatsData;

    return `
      <div class="grid grid-cols-2 gap-3">
        <div class="p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <svg class="text-rose-500 mb-3" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <p class="text-2xl font-black text-white">${stats.courseCount}</p>
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Kurse</p>
        </div>
        <div class="p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <svg class="text-[#6264f4] mb-3" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <p class="text-2xl font-black text-white">${stats.favCount}</p>
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Favoriten</p>
        </div>
      </div>
      <div class="mt-3 p-3 rounded-xl bg-[#6264f4]/5 border border-[#6264f4]/10">
        <div class="flex items-center gap-3">
          <div class="flex-1">
            <h4 class="text-xs font-bold text-white">OPAL Redesigned</h4>
            <p class="text-[10px] text-slate-400">Modulares Dashboard v2</p>
          </div>
          <span class="px-2 py-1 bg-[#6264f4] text-white text-[10px] font-bold rounded-lg uppercase">Aktiv</span>
        </div>
      </div>`;
  },
};
