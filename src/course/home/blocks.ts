import { t } from '../../i18n/messages/course.ts';
import type { CourseSnapshot } from '../types.ts';
import type { Located, OpenedMap } from '../find/types.ts';
import type { BlockConfig, CourseProgress, HomeBlock, HomeConfig, HomeModel, SeriesBlock } from './types.ts';
import { buildUnits, sourceEntries } from './units.ts';
import { addable, homeBlockTitle } from './config.ts';
import { withoutTitleLine } from '../parsers.ts';

export function buildSeries(config: BlockConfig, located: Located[], progress: CourseProgress): SeriesBlock {
    const units = buildUnits(config.source, located);
    const done = (key: string) => Object.prototype.hasOwnProperty.call(progress.done, key);
    const manual = units.findIndex(u => u.key === progress.pointer[config.id]);
    const pointer = manual >= 0 ? manual : units.findIndex(u => !done(u.key));
    const currentIndex = pointer < 0 ? -1 : units.findIndex((u, n) => n >= pointer && !done(u.key));
    for (const [n, unit] of units.entries()) {
        unit.state = done(unit.key) ? 'done' : n === currentIndex ? 'current' : n < pointer ? 'past' : 'upcoming';
        if (unit.state === 'done') unit.doneAt = progress.done[unit.key];
    }
    const doneCount = units.filter(u => u.state === 'done').length;
    return { kind: 'series', config, units, current: units[currentIndex], next: units.filter(u => u.state === 'upcoming').slice(0, 3), earlier: units.filter(u => u.state === 'done' || u.state === 'past').reverse(), doneCount,
        progressText: units.length > 0 && doneCount === units.length ? t('homeAllDone') : doneCount ? t('homeSeriesProgress', { done: doneCount, total: units.length }) : t('unitCount', { count: units.length }) };
}
export function buildHome({ snapshot, located, config, progress, editing }: { snapshot: CourseSnapshot; located: Located[]; config: HomeConfig; progress: CourseProgress; opened: OpenedMap; editing: boolean }): HomeModel {
    const visibleTitles = config.blocks.map(b => {
        const title = homeBlockTitle(b, snapshot);
        return title === b.title ? b : { ...b, title };
    });
    const blocks: HomeBlock[] = [], hidden = visibleTitles.filter(b => b.hidden);
    const urls = new Map(located.map(i => [i.entry.url, i.entry]));
    for (const b of visibleTitles) {
        if (b.hidden) continue;
        let block: HomeBlock;
        if (b.source.type === 'announcements') {
            const items = [...snapshot.announcements].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
            block = { kind: 'announcements', config: b, items, total: items.length, unread: snapshot.previousVisit > 0 ? items.filter(a => (a.date ?? 0) > snapshot.previousVisit).length : 0 };
        } else if (b.source.type === 'page') {
            const sectionId = b.source.sectionId;
            const section = snapshot.sections.find(s => s.nodeId === sectionId);
            if (!section?.html) { if (editing) hidden.push(b); continue; }
            block = { kind: 'page', config: b, html: withoutTitleLine(section.html, snapshot.title), total: located.filter(i => i.section.nodeId === sectionId).length };
        } else if (b.source.type === 'pinned') {
            const entries = progress.pinned.flatMap(url => { const e = urls.get(url); return e ? [e] : []; });
            block = { kind: 'list', config: b, entries, total: entries.length };
        } else if (b.series) block = buildSeries(b, located, progress);
        else { const entries = sourceEntries(b.source, located).map(i => i.entry); block = { kind: 'list', config: b, entries, total: entries.length }; }
        if (editing || block.kind === 'page' || (block.kind === 'series' ? block.units.length : block.total) > 0) blocks.push(block);
    }
    return { blocks, hidden, addable: addable(snapshot, located, config), empty: !blocks.some(b => b.kind === 'page' || (b.kind === 'series' ? b.units.length : b.total) > 0) };
}
