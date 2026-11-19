/* Owns drag for the course view. */

import { sectionTitle } from '../tree.ts';
import { homeBlockTitle } from '../home/config.ts';
import { t } from '../../i18n/messages/course.ts';
import type { CourseSnapshot } from '../types';

import { moveSection, placeSections, type BrowsePrefs, type NavBlock } from '../browse/index';
import { placeBlock } from '../home/index';
import type { HomeConfig } from '../home/types';

import { sectionIdOf } from '../render/sidebar';

import { reorder } from '../../motion';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    navItems: () => HTMLElement[];
    navBlocks: NavBlock[];
    snapshot: CourseSnapshot | null;
    prefs: BrowsePrefs;
    announce: (text: string, delay?: number) => void;
    persistPrefs: () => void;
    render: () => void;
    nav: HTMLElement;
    homeConfig: HomeConfig | null;
    homeBox: HTMLElement;
    persistHome: () => void;
    byFocusKey: (scope: ParentNode, key: string) => HTMLElement | null;
}

export function createDrag(context: Context) {
    const contentSectionIds = () =>
        (context.navBlocks.find((b) => b.key === 'content')?.items ?? [])
            .filter((i) => i.kind === 'section')
            .map((i) => sectionIdOf(i.id));

    const editSection = (action: string, id: string) => {
        if (!id) return;
        const ids = contentSectionIds();
        const section = context.snapshot?.sections.find((s) => s.nodeId === id);
        const title = section ? sectionTitle(section) : t('section');
        if (action === 'hide') {
            const hidden = context.prefs.hidden.includes(id)
                ? context.prefs.hidden.filter((h) => h !== id)
                : [...context.prefs.hidden, id];
            context.prefs = { ...context.prefs, hidden };
            context.announce(t(hidden.includes(id) ? 'sectionHidden' : 'sectionShown', { title }));
        } else {
            context.prefs = moveSection(context.prefs, ids, id, action === 'up' ? -1 : 1);
        }
        const positions = new Map(
            context
                .navItems()
                .map((item) => [item.dataset.nav, (item.parentElement as HTMLElement).getBoundingClientRect().top]),
        );
        context.persistPrefs();
        context.render();
        if (action !== 'hide')
            for (const item of context.navItems()) {
                const before = positions.get(item.dataset.nav);
                const row = item.parentElement as HTMLElement;
                if (before !== undefined && before !== row.getBoundingClientRect().top)
                    void reorder(row, before - row.getBoundingClientRect().top);
            }
        if (action !== 'hide') {
            const order = contentSectionIds();
            context.announce(t('movedPositionTotal', { title, position: order.indexOf(id) + 1, total: order.length }));
        }
    };

    const settle = (container: HTMLElement, attr: string, tops: Map<string, number>) => {
        for (const el of container.querySelectorAll<HTMLElement>(`[${attr}]`)) {
            const before = tops.get(el.getAttribute(attr) ?? '');
            const now = el.getBoundingClientRect().top;
            if (before !== undefined && Math.abs(before - now) > 0.5) void reorder(el, before - now);
        }
    };

    const keyOf = (el: HTMLElement) =>
        el.dataset.section ?? el.dataset.groupHead ?? el.querySelector<HTMLElement>('[data-nav]')?.dataset.nav ?? '';

    const sectionUnits = (row: HTMLElement): HTMLElement[][] => {
        const lis = Array.from(row.parentElement?.children ?? []) as HTMLElement[];
        const i = lis.indexOf(row);
        if (row.classList.contains('is-nested')) {
            let a = i,
                b = i;
            while (a > 0 && lis[a - 1].classList.contains('is-nested')) a--;
            while (b < lis.length - 1 && lis[b + 1].classList.contains('is-nested')) b++;
            return lis.slice(a, b + 1).map((li) => [li]);
        }
        const units: HTMLElement[][] = [];
        for (const li of lis) {
            if (li.dataset.groupHead) units.push([li]);
            else if (li.classList.contains('is-nested')) units[units.length - 1]?.push(li);
            else if (li.dataset.section) units.push([li]);
        }
        return units;
    };

    const placeSectionRow = (row: HTMLElement, from: number, to: number, tops?: Map<HTMLElement, number>) => {
        const units = sectionUnits(row);
        if (to < 0 || to >= units.length || from === to) return;
        const [moved] = units.splice(from, 1);
        units.splice(to, 0, moved);
        const ids = units.map((u) => u.map((li) => li.dataset.section ?? '').filter(Boolean));
        const before = new Map<string, number>();
        for (const li of context.nav.querySelectorAll<HTMLElement>('.opal-course-nav-li'))
            before.set(keyOf(li), tops?.get(li) ?? li.getBoundingClientRect().top);
        context.prefs = placeSections(context.prefs, contentSectionIds(), ids);
        context.persistPrefs();
        context.render();
        for (const li of context.nav.querySelectorAll<HTMLElement>('.opal-course-nav-li')) {
            const top = before.get(keyOf(li)),
                now = li.getBoundingClientRect().top;
            if (top !== undefined && Math.abs(top - now) > 0.5) void reorder(li, top - now);
        }
        const id = row.dataset.section ?? '';
        // Keyboard steps keep focus on the grip; a pointer drop leaves focus where it was.
        if (!tops)
            (context.byFocusKey(context.nav, `fk:grip:${id}`) as HTMLElement | null)?.focus({ preventScroll: true });
        const order = sectionUnits(
            context.nav.querySelector<HTMLElement>(`[data-section="${CSS.escape(id)}"]`) ?? row,
        ).findIndex((u) => u.some((li) => li.dataset.section === id));
        const section = context.snapshot?.sections.find((s) => s.nodeId === id);
        context.announce(
            t('movedPosition', { title: section ? sectionTitle(section) : t('section'), position: order + 1 }),
        );
    };

    const blockRows = (row: HTMLElement) =>
        Array.from(row.parentElement?.querySelectorAll<HTMLElement>(':scope > [data-block]') ?? []).map((li) => [li]);

    const placeHomeRow = (row: HTMLElement, from: number, to: number, tops?: Map<HTMLElement, number>) => {
        const total = blockRows(row).length,
            id = row.dataset.block ?? '';
        if (!context.homeConfig || to < 0 || to >= total || from === to) return;
        const before = new Map<string, number>();
        for (const li of context.homeBox.querySelectorAll<HTMLElement>('[data-block]'))
            before.set(li.dataset.block ?? '', tops?.get(li) ?? li.getBoundingClientRect().top);
        context.homeConfig = placeBlock(context.homeConfig, id, to);
        context.persistHome();
        context.render();
        settle(context.homeBox, 'data-block', before);
        if (!tops)
            (context.byFocusKey(context.homeBox, `fk:grip:${id}`) as HTMLElement | null)?.focus({
                preventScroll: true,
            });
        const block = context.homeConfig.blocks.find((b) => b.id === id);
        context.announce(
            t('movedPositionTotal', { title: block ? homeBlockTitle(block, context.snapshot) : t('homeBlock'), position: to + 1, total }),
        );
    };
    return { contentSectionIds, editSection, settle, keyOf, sectionUnits, placeSectionRow, blockRows, placeHomeRow };
}
