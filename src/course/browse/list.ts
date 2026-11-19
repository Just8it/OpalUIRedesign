import { sectionTitle } from '../tree.ts';
import { courseMessages, t } from '../../i18n/messages/course.ts';
import type { CourseSection, CourseSectionIssue, CourseSnapshot } from '../types.ts';
import { CATEGORY_PLURAL, find, pairSolutions, recent } from '../find/index.ts';
import type { EntryCategory, PairedEntry } from '../find/types.ts';
import type { BrowsePrefs, ListEntry, ListGroup, ListModel, Located, OpenedMap, Sort } from './types.ts';
import { changedEntries, inCategory, orderedSections, structurePaths } from './nav.ts';
import { formatModified, formatSize, naturalCompare, splitName } from './format.ts';
import { pageExcerpt, withoutTitleLine } from '../parsers.ts';

interface ListArgs {
    snapshot: CourseSnapshot; located: Located[]; opened: OpenedMap; prefs: BrowsePrefs;
    selected: string; query: string; sort: Sort;
}
const stripExtension = (text: string, extension?: string): string => extension && text.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? text.slice(0, -extension.length - 1) : text;
function row(item: PairedEntry, opened: OpenedMap, now: number, ranges: [number, number][] = []): ListEntry {
    const { entry, section, category } = item;
    const name = stripExtension(entry.title, entry.extension);
    const comparable = (s: string) => stripExtension(s, entry.extension).toLowerCase().replace(/[_\s]+/g, ' ').trim();
    const size = formatSize(entry.sizeText);
    return {
        entry, category, name, ...splitName(name),
        ...(entry.fileName && comparable(entry.fileName) !== comparable(entry.title) ? { fileName: entry.fileName } : {}),
        type: section.kind === 'literature' ? t('fileTypeLiterature') : entry.kind === 'video' ? t('fileTypeVideo') : entry.kind === 'link' ? t('fileTypeLink') : (entry.extension ?? '').toUpperCase(),
        size: size.text, sizeBytes: size.bytes, modified: formatModified(entry.modified, now), modifiedMs: entry.modified,
        isNew: entry.isNew, openedAt: opened[entry.url], solution: item.solution,
        location: [sectionTitle(section), ...entry.folderPath].join(' › '),
        ranges: ranges.map(([start, end]): [number, number] => [start, Math.min(end, name.length)]).filter(([start, end]) => start < end),
    };
}
function sortRows(rows: ListEntry[], sort: Sort): ListEntry[] {
    if (sort.key === 'order') return rows;
    const value = (r: ListEntry): string | number | undefined => sort.key === 'name' ? r.name : sort.key === 'type' ? r.type || undefined : sort.key === 'size' ? r.sizeBytes : r.modifiedMs;
    return rows.sort((a, b) => {
        const av = value(a), bv = value(b);
        if (av === undefined) return bv === undefined ? 0 : 1;
        if (bv === undefined) return -1;
        const comparison = typeof av === 'number' && typeof bv === 'number' ? av - bv : naturalCompare(String(av), String(bv));
        return comparison * (sort.dir === 'desc' ? -1 : 1);
    });
}
function summary(items: Located[], results: boolean): string {
    if (results) return t('resultCount', { count: items.length });
    const files = items.filter(i => i.entry.kind === 'file').length, links = items.length - files;
    if (files && links) return t('fileAndLinkCount', { files: t('fileCount', { count: files }), links: t('linkCount', { count: links }) });
    return links ? t('linkCount', { count: links }) : t('fileCount', { count: files });
}
function sectionIssueText(issue: CourseSectionIssue): string {
    if (issue.kind === 'sectionLoadError') return t(issue.kind);
    const reason = issue.kind === 'folderOpenInOpal' ? t(issue.kind, { title: issue.title }) : t(issue.kind);
    return t('folderIncomplete', { reason });
}

function sectionNote(error: CourseSection['error']): string | undefined {
    if (typeof error !== 'string') return error && sectionIssueText(error);
    const de = courseMessages.de;
    if (error === de.sectionLoadError) return t('sectionLoadError');
    const prefix = de.folderIncomplete.split('{reason}')[0];
    if (!error.startsWith(prefix)) return error;
    const reason = error.slice(prefix.length);
    if (reason === de.folderBudget) return sectionIssueText({ kind: 'folderBudget' });
    if (reason === de.folderMorePages) return sectionIssueText({ kind: 'folderMorePages' });
    const [before, after] = de.folderOpenInOpal.split('{title}');
    if (reason.startsWith(before) && reason.endsWith(after)) {
        return sectionIssueText({ kind: 'folderOpenInOpal', title: reason.slice(before.length, -after.length) });
    }
    return error;
}

export function buildList({ snapshot, located, opened, prefs, selected, query, sort }: ListArgs): ListModel {
    const now = Date.now(), search = query.trim();
    const category = selected.startsWith('cat:') ? selected.slice(4) as EntryCategory : undefined;
    let title = t('navAllFiles');
    if (selected === 'ann' || selected.startsWith('area:')) {
        if (!search) {
            const area = snapshot.sections.find(s => `area:${s.nodeId}` === selected);
            return { title: area ? sectionTitle(area) : selected === 'ann' ? t('announcements') : '', summary: '', grouped: false, showLocation: false, groups: [] };
        }
    }
    if (search || selected === 'recent' || selected === 'changed') {
        let items: Located[], rows: ListEntry[], id: string;
        if (search) {
            title = t('listSearchTitle', { query: search }); id = 'results';
            const hits = find(located, search, category ?? 'all');
            items = hits; rows = hits.map(hit => row(hit, opened, now, hit.titleRanges));
        } else if (selected === 'recent') {
            title = t('navRecent'); id = 'recent';
            items = recent(located, opened, Infinity); rows = items.map(item => row(item, opened, now));
        } else {
            title = t('navChanged'); id = 'changed';
            items = changedEntries(located, now).sort((a, b) => Number(b.entry.isNew) - Number(a.entry.isNew) || (b.entry.modified ?? -Infinity) - (a.entry.modified ?? -Infinity)).slice(0, 30);
            rows = items.map(item => row(item, opened, now));
        }
        sortRows(rows, sort);
        return { title, summary: summary(items, !!search), grouped: false, showLocation: true,
            groups: rows.length ? [{ id, title, path: [], count: rows.length, state: 'loaded', folders: [{ label: '', entries: rows }] }] : [],
            ...(!rows.length ? { empty: search ? t('listSearchEmpty', { query: search }) : selected === 'recent' ? t('listRecentEmpty') : t('listChangedEmpty') } : {}),
        };
    }
    let sections = orderedSections(snapshot, prefs);
    if (selected.startsWith('sec:')) {
        sections = sections.filter(s => s.nodeId === selected.slice(4)); title = sections[0] ? sectionTitle(sections[0]) : t('section');
    } else if (selected.startsWith('grp:')) {
        const paths = structurePaths(snapshot), id = selected.slice(4);
        sections = sections.filter(s => paths.get(s.nodeId)?.some(n => n.id === id));
        const ancestors = sections.length ? paths.get(sections[0].nodeId) ?? [] : [];
        const index = ancestors.findIndex(n => n.id === id);
        title = ancestors.slice(0, index + 1).map(n => n.title).join(' › ') || t('navContent');
    } else if (category) {
        title = CATEGORY_PLURAL[category] ?? t('files');
        sections = sections.filter(s => located.some(i => i.section.nodeId === s.nodeId && inCategory(i.category, category)));
    } else if (selected === 'upload') {
        title = t('submission');
        // Empty hand-in folders still need their upload action.
        const rank = new Map(prefs.order.map((id, index) => [id, index]));
        sections = snapshot.sections.filter(s => s.canUpload).sort((a, b) => (rank.get(a.nodeId) ?? Infinity) - (rank.get(b.nodeId) ?? Infinity));
    } else sections = sections.filter(s => !prefs.hidden.includes(s.nodeId));
    const bySection = new Map<string, Located[]>();
    for (const item of located) {
        if (category && !inCategory(item.category, category)) continue;
        const items = bySection.get(item.section.nodeId);
        if (items) items.push(item); else bySection.set(item.section.nodeId, [item]);
    }
    const all: Located[] = [];
    const groups: ListGroup[] = sections.map(section => {
        const items = bySection.get(section.nodeId) ?? [];
        all.push(...items);
        const group: ListGroup = { id: section.nodeId, title: sectionTitle(section), path: section.path, count: items.length, url: section.url, canUpload: section.canUpload, state: section.state === 'pending' || section.state === 'error' || section.state === 'empty' ? section.state : 'loaded', folders: [], ...(section.error ? { note: sectionNote(section.error) } : {}) };
        const pageHtml = section.html ? withoutTitleLine(section.html, snapshot.title) : '';
        const excerpt = pageHtml ? pageExcerpt(pageHtml, snapshot.title) : '';
        if (excerpt) group.intro = { excerpt, html: pageHtml, ...(section.htmlTruncated ? { truncated: true } : {}) };
        if (section.state === 'pending' || section.state === 'error') return group;
        const folders = new Map<string, ListEntry[]>();
        // Exercise sheets carry their solution; other kinds list every file as it is.
        for (const item of category && category !== 'exercise' ? items : pairSolutions(items)) {
            const label = item.entry.folderPath.join(' › ');
            const entries = folders.get(label);
            if (entries) entries.push(row(item, opened, now)); else folders.set(label, [row(item, opened, now)]);
        }
        group.folders = [...folders].sort(([a], [b]) => a === '' ? -1 : b === '' ? 1 : naturalCompare(a, b)).map(([label, entries]) => ({ label, entries: sortRows(entries, sort.key === 'order' && section.kind === 'folder' ? { key: 'name', dir: 'asc' } : sort) }));
        return group;
    });
    return { title, summary: summary(all, false), grouped: true, showLocation: false, groups,
        ...(!all.length && !groups.some(g => g.state === 'pending' || g.state === 'error') ? { empty: t('listCourseEmpty') } : {}),
    };
}
