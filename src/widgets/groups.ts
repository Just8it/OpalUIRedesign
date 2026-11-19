/* ━━ Groups Widget (Meine Gruppen) ━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../i18n/messages/widgets.ts';
import type { Widget } from '../types.ts';
import { escapeHtml, safeHref } from '../utils';

interface GroupItem {
    title: string;
    href: string;
}

/** Study groups the user belongs to, scraped from the Groups portlet. */
export const groupsWidget: Widget<GroupItem[]> = {
    id: 'groups',
    opalPortletOrder: 'Groups',
    get title() { return t('groupsTitle'); },
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

    render(data: GroupItem[]): string {
        const items = data as GroupItem[];
        if (items.length === 0) {
            return `
        <div class="opal-empty">
          <p class="opal-empty-title">${t('groupsEmpty')}</p>
          <p class="opal-empty-hint">${t('groupsHint')}</p>
        </div>`;
        }

        const rows = items.slice(0, 8).map(item => `
        <a href="${safeHref(item.href)}" class="opal-row" title="${escapeHtml(item.title)}">
          <span class="opal-row-title">${escapeHtml(item.title)}</span>
        </a>`).join('');

        return `<div class="flex flex-col">${rows}</div>`;
    },
};
