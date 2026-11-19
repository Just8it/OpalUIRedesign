/* Owns list pane for the course view. */
import { t } from '../../i18n/messages/course.ts';
import type { CourseAnnouncement, CourseSnapshot } from '../types';

import { type Located, type OpenedMap } from '../find/index';
import { buildList, type BrowseLayout, type BrowsePrefs, type ListModel, type Sort } from '../browse/index';
import { buildHome, defaultHome } from '../home/index';
import type { HomeConfig } from '../home/types';

import { doneEntries } from '../render/home-shared';

import { esc } from '../render/format';

import { gridTemplate, listColumns, renderColumnHead, type Columns } from '../render/list-head';
import { groupSignature, renderGroup, sortedList } from '../render/list';
import { announcementKey, renderAnnouncementsPane } from '../render/announcements';

import { renderPageDoc } from '../render/page-doc';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    setBox: (key: string, box: HTMLElement, sig: string, html: () => string) => boolean;
    thead: HTMLElement;
    paneHead: HTMLElement;
    docBox: HTMLElement;
    pane: HTMLElement;
    table: HTMLElement;
    model: ListModel | null;
    emptyBox: HTMLElement;
    annBox: HTMLElement;
    globalSearch: HTMLElement;
    paneTitle: HTMLElement;
    paneSummary: HTMLElement;
    annExpanded: Set<string>;
    prefs: BrowsePrefs;
    located: Located[];
    opened: OpenedMap;
    query: string;
    layout: BrowseLayout;
    introOpen: { has: (id: string) => boolean };
    reconcileGroups: (desired: { key: string; sig: string; html: () => string }[]) => void;
    boxSigs: Record<string, string>;
    homeConfig: HomeConfig | null;
    homeProgress: CourseProgress;
    applyActive: (reveal?: boolean) => void;
    ORDER: Sort;
}

export function createListPane(context: Context) {
    const setColumns = (cols: Columns, sort: Sort, _headInTable = true) => {
        context.setBox('thead', context.thead, JSON.stringify([cols, sort]), () => renderColumnHead(cols, sort));
        // The title row sits above the page text and the column header, never inside the Name column.
        if (context.paneHead.nextElementSibling !== context.docBox)
            context.pane.insertBefore(context.paneHead, context.docBox);
        context.table.style.setProperty('--course-cols', gridTemplate(cols));
        context.table.style.setProperty('--course-cols-narrow', gridTemplate(cols, true));
    };

    const renderAnnouncements = (anns: CourseAnnouncement[], previousVisit: number) => {
        context.model = null;
        context.pane.insertBefore(context.paneHead, context.table);
        context.table.hidden = true;
        context.emptyBox.hidden = true;
        context.docBox.hidden = true;
        context.annBox.hidden = false;
        context.globalSearch.hidden = true;
        const title = t('announcements');
        if (context.paneTitle.textContent !== title) context.paneTitle.textContent = title;
        const summary = t('announcementCount', { count: anns.length });
        if (context.paneSummary.textContent !== summary) context.paneSummary.textContent = summary;
        context.setBox(
            'anns',
            context.annBox,
            JSON.stringify([anns.map(announcementKey), anns.map((a) => a.text), previousVisit]),
            () => renderAnnouncementsPane(anns, previousVisit, context.annExpanded),
        );
    };

    const renderList = (view: CourseSnapshot, sel: string) => {
        context.annBox.hidden = true;
        const sort = context.prefs.sort ?? context.ORDER;
        const m = sortedList(
            buildList({
                snapshot: view,
                located: context.located,
                opened: context.opened,
                prefs: context.prefs,
                selected: sel,
                query: context.query,
                sort,
            }),
            sort,
        );
        context.model = m;
        if (context.paneTitle.textContent !== m.title) context.paneTitle.textContent = m.title;
        if (context.paneSummary.textContent !== m.summary) context.paneSummary.textContent = m.summary;
        context.globalSearch.hidden = !context.query.trim();
        const cols = listColumns(m, context.layout.columns);
        // A lecturer's page (Ablaufplan, Kursinfo) shows its text first, then its files.
        const page =
            !context.query.trim() && sel.startsWith('sec:')
                ? view.sections.find((s) => `sec:${s.nodeId}` === sel && s.html)
                : undefined;
        context.docBox.hidden = !page;
        const pageFiles = !!page && m.groups.some((g) => g.id === page.nodeId && g.count > 0);
        const docOptions = {
            courseTitle: view.title,
            clamp: pageFiles,
            open: !!page && context.introOpen.has(page.nodeId),
        };
        if (
            context.setBox(
                'doc',
                context.docBox,
                page ? `${page.nodeId}|${page.htmlTruncated ? 1 : 0}|${JSON.stringify(docOptions)}|${page.html}` : '',
                () => (page ? renderPageDoc(page, docOptions) : ''),
            )
        ) {
            // A short page fits in its clamp: no fade, no toggle.
            const article = context.docBox.querySelector<HTMLElement>('.opal-course-doc.is-clamped');
            if (article && article.scrollHeight <= article.clientHeight + 8) {
                article.classList.remove('is-clamped');
                context.docBox.querySelector('[data-doc-toggle]')?.remove();
            }
        }
        setColumns(cols, sort, !page);
        if (page && !m.groups.some((g) => g.count > 0 || g.state === 'pending')) {
            context.paneSummary.textContent = '';
            context.table.hidden = true;
            context.emptyBox.hidden = true;
            context.reconcileGroups([]);
            return;
        }
        if (m.empty && !m.groups.some((g) => g.state === 'pending')) {
            context.pane.insertBefore(context.paneHead, context.table);
            context.table.hidden = true;
            context.emptyBox.hidden = false;
            const searching = !!context.query.trim();
            context.setBox(
                'empty',
                context.emptyBox,
                `${m.empty}|${searching}`,
                () =>
                    `<p class="opal-course-empty">${esc(m.empty)}</p>${searching ? `<button type="button" class="opal-btn" id="opal-course-search-all">${t('searchAllOpal')}</button>` : ''}`,
            );
            context.reconcileGroups([]);
            return;
        }
        context.table.hidden = false;
        context.emptyBox.hidden = true;
        context.boxSigs.empty = '';
        const collapsed = new Set(context.prefs.collapsed);
        const config = context.homeConfig ?? defaultHome(view, context.located);
        const done = doneEntries(
            buildHome({
                snapshot: view,
                located: context.located,
                config: { ...config, blocks: config.blocks.map((b) => ({ ...b, hidden: false })) },
                progress: context.homeProgress,
                opened: context.opened,
                editing: true,
            }),
        );
        // The page being read shows its text above; its group needs no second copy.
        context.reconcileGroups(
            m.groups
                .map((g) => (page && g.id === page.nodeId ? { ...g, intro: undefined } : g))
                .map((g, i) => {
                    const ctx = {
                        pinned: new Set(context.homeProgress.pinned),
                        done,
                        key: `${m.grouped ? 'g' : 'f'}:${g.id}`,
                        cols,
                        grouped: m.grouped,
                        collapsed: m.grouped && collapsed.has(g.id),
                        introOpen: context.introOpen.has(g.id),
                    };
                    return {
                        key: ctx.key,
                        sig: groupSignature(g, ctx) + JSON.stringify(context.homeProgress),
                        html: () => renderGroup(g, ctx, i),
                    };
                }),
        );
        context.applyActive();
    };
    return { setColumns, renderAnnouncements, renderList };
}

import type { CourseProgress } from '../home/types';
