import { sectionTitle } from '../tree.ts';
import { t } from '../../i18n/messages/course.ts';
import type { CourseNode, CourseSection, CourseSnapshot } from '../types.ts';
import { CATEGORY_ORDER, CATEGORY_PLURAL, categoryCounts, recent } from '../find/index.ts';
import type { EntryCategory } from '../find/types.ts';
import type { BrowsePrefs, Located, NavBlock, NavItem, OpenedMap } from './types.ts';

export const isArea = (s: CourseSection): boolean => s.kind !== 'announcements' && (s.state === 'native' || ['interactive', 'calendar'].includes(s.kind) || s.state === 'empty' && s.entries.length === 0);
export const isListable = (s: CourseSection): boolean => !isArea(s) && !['structure', 'announcements'].includes(s.kind) && (s.kind !== 'root' || s.entries.length > 0);
export function orderedSections(snapshot: CourseSnapshot, prefs: BrowsePrefs): CourseSection[] {
    const rank = new Map(prefs.order.map((id, index) => [id, index]));
    const ordered = snapshot.sections.filter(isListable).sort((a, b) => (rank.get(a.nodeId) ?? Infinity) - (rank.get(b.nodeId) ?? Infinity));
    const paths = structurePaths(snapshot), buckets = new Map<string, CourseSection[]>();
    for (const section of ordered) {
        const ancestors = paths.get(section.nodeId) ?? [];
        const key = ancestors.length ? `group:${ancestors[ancestors.length - 1].id}` : `section:${section.nodeId}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(section); else buckets.set(key, [section]);
    }
    return [...buckets.values()].flat();
}
export function structurePaths(snapshot: CourseSnapshot): Map<string, CourseNode[]> {
    const result = new Map<string, CourseNode[]>();
    const walk = (node: CourseNode, ancestors: CourseNode[]) => {
        result.set(node.id, ancestors);
        const next = node.kind === 'structure' ? [...ancestors, node] : ancestors;
        for (const child of node.children) walk(child, next);
    };
    walk(snapshot.tree, []);
    return result;
}
export function changedEntries(located: Located[], now = Date.now()): Located[] {
    return located.filter(i => i.entry.isNew || i.entry.modified !== undefined && i.entry.modified >= now - 14 * 86400000);
}
/** Solutions belong to their exercise sheets, so "Übungen" lists both and the sidebar has no "Lösungen". */
export const NAV_CATEGORIES: EntryCategory[] = CATEGORY_ORDER.filter(c => c !== 'other' && c !== 'solution');
export const inCategory = (item: EntryCategory, selected: EntryCategory): boolean => item === selected || selected === 'exercise' && item === 'solution';

export function buildNav(snapshot: CourseSnapshot, located: Located[], opened: OpenedMap, prefs: BrowsePrefs, editing: boolean): NavBlock[] {
    // What the student studies comes first: Übersicht, then Vorlesungen, Übungen, ...
    const study: NavItem[] = [{ id: 'home', kind: 'home', label: t('overview'), depth: 0 }];
    const counts = categoryCounts(located);
    const kinds: NavItem[] = NAV_CATEGORIES.map(c => ({ c, count: located.filter(i => inCategory(i.category, c)).length }))
        .filter(({ c, count }) => count && (counts[c] || c === 'exercise')).map(({ c, count }) => ({ id: `cat:${c}`, kind: 'category', label: CATEGORY_PLURAL[c], category: c, count, depth: 0, hasNew: located.some(i => inCategory(i.category, c) && i.entry.isNew) }));
    // One recognised kind says nothing the course menu doesn't already say.
    if (kinds.length >= 2) study.push(...kinds);
    const uploads = snapshot.sections.filter(s => s.canUpload);
    if (uploads.length) {
        const handedIn = uploads.reduce((n, s) => n + s.entries.length, 0);
        study.push({ id: 'upload', kind: 'upload', label: t('submission'), ...(handedIn ? { count: handedIn } : {}), depth: 0 });
    }
    const blocks: NavBlock[] = [{ key: 'study', title: null, items: study }];

    const activity: NavItem[] = [];
    const openedItems = recent(located, opened, Infinity), changed = changedEntries(located);
    if (changed.length) activity.push({ id: 'changed', kind: 'changed', label: t('navChanged'), count: changed.length, hasNew: changed.some(i => i.entry.isNew), depth: 0 });
    if (snapshot.announcements.length) activity.push({ id: 'ann', kind: 'announcements', label: t('announcements'), count: snapshot.announcements.length, hasNew: snapshot.announcements.some(a => a.date !== undefined && a.date > snapshot.previousVisit), depth: 0 });
    if (openedItems.length) activity.push({ id: 'recent', kind: 'recent', label: t('navRecent'), count: openedItems.length, depth: 0 });
    if (activity.length) blocks.push({ key: 'activity', title: t('navActivity'), items: activity });
    const hidden = new Set(prefs.hidden), paths = structurePaths(snapshot);
    const sections = orderedSections(snapshot, prefs).filter(s => editing || !hidden.has(s.nodeId));
    const grouped = new Map<string, CourseSection[]>();
    for (const s of sections) {
        const ancestors = paths.get(s.nodeId) ?? [];
        const parent = ancestors[ancestors.length - 1];
        if (parent) grouped.set(parent.id, [...(grouped.get(parent.id) ?? []), s]);
    }
    const content: NavItem[] = [{ id: 'all', kind: 'all', label: t('navAllFiles'), count: located.length, depth: 0 }], emitted = new Set<string>();
    const sectionItem = (s: CourseSection, depth: 0 | 1): NavItem => ({ id: `sec:${s.nodeId}`, kind: 'section', label: sectionTitle(s), count: s.entries.length, depth, url: s.url, hasNew: s.entries.some(e => e.isNew), ...(hidden.has(s.nodeId) ? { hidden: true } : {}) });
    for (const s of sections) {
        const ancestors = paths.get(s.nodeId) ?? [], parent = ancestors[ancestors.length - 1];
        const members = parent ? grouped.get(parent.id) ?? [] : [];
        if (members.length < 2) { content.push(sectionItem(s, 0)); continue; }
        if (emitted.has(parent.id)) continue;
        emitted.add(parent.id);
        content.push({ id: `grp:${parent.id}`, kind: 'group', label: ancestors.map(n => n.title).join(' › '), count: members.reduce((n, member) => n + member.entries.length, 0), depth: 0, url: parent.url, hasNew: members.some(member => member.entries.some(e => e.isNew)) });
        content.push(...members.map(member => sectionItem(member, 1)));
    }
    blocks.push({ key: 'content', title: t('navContent'), items: content });
    const areas: NavItem[] = snapshot.sections.filter(isArea).filter(s => editing || !hidden.has(s.nodeId)).map(s => ({ id: `area:${s.nodeId}`, kind: 'area', label: sectionTitle(s), depth: 0, url: s.url, ...(hidden.has(s.nodeId) ? { hidden: true } : {}) }));
    if (areas.length) blocks.push({ key: 'areas', title: t('navAreas'), items: areas });
    return blocks;
}
