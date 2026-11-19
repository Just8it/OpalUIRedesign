import { formatDate, locale } from '../i18n/core.ts';
import { t } from '../i18n/messages/widgets.ts';
import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import type { Widget } from '../types.ts';
import { escapeAttr, escapeHtml, safeHref } from '../utils';
import { scrapeNews } from './news';
import { scrapeAktuelles } from './aktuelles';
import { mergeNews, splitNewsTitle, type Announcement, type NewsSource } from './news-model';
// "Kursnews" is OPAL's InfoMessages portlet, "Aktuelles" its Information portlet. The former
// "Ankündigungen" feed was both of them again, so every item carried two labels that said the same.
const labels = { all: 'newsAll', news: 'newsCourses', info: 'newsInfo', announcements: 'newsAnnouncements' } as const satisfies Record<'all' | NewsSource, Parameters<typeof t>[0]>;
let filter: keyof typeof labels = 'all';
export async function initNews(refresh: () => void): Promise<void> {
    const saved = await store.get(keys.newsFilter);
    if (saved in labels) filter = saved as keyof typeof labels;
    document.addEventListener('click', event => {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-news-filter]');
        const value = button?.dataset.newsFilter;
        if (!value || !(value in labels)) return;
        filter = value as keyof typeof labels;
        void store.set(keys.newsFilter, filter);
        refresh();
    });
}
export const newsIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>';
export const neuigkeitenWidget: Widget<Announcement[]> = {
    id: 'neuigkeiten', get title() { return t('newsTitle'); }, opalPortletOrder: ['InfoMessages', 'Information'], requires: 'any',
    icon: newsIcon, defaultW: 4, defaultH: 3, hasNativeConfig: false,
    scrape: () => mergeNews([...scrapeNews(), ...scrapeAktuelles()]),
    render(items) {
        const available = new Set(items.flatMap(i => i.sources ?? [i.tag]));
        const active = available.size < 2 ? 'all' : filter === 'all' || available.has(filter) ? filter : 'all';
        const buttons = Object.entries(labels).filter(([key]) => key === 'all' || available.has(key as NewsSource)).map(([key, label]) => `<button type="button" data-news-filter="${key}" aria-pressed="${active === key}">${t(label)}</button>`).join('');
        const rows = items.filter(i => active === 'all' || (i.sources ?? [i.tag]).includes(active)).map(i => {
            const { subject, author } = splitNewsTitle(i.title);
            // The source only tells something in "Alle" with more than one feed.
            const source = active === 'all' && available.size > 1 ? (i.sources ?? [i.tag]).map(s => t(labels[s])).join(' · ') : '';
            const date = locale() === 'en' && i.dateMs !== undefined && Number.isFinite(i.dateMs)
                ? formatDate(i.dateMs, { day: 'numeric', month: 'short', year: 'numeric' }) : i.dateRaw;
            const meta = [author, date, source].filter((t): t is string => !!t).map(escapeHtml).join(' · ');
            const body = `<span class="news-row-body"><span class="news-row-title">${escapeHtml(subject)}</span>${meta ? `<span class="news-row-meta">${meta}</span>` : ''}</span>`;
            const tip = subject !== i.title ? ` title="${escapeAttr(i.title)}"` : '';
            return i.link ? `<a class="opal-row news-row" href="${safeHref(i.link)}"${tip}>${body}</a>` : `<div class="opal-row news-row"${tip}>${body}</div>`;
        }).join('');
        return `${available.size >= 2 ? `<div class="news-filters" aria-label="${t('newsFilter')}">${buttons}</div>` : ''}${rows || `<div class="opal-empty"><p class="opal-empty-title">${t('newsEmpty')}</p><p class="opal-empty-hint">${t('newsHint')}</p></div>`}`;
    },
};
