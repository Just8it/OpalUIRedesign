/* ━━ Favorites Widget (Bookmarks) ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../i18n/messages/widgets.ts';
import type { Widget, CourseItem } from '../types.ts';
import { escapeHtml, safeHref } from '../utils';
import { COURSE_GRADIENTS, matchEventToCourse } from '../course-matcher';
import { getLoadedEvents } from './calendar';
import { expandRecurring, getEventsForDay } from '../calendar-store.ts';
import { parseCourseListItems } from './course-list-scraper';

/** Detect if user is currently viewing a specific course */
function getCurrentCourseHref(): string | null {
  // OPAL course URLs contain /url/RepositoryEntry/ or /auth/RepositoryEntry/
  const path = location.pathname;
  const match = path.match(/\/(?:url|auth)\/RepositoryEntry\/(\d+)/);
  if (match) return match[0]; // e.g. /url/RepositoryEntry/12345
  return null;
}

/* ── Density ───────────────────────────────────────────────────
 * The favourites tighten up as the widget gets smaller or the list
 * longer, so every course stays visible without scrolling when it
 * can. The levels only swap a class on .fav-grid (styles in
 * input.css), so changing level never needs a re-render. */

const DENSITIES = ['comfortable', 'compact', 'list'] as const;
type Density = typeof DENSITIES[number];

/** Approximate tile geometry per level, mirroring input.css. */
const DENSITY_GEOMETRY: Record<Density, { minCol: number; rowH: number; gap: number }> = {
  comfortable: { minCol: 184, rowH: 76, gap: 8 },
  compact:     { minCol: 200, rowH: 48, gap: 6 },
  list:        { minCol: 220, rowH: 28, gap: 0 },
};

/** First-paint guess from the grid size; fitFavorites() corrects it after layout. */
function estimateDensity(count: number, widgetH?: number, widgetW?: number): Density {
  if (!widgetH || !widgetW) return 'comfortable';
  const viewport = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const gridPx = Math.min(viewport, 1280) - 64; // max-w-7xl, p-8
  // Card margins 32px and header 44px vertically; content padding 16px.
  const width = (widgetW / 12) * gridPx - 24 - 32;
  const height = widgetH * 60 - 32 - 44 - 16;
  for (const level of DENSITIES) {
    const g = DENSITY_GEOMETRY[level];
    const cols = Math.max(1, Math.floor((width + g.gap) / (g.minCol + g.gap)));
    const rows = Math.ceil(count / cols);
    if (rows * g.rowH + (rows - 1) * g.gap <= height) return level;
  }
  return 'list';
}

/**
 * Pick the roomiest density at which each favourites grid fits its
 * scroll container without overflowing. Falls back to 'list' (and
 * scrolling) when nothing fits. Cheap, idempotent, and a no-op when
 * the widget is absent or not laid out.
 */
export function fitFavorites(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.fav-grid').forEach(grid => {
    const container = grid.closest<HTMLElement>('.widget-content');
    if (!container || container.clientHeight === 0) return;
    for (const level of DENSITIES) {
      for (const other of DENSITIES) grid.classList.toggle(`fav-density-${other}`, other === level);
      if (container.scrollHeight <= container.clientHeight + 1) return;
    }
  });
}

/**
 * OPAL titles usually repeat the module code, either up front
 * ("MW-MB-11: Grundlagen …") or in a trailing bracket ("… (MW-MB-11, MA-WW-…)").
 * The tile shows the code on its own line, so the title drops the repeat.
 * The full title stays in the tooltip.
 */
export function displayCourseTitle(title: string, moduleCode: string | null): string {
  if (!moduleCode) return title;
  const code = moduleCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleaned = title
    // trailing bracket that mentions the code, closed or cut off
    .replace(new RegExp(`\\s*\\([^()]*${code}[^()]*\\)?\\s*$`), '')
    // leading code with its separator
    .replace(new RegExp(`^\\s*${code}\\s*[:–-]?\\s*`), '')
    .trim();
  return cleaned || title;
}

/** Bookmarked courses and resources from the OPAL Favorites portlet. */
export const favoritesWidget: Widget<CourseItem[]> = {
  id: 'favorites',
  opalPortletOrder: 'Bookmarks',
  get title() { return t('favoritesTitle'); },
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  defaultW: 8,
  defaultH: 4,
  hasNativeConfig: true,

  scrape(): CourseItem[] {
    const portlet = document.querySelector(
      'div[data-portlet-order="Bookmarks"] section.panel.portlet.bookmarks'
    );
    if (!portlet) return [];
    return parseCourseListItems(portlet.innerHTML, 'course', true);
  },

  render(data: CourseItem[], widgetH?: number, widgetW?: number): string {
    const items = data as CourseItem[];
    if (items.length === 0) {
      return `
        <div class="opal-empty">
          <p class="opal-empty-title">${t('favoritesEmpty')}</p>
          <p class="opal-empty-hint">${t('favoritesHint')}</p>
        </div>`;
    }

    const currentHref = getCurrentCourseHref();

    // Hoist courses that have events today to the top
    const today = new Date();
    const loadedEvents = getLoadedEvents();

    // Expand recurring events just for today to see what's active
    const todayExpanded = expandRecurring(
      loadedEvents,
      new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0),
      new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)
    );
    const todayEvents = getEventsForDay(todayExpanded, today);

    // Identify which courses are active today
    const activeCourseTitles = new Set<string>();
    for (const ev of todayEvents) {
      const match = matchEventToCourse(ev.title);
      if (match) {
        activeCourseTitles.add(match.course.title);
      }
    }

    // Original order decides the colour, so it matches the calendar
    const originalIndexMap = new Map<string, number>();
    items.forEach((item, i) => originalIndexMap.set(item.title, i));

    // Sort items: 1) Active today, 2) Original order
    items.sort((a, b) => {
      const aActive = activeCourseTitles.has(a.title);
      const bActive = activeCourseTitles.has(b.title);
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return originalIndexMap.get(a.title)! - originalIndexMap.get(b.title)!;
    });

    const cards = items.map((item) => {
      const origi = originalIndexMap.get(item.title) || 0;
      const [color] = COURSE_GRADIENTS[origi % COURSE_GRADIENTS.length];
      const displayTitle = displayCourseTitle(item.title, item.moduleCode);
      const isActive = currentHref && item.href.includes(currentHref);
      const isHasEventToday = activeCourseTitles.has(item.title);
      const state = isActive
        ? `<span class="fav-active-indicator">${t('favoritesActive')}</span>`
        : isHasEventToday ? `<span class="fav-event-indicator">${t('sharedToday')}</span>` : '';
      const code = item.moduleCode ? `<span class="fav-badge">${escapeHtml(item.moduleCode)}</span>` : '';
      const meta = code || state ? `<span class="fav-card-meta">${code}${state}</span>` : '';

      return `
        <a href="${safeHref(item.href)}"
           class="fav-card${isActive ? ' fav-card-active' : ''}"
           title="${escapeHtml(item.title)}">
          <span class="opal-swatch" style="background:${color}" aria-hidden="true"></span>
          <span class="fav-card-text">
            <span class="fav-card-title">${escapeHtml(displayTitle)}</span>
            ${meta}
          </span>
        </a>`;
    }).join('');

    const density = estimateDensity(items.length, widgetH, widgetW);
    return `<div class="fav-grid fav-density-${density}">${cards}</div>`;
  },
};
