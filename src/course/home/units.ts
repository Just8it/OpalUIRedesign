import { sectionTitle } from '../tree.ts';
import { t } from '../../i18n/messages/course.ts';
import { localeTag } from '../../i18n/core.ts';
import type { CourseEntry } from '../types.ts';
import { CATEGORY_LABEL, itemNumber, pairSolutions } from '../find/index.ts';
import type { Located } from '../find/types.ts';
import type { BlockSource, Unit } from './types.ts';

const natural = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const fold = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
// Only category containers are transparent. Topic folders remain whole units.
const container = (s: string) => /^(aufgabe|aufgaben|aufgabenstellung|aufgabenstellungen|loesung|loesungen|musterloesung|musterloesungen|uebung|uebungen|rechenuebungen|folien|skript|skripte|vorlesung|vorlesungen|vorlesungsunterlagen|lecture|slides|solution|solutions|exercise|exercises)$/i.test(fold(s).trim());
const variant = (e: CourseEntry) => /(?:notizseiten|plus|neu)(?:\b|_)/i.test(e.title + ' ' + (e.fileName ?? '')) ? 1 : 0;

/** Page ordered entries behind a source, including exercise solutions. */
export function sourceEntries(source: BlockSource, located: Located[]): Located[] {
    switch (source.type) {
        case 'category': return located.filter(i => i.category === source.category || source.category === 'exercise' && i.category === 'solution');
        case 'sections': { const ids = new Set(source.sectionIds); return located.filter(i => ids.has(i.section.nodeId)); }
        case 'folder': return located.filter(i => i.section.nodeId === source.sectionId && source.folderPath.every((p, n) => i.entry.folderPath[n] === p));
        case 'page': return located.filter(i => i.section.nodeId === source.sectionId);
        default: return [];
    }
}

/** Number extraction supplements the shared parser for compact A01/L01 sheet names. */
function numberOf(i: Located): number | undefined {
    const compact = (i.entry.title + ' ' + (i.entry.fileName ?? '')).match(/(?:^|[_\s-])[AL]0*(\d+)(?=[_.\s-]|$)/i);
    return i.number ?? (compact ? Number(compact[1]) : undefined);
}

export function buildUnits(source: BlockSource, located: Located[]): Unit[] {
    const items = sourceEntries(source, located);
    const formatNumber = new Intl.NumberFormat(localeTag()).format;
    const groups = new Map<string, { items: Located[]; folder?: string[]; extra: boolean }>();
    for (const original of items) {
        const i = { ...original, number: numberOf(original) };
        const root = source.type === 'folder' ? source.folderPath.length : 0;
        const relative = i.entry.folderPath.slice(root);
        const firstTopic = relative.findIndex(p => !container(p));
        // Additional exercise containers carry a separate numbered sequence.
        const extra = firstTopic >= 0 && /^zusatzaufgaben?$/i.test(relative[firstTopic]);
        const folder = firstTopic >= 0 && !extra ? i.entry.folderPath.slice(0, root + firstTopic + 1) : undefined;
        const key = JSON.stringify([i.section.nodeId, folder ?? extra]);
        let group = groups.get(key);
        if (!group) { group = { items: [], folder, extra }; groups.set(key, group); }
        group.items.push(i);
    }
    const units: { unit: Unit; order: number }[] = [];
    const order = new Map(items.map((i, n) => [i.entry, n]));
    for (const group of groups.values()) {
        const first = group.items[0];
        if (group.folder) {
            const entries = group.items.map(i => i.entry).sort((a, b) => variant(a) - variant(b) || natural.compare(a.title, b.title));
            const title = group.folder[group.folder.length - 1];
            units.push({ order: order.get(first.entry) ?? 0, unit: {
                key: `${first.section.nodeId}|f|${group.folder.map(encodeURIComponent).join('/')}`,
                title, number: itemNumber({ ...first.entry, title, fileName: '', folderPath: [] }),
                entries, solutions: [], location: [sectionTitle(first.section), ...group.folder.slice(0, -1)].join(' › '),
                state: 'upcoming', hasNew: entries.some(e => e.isNew),
            } });
            continue;
        }
        const numbered = new Map<string, Unit>();
        for (const i of pairSolutions(group.items)) {
            const category = i.category;
            const key = i.number === undefined ? `${i.section.nodeId}|u|${i.entry.url}` : `${i.section.nodeId}|n|${category}|${i.number}${group.extra ? '|extra' : ''}`;
            let unit = numbered.get(key);
            if (!unit) {
                const lecturerLabel = /^(?:vorlesung|übung|uebung)\s*\d+\s*[:–-]/i.test(i.entry.title);
                unit = { key, title: lecturerLabel || i.number === undefined ? i.entry.title : t('numberedUnit', { title: group.extra ? t('extraExercise') : CATEGORY_LABEL[category], number: formatNumber(i.number) }),
                    number: i.number, entries: [], solutions: [], location: [sectionTitle(i.section), ...i.entry.folderPath].join(' › '), state: 'upcoming', hasNew: false };
                numbered.set(key, unit);
                units.push({ unit, order: order.get(i.entry) ?? 0 });
            }
            unit.entries.push(i.entry);
            if (i.solution) unit.solutions.push(i.solution);
            unit.hasNew ||= i.entry.isNew || !!i.solution?.isNew;
        }
    }
    const numeric = units.filter(u => u.unit.number !== undefined).length >= units.length * 0.6;
    units.sort((a, b) => (numeric ? (a.unit.number ?? Infinity) - (b.unit.number ?? Infinity) : 0) || a.order - b.order);
    return units.map(u => u.unit);
}
