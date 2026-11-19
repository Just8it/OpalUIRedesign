import type { LayoutEntry } from '../types.ts';
/** Default widget layout — GridStack grid positions (12 columns) */
export function getDefaultLayout(): LayoutEntry[] {
    const entries: LayoutEntry[] = [
        { widgetId: 'favorites', x: 0, y: 0, w: 8, h: 5, hidden: false },
        { widgetId: 'courses', x: 8, y: 0, w: 4, h: 5, hidden: false },
        { widgetId: 'calendar', x: 0, y: 5, w: 4, h: 7, hidden: false },
        { widgetId: 'neuigkeiten', x: 4, y: 5, w: 4, h: 7, hidden: false },
        { widgetId: 'quickaccess', x: 8, y: 5, w: 4, h: 3, hidden: false },
        { widgetId: 'mensa', x: 8, y: 8, w: 4, h: 4, hidden: false },
        { widgetId: 'performance', x: 0, y: 14, w: 4, h: 3, hidden: true },
        { widgetId: 'stats', x: 4, y: 14, w: 4, h: 3, hidden: true },
        { widgetId: 'groups', x: 8, y: 14, w: 4, h: 3, hidden: true },
        { widgetId: 'recent', x: 0, y: 17, w: 4, h: 3, hidden: true },
        { widgetId: 'institution', x: 4, y: 17, w: 4, h: 3, hidden: true },
        { widgetId: 'toolbox', x: 8, y: 17, w: 4, h: 3, hidden: true },
        { widgetId: 'whats-new', x: 4, y: 20, w: 4, h: 4, hidden: true },
        { widgetId: 'deadline', x: 8, y: 20, w: 4, h: 4, hidden: true },
    ];
    // No containers found at all means detection failed (not a user without portlets): keep the full default.
    return entries;
}

export function migrateNewsLayout(layout: LayoutEntry[]): LayoutEntry[] {
    const oldIds = new Set(['news', 'aktuelles', 'announcements']);
    const old = layout.filter(e => oldIds.has(e.widgetId));
    const anchor = old.find(e => !e.hidden) ?? old[0];
    if (!anchor) return layout.map(e => ({ ...e }));
    const already = layout.some(e => e.widgetId === 'neuigkeiten');
    return layout.flatMap(e => oldIds.has(e.widgetId)
        ? (!already && e === anchor ? [{ ...e, widgetId: 'neuigkeiten', hidden: old.every(o => o.hidden) }] : [])
        : [{ ...e }]);
}
