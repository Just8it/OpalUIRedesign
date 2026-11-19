/* ━━ Stats Widget ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { formatNumber } from '../i18n/core.ts';
import { t } from '../i18n/messages/widgets.ts';
import type { Widget } from '../types.ts';

interface StatsData {
  favCount: number;
  courseCount: number;
}

/** Dashboard statistics: enrolled course count and favourite count. */
export const statsWidget: Widget<StatsData> = {
  id: 'stats',
  opalPortletOrder: ['Bookmarks', 'RepositoryPortletStudent'],
  requires: 'all',
  get title() { return t('statsTitle'); },
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

  render(data: StatsData): string {
    const stats = data as StatsData;

    return `
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="opal-figure m-0">${formatNumber(stats.courseCount)}</p>
          <p class="opal-caption m-0">${t('statsCourses')}</p>
        </div>
        <div>
          <p class="opal-figure m-0">${formatNumber(stats.favCount)}</p>
          <p class="opal-caption m-0">${t('favoritesTitle')}</p>
        </div>
      </div>`;
  },
};
