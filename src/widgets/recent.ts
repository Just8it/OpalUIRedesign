/* ━━ Recent Courses Widget (Zuletzt geöffnet) ━━━━━━━━━━━━━━━ */

import { t } from '../i18n/messages/widgets.ts';
import type { Widget } from '../types.ts';
import { escapeHtml, safeHref } from '../utils';

interface RecentItem {
    title: string;
    href: string;
}

/** Recently visited courses from the LastUsedRepositoryPortlet. */
export const recentWidget: Widget<RecentItem[]> = {
    id: 'recent',
    opalPortletOrder: 'LastUsedRepositoryPortlet',
    get title() { return t('recentTitle'); },
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

    render(data: RecentItem[]): string {
        const items = data as RecentItem[];
        if (items.length === 0) {
            return `
        <div class="opal-empty">
          <p class="opal-empty-title">${t('recentEmpty')}</p>
          <p class="opal-empty-hint">${t('recentHint')}</p>
        </div>`;
        }

        const rows = items.slice(0, 8).map(item => `
        <a href="${safeHref(item.href)}" class="opal-row" title="${escapeHtml(item.title)}">
          <span class="opal-row-title">${escapeHtml(item.title)}</span>
        </a>`).join('');

        return `<div class="flex flex-col">${rows}</div>`;
    },
};
