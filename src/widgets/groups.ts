/* ━━ Groups Widget (Meine Gruppen) ━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';
import { escapeHtml, truncate } from '../utils';

interface GroupItem {
    title: string;
    href: string;
}

export const groupsWidget: Widget = {
    id: 'groups',
    opalPortletOrder: 'Groups',
    title: 'Meine Gruppen',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    defaultW: 4,
    defaultH: 3,
    hasNativeConfig: true,

    scrape(): GroupItem[] {
        const portlet = document.querySelector(
            'div[data-portlet-order="Groups"] section.panel.portlet'
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
            .filter((x): x is GroupItem => x !== null);
    },

    render(data: unknown): string {
        const items = data as GroupItem[];
        if (items.length === 0) {
            return `
        <div class="text-center py-4">
          <svg class="mx-auto mb-3 text-opal-text-muted/40" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <p class="text-sm text-opal-text-muted">Keine Gruppen vorhanden.</p>
        </div>`;
        }

        const rows = items.slice(0, 8).map(item => `
      <a href="${item.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/5 hover:border-white/10 transition-all no-underline group">
        <div class="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <svg class="text-emerald-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        </div>
        <span class="text-xs text-opal-text-muted truncate group-hover:text-opal-text transition-colors">${escapeHtml(truncate(item.title, 50))}</span>
      </a>
    `).join('');

        return `<div class="space-y-1.5">${rows}</div>`;
    },
};
