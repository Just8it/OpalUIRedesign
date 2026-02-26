/* ━━ Recent Courses Widget (Zuletzt geöffnet) ━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';
import { escapeHtml, truncate } from '../utils';

interface RecentItem {
    title: string;
    href: string;
}

export const recentWidget: Widget = {
    id: 'recent',
    opalPortletOrder: 'RecentCoursesPortlet',
    title: 'Zuletzt geöffnet',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    defaultW: 4,
    defaultH: 3,
    hasNativeConfig: true,

    scrape(): RecentItem[] {
        const portlet = document.querySelector(
            'div[data-portlet-order="RecentCoursesPortlet"] section.panel.portlet'
        );
        if (!portlet) return [];
        return [...portlet.querySelectorAll('li.list-group-item')]
            .map(li => {
                const link = li.querySelector('a.list-group-item-link') || li.querySelector('a');
                if (!link) return null;
                return {
                    title: link.getAttribute('title') || link.textContent?.trim() || '',
                    href: link.getAttribute('href') || '#',
                };
            })
            .filter((x): x is RecentItem => x !== null);
    },

    render(data: unknown): string {
        const items = data as RecentItem[];
        if (items.length === 0) {
            return `
        <div class="text-center py-4">
          <svg class="mx-auto mb-3 text-slate-600" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p class="text-sm text-slate-500">Noch keine Kurse besucht.</p>
        </div>`;
        }

        const rows = items.slice(0, 8).map((item, i) => `
      <a href="${item.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/5 hover:border-white/10 transition-all no-underline group">
        <div class="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
          <span class="text-amber-400 text-[10px] font-bold">${i + 1}</span>
        </div>
        <span class="text-xs text-slate-300 truncate group-hover:text-white transition-colors">${escapeHtml(truncate(item.title, 50))}</span>
        <svg class="ml-auto text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </a>
    `).join('');

        return `<div class="space-y-1.5">${rows}</div>`;
    },
};
