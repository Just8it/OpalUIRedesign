/* ━━ Courses Widget (Enrolled) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../i18n/messages/widgets.ts';
import type { Widget, CourseItem } from '../types.ts';
import { escapeHtml, safeHref } from '../utils';
import { parseCourseListItems } from './course-list-scraper';

/** All enrolled courses from the RepositoryPortletStudent. */
export const coursesWidget: Widget<CourseItem[]> = {
    id: 'courses',
    opalPortletOrder: 'RepositoryPortletStudent',
    get title() { return t('coursesTitle'); },
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    defaultW: 8,
    defaultH: 4,
    hasNativeConfig: true,

    scrape(): CourseItem[] {
        const portlet = document.querySelector(
            'div[data-portlet-order="RepositoryPortletStudent"] section.panel.portlet.repositoryportletstudent'
        );
        if (!portlet) return [];
        return parseCourseListItems(portlet.innerHTML, 'enrolled', false);
    },

    render(data: CourseItem[]): string {
        const items = data as CourseItem[];
        if (items.length === 0) {
            return `
        <div class="opal-empty">
          <p class="opal-empty-title">${t('coursesEmpty')}</p>
          <p class="opal-empty-hint">${t('coursesHint', { catalogLink: `<a class="opal-link" href="/opal/auth/repository/catalog">${t('coursesOpenCatalog')}</a>` })}</p>
        </div>`;
        }

        const rows = items.slice(0, 12).map(item => `
        <a href="${safeHref(item.href)}" class="opal-row" title="${escapeHtml(item.title)}">
          <span class="opal-row-title">${escapeHtml(item.title)}</span>
        </a>`).join('');

        return `<div class="flex flex-col">${rows}</div>`;
    },
};
