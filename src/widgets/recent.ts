/* ━━ Recent Courses Widget (Zuletzt geöffnet) ━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';
import { escapeHtml, truncate } from '../utils';

interface RecentItem {
    title: string;
    href: string;
}

/** Recently visited courses from the LastUsedRepositoryPortlet. */
export const recentWidget: Widget = {
    id: 'recent',
    opalPortletOrder: 'LastUsedRepositoryPortlet',
    title: 'Zuletzt geöffnet',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    defaultW: 4,
    defaultH: 3,
    hasNativeConfig: true,

    scrape(): RecentItem[] {
        const portlet = document.querySelector(
            'div[data-portlet-order="LastUsedRepositoryPortlet"] section.panel.portlet'
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
          <svg class="mx-auto mb-3 text-opal-text-muted/40" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p class="text-sm text-opal-text-muted">Noch keine Kurse besucht.</p>
        </div>`;
        }

        const rows = items.slice(0, 8).map((item, i) => `
      <a href="${item.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-opal-surface-2/50 border border-opal-divider hover:bg-opal-surface-2 hover:border-opal-glass-border transition-all no-underline group">
        <div class="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
          <span class="text-amber-400 text-[10px] font-bold">${i + 1}</span>
        </div>
        <span class="text-xs text-opal-text-muted truncate group-hover:text-opal-text transition-colors">${escapeHtml(truncate(item.title, 50))}</span>
        <svg class="ml-auto text-opal-text-muted/40 group-hover:text-opal-text-muted transition-colors flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </a>
    `).join('');

        return `<div class="space-y-1.5">${rows}</div>`;
    },
};
