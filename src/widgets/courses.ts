/* ━━ Courses Widget (Enrolled) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget, CourseItem } from '../types';
import { escapeHtml, truncate } from '../utils';

/** All enrolled courses from the RepositoryPortletStudent. */
export const coursesWidget: Widget = {
    id: 'courses',
    opalPortletOrder: 'RepositoryPortletStudent',
    title: 'Meine Kurse',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    defaultW: 8,
    defaultH: 4,
    hasNativeConfig: true,

    scrape(): CourseItem[] {
        const portlet = document.querySelector(
            'div[data-portlet-order="RepositoryPortletStudent"] section.panel.portlet.repositoryportletstudent'
        );
        if (!portlet) return [];
        return [...portlet.querySelectorAll('li.list-group-item')]
            .map(li => {
                const link = li.querySelector('a.list-group-item-action');
                if (!link) return null;
                return {
                    title: link.getAttribute('title') || link.textContent?.trim() || '',
                    href: link.getAttribute('href') || '#',
                    type: 'enrolled' as const,
                    moduleCode: null,
                };
            })
            .filter((x): x is CourseItem => x !== null);
    },

    render(data: unknown): string {
        const items = data as CourseItem[];
        if (items.length === 0) {
            return `<p class="text-sm text-opal-text-muted">Keine eingeschriebenen Kurse.</p>`;
        }

        const rows = items.slice(0, 12).map(item => {
            const displayTitle = truncate(item.title, 65);
            return `
        <a href="${item.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-opal-surface-2/50 border border-opal-divider hover:bg-opal-surface-2 hover:border-opal-glass-border transition-all no-underline group">
          <div class="w-8 h-8 rounded-lg bg-opal-accent/10 border border-opal-accent/20 flex items-center justify-center flex-shrink-0">
            <svg class="text-opal-accent" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          </div>
          <span class="text-xs text-opal-text-muted truncate group-hover:text-opal-text transition-colors">${escapeHtml(displayTitle)}</span>
          <svg class="ml-auto text-opal-text-muted/40 group-hover:text-opal-text-muted transition-colors flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </a>`;
        }).join('');

        return `<div class="space-y-1.5">${rows}</div>`;
    },
};
