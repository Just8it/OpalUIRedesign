import type { Located, OpenedMap } from './types.ts';

export function latest(located: Located[], limit: number): Located[] {
    const dated = located.filter(i => i.entry.modified !== undefined).sort((a, b) => (b.entry.modified ?? 0) - (a.entry.modified ?? 0));
    const added = located.filter(i => i.entry.modified === undefined && i.entry.isNew);
    if (dated.length || added.length) return [...dated, ...added].slice(0, Math.max(0, limit));
    const order = new Map(located.map((i, index) => [i, index]));
    const rank = new Map<Located, number>();
    {
        // Take the newest item of each category before repeating a category.
        const groups = new Map<string, Located[]>();
        for (const item of located) {
            const group = groups.get(item.category) ?? [];
            group.push(item);
            groups.set(item.category, group);
        }
        for (const group of groups.values()) group.sort((a, b) => (b.number ?? -1) - (a.number ?? -1) || (order.get(b) ?? 0) - (order.get(a) ?? 0)).forEach((item, index) => rank.set(item, index));
    }
    return [...located].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0) || (b.number ?? -1) - (a.number ?? -1) || (order.get(b) ?? 0) - (order.get(a) ?? 0)).slice(0, Math.max(0, limit));
}
export function recent(located: Located[], opened: OpenedMap, limit: number): Located[] {
    return located.filter(i => Object.prototype.hasOwnProperty.call(opened, i.entry.url)).sort((a, b) => opened[b.entry.url] - opened[a.entry.url]).slice(0, Math.max(0, limit));
}
