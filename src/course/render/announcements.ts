/* ━━ Course view: announcements ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Two places, nothing else: the "Mitteilungen" selection shows them in
 * the list pane (date column, title, author, text clamped to two lines,
 * a click expands in place, "Alle Mitteilungen in OPAL" at the end);
 * and a one-line banner above the list pane when one is newer than the
 * last visit (date · title · "Lesen" · close).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../../i18n/messages/course.ts';
import type { CourseAnnouncement } from '../types.ts';
import { ICON, esc, formatDate, href } from './format.ts';

/** Stable across updates, so the expanded state survives a re-render. */
export function announcementKey(a: CourseAnnouncement): string {
    return `${a.date ?? ''}|${a.title}`;
}

export function newestFirst(list: CourseAnnouncement[]): CourseAnnouncement[] {
    return [...list].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

/** The newest announcement since the previous visit, unless dismissed; none on a first visit. */
export function bannerAnnouncement(list: CourseAnnouncement[], previousVisit: number, dismissed: string): CourseAnnouncement | null {
    if (!previousVisit) return null;
    const fresh = newestFirst(list).find(a => (a.date ?? 0) > previousVisit);
    return fresh && announcementKey(fresh) !== dismissed ? fresh : null;
}

export function renderBanner(a: CourseAnnouncement | null): string {
    if (!a) return '';
    const date = formatDate(a.date);
    return `<div class="opal-course-banner" role="region" aria-label="${t('announcementNew')}">
      <span class="opal-course-banner-ico">${ICON.megaphone}</span>
      <span class="opal-course-banner-text">${date ? `<span class="opal-course-banner-date">${esc(date)}</span><span aria-hidden="true">·</span>` : ''}<span class="opal-course-banner-title">${esc(a.title)}</span></span>
      <button type="button" class="opal-course-tool" data-banner="read">${t('announcementRead')}</button>
      <button type="button" class="opal-course-icon-btn" data-banner="close" aria-label="${t('closeHint')}" title="${t('close')}">${ICON.close}</button>
    </div>`;
}

export function renderAnnouncementsPane(list: CourseAnnouncement[], previousVisit: number, expanded: ReadonlySet<string>): string {
    const sorted = newestFirst(list);
    if (sorted.length === 0) return `<p class="opal-course-empty">${t('announcementsEmpty')}</p>`;
    const rows = sorted.map((a, i) => {
        const key = announcementKey(a);
        const open = expanded.has(key);
        const fresh = !!previousVisit && (a.date ?? 0) > previousVisit;
        return `<li class="opal-course-ann${open ? ' is-open' : ''}" data-ann-item="${esc(key)}">
          <button type="button" class="opal-course-ann-btn" data-ann="${esc(key)}" data-fk="ann:${esc(key)}" aria-expanded="${open}" aria-controls="opal-course-ann-x${i}">
            <span class="opal-course-ann-date">${esc(formatDate(a.date))}</span>
            <span class="opal-course-ann-head"><span class="opal-course-ann-title">${esc(a.title)}</span>${fresh ? `<span class="opal-course-new">${t('new')}</span>` : ''}${a.author ? `<span class="opal-course-ann-author">${esc(a.author)}</span>` : ''}</span>
          </button>
          <p class="opal-course-ann-text" id="opal-course-ann-x${i}">${esc(a.text)}</p>
        </li>`;
    }).join('');
    return `<ul class="opal-course-anns">${rows}</ul>
      <p class="opal-course-ann-more"><a class="opal-link" href="${href(sorted[0].url)}">${t('allAnnouncementsOpal')}</a></p>`;
}
