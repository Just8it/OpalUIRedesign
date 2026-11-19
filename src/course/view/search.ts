/* Owns search for the course view. */
import type { CourseSnapshot } from '../types';
import { openFile, prefersDownload } from '../../core/file-opening';
import { t } from '../../i18n/messages/search.ts';

import { recordOpened, type Located, type OpenedMap } from '../find/index';
import { buildNav, type BrowsePrefs, type ListModel, type NavBlock } from '../browse/index';

import { openedMark } from '../render/list-row';

import { renderSidebar } from '../render/sidebar';

import { enter, swap } from '../../motion';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    table: HTMLElement;
    query: string;
    activeUrl: string;
    opened: OpenedMap;
    snapshot: CourseSnapshot | null;
    navBlocks: NavBlock[];
    located: Located[];
    prefs: BrowsePrefs;
    editing: boolean;
    setBox: (key: string, box: HTMLElement, sig: string, html: () => string) => boolean;
    nav: HTMLElement;
    shown: string;
    syncRoving: () => void;
    savedScroll: number | null;
    scrollAtFocus: number | null;
    root: HTMLElement;
    pane: HTMLElement;
    render: () => void;
    announce: (text: string, delay?: number) => void;
    model: ListModel | null;
    findInput: HTMLInputElement;
    selected: string;
    courseId: string;
}

export function createSearch(context: Context) {
    const hitRows = () => Array.from(context.table.querySelectorAll<HTMLElement>('.opal-course-row[data-url]'));

    const applyActive = (reveal = false) => {
        const rows = context.query.trim() && !context.table.hidden ? hitRows() : [];
        if (rows.length && !rows.some((r) => r.dataset.url === context.activeUrl))
            context.activeUrl = rows[0].dataset.url ?? '';
        if (!rows.length) context.activeUrl = '';
        for (const r of context.table.querySelectorAll<HTMLElement>('.opal-course-row.is-active'))
            r.classList.remove('is-active');
        const row = rows.find((r) => r.dataset.url === context.activeUrl);
        row?.classList.add('is-active');
        if (reveal && row) row.scrollIntoView({ block: 'nearest' });
    };

    const markOpened = (url: string) => {
        if (!url) return;
        context.opened = { ...context.opened, [url]: Date.now() };
        for (const row of hitRows().filter((r) => r.dataset.url === url)) {
            if (row.classList.contains('is-done')) continue;
            row.classList.add('is-opened');
            const link = row.querySelector('.opal-course-name');
            link?.querySelector('.opal-course-opened')?.remove();
            (
                link?.querySelector('.opal-course-name-t') ?? link?.querySelector('.opal-course-name-h')
            )?.insertAdjacentHTML('afterend', openedMark(context.opened[url]));
        }
        for (const mark of context.table.querySelectorAll<HTMLElement>('.is-opened .opal-course-opened'))
            if (mark.closest('[data-url]')?.getAttribute('data-url') === url) void enter(mark);
        if (context.snapshot) {
            context.navBlocks = buildNav(
                context.snapshot,
                context.located,
                context.opened,
                context.prefs,
                context.editing,
            );
            context.setBox('nav', context.nav, JSON.stringify([context.navBlocks, context.editing]), () =>
                renderSidebar(context.navBlocks, context.shown, context.editing),
            );
            context.syncRoving();
        }
        void recordOpened(context.courseId, url)
            .then((next) => {
                context.opened = { ...context.opened, ...next };
            })
            .catch(() => {});
    };

    const openActive = () => {
        const row = hitRows().find((r) => r.dataset.url === context.activeUrl);
        const link = row?.querySelector<HTMLAnchorElement>('a.opal-course-name');
        if (!link || link.getAttribute('href') === '#') return;
        if (prefersDownload()) void openFile(link.href, { folder: false }).then(handled => { if (!handled) window.open(link.href, '_blank', 'noopener'); });
        else window.open(link.href, '_blank', 'noopener');
        markOpened(link.dataset.url ?? '');
    };

    const setQuery = (value: string) => {
        const before = context.query.trim();
        context.query = value;
        const now = context.query.trim();
        if (!before && now) {
            context.savedScroll = context.scrollAtFocus ?? context.root.scrollTop;
            context.root.scrollTop = 0;
        }
        if (before !== now) context.activeUrl = '';
        if (!!before !== !!now) void swap(context.pane, context.render);
        else context.render();
        if (now)
            context.announce(context.model?.empty ? t('courseSearchEmpty', { query: now }) : (context.model?.summary ?? ''), 400);
    };

    const resetFind = () => {
        context.findInput.value = '';
        context.selected = 'home';
        setQuery('');
    };
    return { hitRows, applyActive, markOpened, openActive, setQuery, resetFind };
}
