/* ━━ Favorites Widget (Bookmarks) ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget, CourseItem } from '../types';
import { escapeHtml, truncate } from '../utils';

/** Detect if user is currently viewing a specific course */
function getCurrentCourseHref(): string | null {
  // OPAL course URLs contain /url/RepositoryEntry/ or /auth/RepositoryEntry/
  const path = location.pathname;
  const match = path.match(/\/(?:url|auth)\/RepositoryEntry\/(\d+)/);
  if (match) return match[0]; // e.g. /url/RepositoryEntry/12345
  return null;
}

const GRADIENTS = [
  ['#4f46e5', '#7c3aed'], // indigo → violet
  ['#059669', '#0d9488'], // emerald → teal
  ['#e11d48', '#ea580c'], // rose → orange
  ['#2563eb', '#0891b2'], // blue → cyan
  ['#c026d3', '#db2777'], // fuchsia → pink
  ['#d97706', '#ea580c'], // amber → orange
  ['#7c3aed', '#6366f1'], // violet → indigo
  ['#0891b2', '#059669'], // cyan → emerald
];

export const favoritesWidget: Widget = {
  id: 'favorites',
  opalPortletOrder: 'Bookmarks',
  title: 'Favoriten',
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  defaultW: 8,
  defaultH: 4,
  hasNativeConfig: true,

  scrape(): CourseItem[] {
    const portlet = document.querySelector(
      'div[data-portlet-order="Bookmarks"] section.panel.portlet.bookmarks'
    );
    if (!portlet) return [];
    return [...portlet.querySelectorAll('li.list-group-item')]
      .map(li => {
        const link = li.querySelector('a.list-group-item-link');
        if (!link) return null;
        const fullTitle = link.getAttribute('title') || link.textContent?.trim() || '';
        const href = link.getAttribute('href') || '#';
        const moduleMatch = fullTitle.match(/\b([A-Z]{2,}-[A-Z0-9-]+)\b/);
        return {
          title: fullTitle,
          href,
          type: 'course',
          moduleCode: moduleMatch ? moduleMatch[1] : null,
        } as CourseItem;
      })
      .filter((x): x is CourseItem => x !== null);
  },

  render(data: unknown, widgetH?: number): string {
    const items = data as CourseItem[];
    if (items.length === 0) {
      return `
        <div class="fav-empty">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="fav-empty-icon">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          <p>Keine Favoriten gesetzt.</p>
          <span>Kurse über das Stern-Symbol bookmarken</span>
        </div>`;
    }

    const currentHref = getCurrentCourseHref();
    const count = items.length;

    const cards = items.map((item, i) => {
      const [from, to] = GRADIENTS[i % GRADIENTS.length];
      const displayTitle = truncate(item.title, 60);
      const isActive = currentHref && item.href.includes(currentHref);

      return `
        <a href="${item.href}" 
           class="fav-card ${isActive ? 'fav-card-active' : ''}" 
           style="--fav-from:${from};--fav-to:${to}"
           title="${escapeHtml(item.title)}">
          <div class="fav-card-inner">
            <span class="fav-badge">${item.moduleCode || 'KURS'}</span>
            <h4 class="fav-card-title">${escapeHtml(displayTitle)}</h4>
          </div>
          <span class="fav-card-arrow">→</span>
          ${isActive ? '<div class="fav-active-indicator">Aktuell</div>' : ''}
        </a>`;
    }).join('');

    return `
      <div class="fav-grid" style="--fav-count:${count}">
        ${cards}
      </div>`;
  },
};
