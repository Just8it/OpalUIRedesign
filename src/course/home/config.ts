import { sectionTitle } from '../tree.ts';
import { locale } from '../../i18n/core.ts';
import { courseMessages, t } from '../../i18n/messages/course.ts';
import type { CourseSnapshot } from '../types.ts';
import type { Located } from '../find/types.ts';
import { isListable } from '../browse/nav.ts';
import { isRichPage } from '../parsers.ts';
import type { BlockConfig, BlockSource, HomeConfig, HomeModel } from './types.ts';
import { buildUnits, sourceEntries } from './units.ts';

const DEFAULT_TITLES = {
    'cat:lecture': 'categoryLecture', 'cat:exercise': 'categoryExercise', 'cat:exam': 'categoryExam',
    pinned: 'homePinned', ann: 'announcements',
} as const;
const defaultTitleKey = (id: string) => Object.prototype.hasOwnProperty.call(DEFAULT_TITLES, id) ? DEFAULT_TITLES[id as keyof typeof DEFAULT_TITLES] : undefined;
export const isBuiltin = (id: string): boolean => defaultTitleKey(id) !== undefined;
const categories = ['lecture', 'exercise', 'solution', 'exam', 'video', 'other'];
function validSource(raw: unknown): raw is BlockSource {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as BlockSource;
    switch (s.type) {
        case 'category': return categories.includes(s.category);
        case 'sections': return Array.isArray(s.sectionIds) && s.sectionIds.length > 0 && s.sectionIds.every(id => typeof id === 'string');
        case 'folder': return typeof s.sectionId === 'string' && Array.isArray(s.folderPath) && s.folderPath.every(p => typeof p === 'string');
        case 'page': return typeof s.sectionId === 'string';
        case 'pinned': case 'announcements': return true;
        default: return false;
    }
}
export function defaultHome(snapshot: CourseSnapshot, located: Located[]): HomeConfig {
    const blocks: BlockConfig[] = [];
    const titleOrigin = locale() === 'en' ? { titleLocale: 'en' as const } : {};
    for (const [color, category] of (['lecture', 'exercise', 'exam'] as const).entries()) {
        const source: BlockSource = { type: 'category', category };
        const id = `cat:${category}` as const;
        if (sourceEntries(source, located).length) blocks.push({ id, title: t(DEFAULT_TITLES[id]), ...titleOrigin, color, source, hidden: false, series: category !== 'exam' });
    }
    // The first page with real content (a schedule, contacts) earns a place right after the study blocks.
    const info = snapshot.sections.find(s => s.kind === 'page' && isRichPage(s.html));
    if (info) blocks.push({ id: `page:${info.nodeId}`, title: info.title, color: 6, source: { type: 'page', sectionId: info.nodeId }, hidden: false, series: false });
    const others = snapshot.sections.filter(isListable).filter(s => s.kind !== 'page' || !isRichPage(s.html)).filter(s => located.filter(i => i.section.nodeId === s.nodeId && i.category === 'other').length >= 3).slice(0, 3);
    others.forEach((s, n) => blocks.push({ id: `sec:${s.nodeId}`, title: s.title, color: 5 + n % 3, source: { type: 'sections', sectionIds: [s.nodeId] }, hidden: false, series: false }));
    if (located.length) blocks.push({ id: 'pinned', title: t('homePinned'), ...titleOrigin, color: 3, source: { type: 'pinned' }, hidden: false, series: false });
    if (snapshot.announcements.length) blocks.push({ id: 'ann', title: t('announcements'), ...titleOrigin, color: 4, source: { type: 'announcements' }, hidden: false, series: false });
    return { version: 1, blocks };
}

/** Without a snapshot, validate storage structurally; resolve sources when data is available. */
export function normaliseHome(raw: unknown, snapshot?: CourseSnapshot, located: Located[] = []): HomeConfig {
    const valid = raw && typeof raw === 'object' && Array.isArray((raw as HomeConfig).blocks);
    if (!valid && snapshot) return defaultHome(snapshot, located);
    const input = valid ? (raw as HomeConfig).blocks : [];
    const blocks: BlockConfig[] = [], ids = new Set<string>();
    for (const b of input) {
        if (!b || typeof b.id !== 'string' || ids.has(b.id) || !validSource(b.source)) continue;
        const pageGone = (s: BlockSource) => s.type === 'page' && !snapshot?.sections.some(x => x.nodeId === s.sectionId && x.html);
        if (snapshot && !isBuiltin(b.id) && (b.source.type === 'page' ? pageGone(b.source) : !sourceEntries(b.source, located).length && b.source.type !== 'pinned' && b.source.type !== 'announcements')) continue;
        ids.add(b.id);
        const units = snapshot ? buildUnits(b.source, located) : [];
        const titleKey = defaultTitleKey(b.id);
        const storedLocale = b.titleLocale === 'en' ? 'en' : 'de';
        const hasTitle = typeof b.title === 'string';
        const defaultTitle = titleKey && (!hasTitle || b.titleLocale !== null && b.title === courseMessages[storedLocale][titleKey]);
        const title = defaultTitle ? t(titleKey) : hasTitle ? b.title : t('homeMaterials');
        const titleLocale = defaultTitle ? (locale() === 'en' ? 'en' : undefined) : b.titleLocale === undefined ? undefined : null;
        blocks.push({ id: b.id, title, ...(titleLocale !== undefined ? { titleLocale } : {}), source: b.source,
            color: Number.isInteger(b.color) && b.color >= 0 && b.color < 8 ? b.color : 5 + blocks.length % 3,
            hidden: b.hidden === true, series: b.source.type === 'page' ? false : typeof b.series === 'boolean' ? b.series : b.source.type === 'category' ? ['lecture', 'exercise'].includes(b.source.category) : units.length > 0 && units.filter(u => u.number !== undefined).length / units.length >= 0.6 });
    }
    if (snapshot) for (const b of defaultHome(snapshot, located).blocks) if (!ids.has(b.id) && isBuiltin(b.id)) blocks.push(b);
    return { version: 1, blocks };
}
export function homeBlockTitle(block: BlockConfig, snapshot: CourseSnapshot | null): string {
    if (block.titleLocale === null || block.title !== courseMessages.de.courseInfo) return block.title;
    const source = block.source;
    const id = source.type === 'page' ? source.sectionId : source.type === 'sections' && source.sectionIds.length === 1 ? source.sectionIds[0] : undefined;
    const section = snapshot?.sections.find(s => s.nodeId === id);
    return section ? sectionTitle(section) : block.title;
}

const sourceKey = (s: BlockSource): string => s.type === 'sections' ? JSON.stringify([s.type, [...s.sectionIds].sort()]) : s.type === 'folder' ? JSON.stringify([s.type, s.sectionId, s.folderPath]) : JSON.stringify(s);
export function addable(snapshot: CourseSnapshot, located: Located[], config: HomeConfig): HomeModel['addable'] {
    const used = new Set(config.blocks.map(b => sourceKey(b.source)));
    const result: HomeModel['addable'] = [];
    const addSection = (s: CourseSnapshot['sections'][number], id: string, source: BlockSource, count: number) => {
        if (used.has(sourceKey(source))) return;
        const displayTitle = sectionTitle(s);
        result.push({ id, title: s.title, ...(displayTitle === s.title ? {} : { displayTitle }), source, count });
    };
    for (const s of snapshot.sections.filter(s => s.kind === 'page' && s.html)) {
        addSection(s, `page:${s.nodeId}`, { type: 'page', sectionId: s.nodeId }, located.filter(i => i.section.nodeId === s.nodeId).length);
    }
    // A page with content is offered as a page block above; its files come with it.
    for (const s of snapshot.sections.filter(isListable).filter(s => !(s.kind === 'page' && s.html))) {
        const entries = located.filter(i => i.section.nodeId === s.nodeId);
        addSection(s, `sec:${s.nodeId}`, { type: 'sections', sectionIds: [s.nodeId] }, entries.length);
        const folders = new Map<string, number>();
        for (const i of entries) if (i.entry.folderPath.length) folders.set(i.entry.folderPath[0], (folders.get(i.entry.folderPath[0]) ?? 0) + 1);
        for (const [folder, count] of folders) {
            const source: BlockSource = { type: 'folder', sectionId: s.nodeId, folderPath: [folder] };
            if (count >= 2 && !used.has(sourceKey(source))) result.push({ id: `folder:${s.nodeId}:${encodeURIComponent(folder)}`, title: folder, source, count });
        }
    }
    return result;
}
/** Swaps with the nearest neighbour the student can see, so every press visibly moves the block. */
export function moveBlock(config: HomeConfig, id: string, delta: -1 | 1): HomeConfig {
    const blocks = [...config.blocks], n = blocks.findIndex(b => b.id === id);
    let target = n + delta;
    while (n >= 0 && !blocks[n].hidden && target >= 0 && target < blocks.length && blocks[target].hidden) target += delta;
    if (n >= 0 && target >= 0 && target < blocks.length) [blocks[n], blocks[target]] = [blocks[target], blocks[n]];
    return { ...config, blocks };
}
/** Drag and drop: put a visible block at `to` among the visible blocks. Hidden blocks keep their slots. */
export function placeBlock(config: HomeConfig, id: string, to: number): HomeConfig {
    const visible = config.blocks.filter(b => !b.hidden), from = visible.findIndex(b => b.id === id);
    if (from < 0) return config;
    const order = [...visible];
    const [moved] = order.splice(from, 1);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, moved);
    let n = 0;
    return { ...config, blocks: config.blocks.map(b => b.hidden ? b : order[n++]) };
}
export function updateBlock(config: HomeConfig, id: string, patch: Partial<Pick<BlockConfig, 'title' | 'color' | 'hidden' | 'series'>>): HomeConfig {
    return { ...config, blocks: config.blocks.map(b => b.id === id ? { ...b, ...patch, ...(typeof patch.title === 'string' ? { titleLocale: null } : {}) } : b) };
}
export function addBlock(config: HomeConfig, source: BlockSource, title: string, located: Located[] = []): HomeConfig {
    let n = 1;
    while (config.blocks.some(b => b.id === `custom:${n}`)) n++;
    const units = buildUnits(source, located);
    const series = source.type === 'page' ? false : source.type === 'category' ? ['lecture', 'exercise'].includes(source.category) : units.length > 0 && units.filter(u => u.number !== undefined).length / units.length >= 0.6;
    return { ...config, blocks: [...config.blocks, { id: `custom:${n}`, source, title, color: 5 + config.blocks.filter(b => !isBuiltin(b.id)).length % 3, hidden: false, series }] };
}
export function removeBlock(config: HomeConfig, id: string): HomeConfig {
    return isBuiltin(id) ? updateBlock(config, id, { hidden: true }) : { ...config, blocks: config.blocks.filter(b => b.id !== id) };
}
export function blockSelectionId(block: BlockConfig): string {
    const s = block.source;
    switch (s.type) {
        case 'category': return `cat:${s.category}`;
        case 'sections': return s.sectionIds.length === 1 ? `sec:${s.sectionIds[0]}` : 'all';
        case 'folder': return `sec:${s.sectionId}`;
        case 'page': return `sec:${s.sectionId}`;
        case 'announcements': return 'ann';
        case 'pinned': return 'all';
    }
}
