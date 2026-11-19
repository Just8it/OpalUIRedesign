import type { BrowseLayout, BrowsePrefs, Sort } from './types.ts';

export function defaultLayout(): BrowseLayout {
    return { density: 'compact', columns: { type: true, size: true, modified: true }, sidebar: true };
}
const record = (raw: unknown): Record<string, unknown> => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
export function normaliseLayout(raw: unknown): BrowseLayout {
    const value = record(raw), columns = record(value.columns), defaults = defaultLayout();
    return {
        density: value.density === 'normal' ? 'normal' : 'compact',
        sidebar: typeof value.sidebar === 'boolean' ? value.sidebar : defaults.sidebar,
        columns: {
            type: typeof columns.type === 'boolean' ? columns.type : true,
            size: typeof columns.size === 'boolean' ? columns.size : true,
            modified: typeof columns.modified === 'boolean' ? columns.modified : true,
        },
    };
}
export function normalisePrefs(raw: unknown, sectionIds: string[]): BrowsePrefs {
    const value = record(raw), ids = new Set(sectionIds);
    const clean = (list: unknown): string[] => Array.isArray(list) ? [...new Set(list.filter((id): id is string => typeof id === 'string' && ids.has(id)))] : [];
    const sort = record(value.sort);
    return {
        order: clean(value.order), hidden: clean(value.hidden), collapsed: clean(value.collapsed),
        ...(clean(value.open).length ? { open: clean(value.open) } : {}),
        ...(typeof value.selected === 'string' && (/^(all|recent|changed|ann|upload|cat:(lecture|exercise|solution|exam|video|other))$/.test(value.selected) || /^(sec|grp|area):/.test(value.selected) && ids.has(value.selected.slice(value.selected.indexOf(':') + 1))) ? { selected: value.selected } : {}),
        ...(['order', 'name', 'type', 'size', 'modified'].includes(String(sort.key)) && ['asc', 'desc'].includes(String(sort.dir)) ? { sort: sort as unknown as Sort } : {}),
    };
}
/** Drag and drop: `units` are the section ids of each unit in their new on-screen order
 *  (one id for a section, all member ids for a group). Sections outside the units keep their places. */
export function placeSections(prefs: BrowsePrefs, sectionIds: string[], units: string[][]): BrowsePrefs {
    const order = [...new Set([...prefs.order.filter(key => sectionIds.includes(key)), ...sectionIds])];
    const moved = new Set(units.flat());
    const slots = order.map((id, i) => moved.has(id) ? i : -1).filter(i => i >= 0);
    const next = [...order], flat = units.flat();
    slots.forEach((slot, n) => { next[slot] = flat[n]; });
    return { ...prefs, order: next };
}
export function moveSection(prefs: BrowsePrefs, sectionIds: string[], id: string, delta: -1 | 1): BrowsePrefs {
    const order = [...new Set([...prefs.order.filter(key => sectionIds.includes(key)), ...sectionIds])];
    const index = order.indexOf(id), target = index + delta;
    if (index >= 0 && target >= 0 && target < order.length) [order[index], order[target]] = [order[target], order[index]];
    return { ...prefs, order };
}
