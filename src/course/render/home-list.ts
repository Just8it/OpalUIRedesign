import { t } from '../../i18n/messages/course.ts';
import type { ListBlock, AnnouncementBlock } from '../home/types.ts';
import { esc, formatDate } from './format.ts';
import { homeButton as button, homeFiles, type HomeRenderState } from './home-shared.ts';
export function renderHomeList(block: ListBlock, state: HomeRenderState): string {
    if (!block.entries.length) return `<p class="opal-course-home-location">${block.config.source.type === 'pinned' ? t('homeNoPins') : t('homeNoFiles')}</p>`;
    return homeFiles(block.entries.slice(0, 6), state, 6, block.config.id) + (block.total > 6 ? button('browse', t('homeShowAllCount', { count: block.total }), block.config.id) : '');
}
export function renderHomeAnnouncements(block: AnnouncementBlock, state: HomeRenderState): string {
    return block.items.slice(0, 3).map((a, i) => {
        const key = `ann:${i}`;
        const open = state.expanded.has(key);
        return `<article class="opal-course-home-ann"><div class="opal-course-home-location">${a.date && a.date > state.previousVisit ? t('announcementDateNew', { date: formatDate(a.date) }) : formatDate(a.date)}</div>${button('expand', esc(a.title), key, `aria-expanded="${open}"`)}<p class="${open ? '' : 'is-preview'}">${esc(a.text)}</p></article>`;
    }).join('') + button('announcements', t('allAnnouncements'));
}
