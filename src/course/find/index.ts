import type { CourseSection } from '../types.ts';
import type { EntryCategory, Located } from './types.ts';
import { classify } from './classify.ts';
import { itemNumber } from './numbers.ts';

export * from './types.ts';
export * from './classify.ts';
export * from './numbers.ts';
export * from './match.ts';
export * from './pairs.ts';
export * from './highlights.ts';
export * from './history.ts';

export function locate(sections: CourseSection[]): Located[] {
    // Keep the pure find layer independent of rendering and its DOM helpers.
    return sections.filter(s => s.state !== 'native' && !['interactive', 'calendar', 'announcements', 'structure'].includes(s.kind) && (s.kind !== 'root' || s.entries.length > 0))
        .flatMap(section => section.entries.map(entry => ({ entry, section, category: classify(entry, section), number: itemNumber(entry) })));
}

export function categoryCounts(located: Located[]): Partial<Record<EntryCategory, number>> {
    const counts: Partial<Record<EntryCategory, number>> = {};
    for (const item of located) counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
}
