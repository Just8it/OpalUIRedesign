/* ━━ Layout Manager ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { LayoutEntry } from './types';

const STORAGE_KEY = 'opalDashboardLayout_v4';

/** Default widget layout — GridStack grid positions (12 columns) */
export function getDefaultLayout(): LayoutEntry[] {
    return [
        { widgetId: 'favorites', x: 0, y: 0, w: 8, h: 3, hidden: false },
        { widgetId: 'calendar', x: 8, y: 0, w: 4, h: 5, hidden: false },
        { widgetId: 'courses', x: 0, y: 3, w: 8, h: 3, hidden: false },
        { widgetId: 'news', x: 8, y: 3, w: 4, h: 3, hidden: false },
        { widgetId: 'performance', x: 0, y: 6, w: 4, h: 3, hidden: false },
        { widgetId: 'quickaccess', x: 4, y: 6, w: 4, h: 3, hidden: false },
        { widgetId: 'stats', x: 8, y: 6, w: 4, h: 3, hidden: false },
        { widgetId: 'groups', x: 0, y: 9, w: 4, h: 3, hidden: true },
        { widgetId: 'recent', x: 4, y: 9, w: 4, h: 3, hidden: true },
        { widgetId: 'institution', x: 8, y: 9, w: 4, h: 3, hidden: true },
        { widgetId: 'aktuelles', x: 0, y: 12, w: 4, h: 3, hidden: true },
        { widgetId: 'toolbox', x: 4, y: 12, w: 4, h: 3, hidden: true },
        { widgetId: 'mensa', x: 8, y: 12, w: 4, h: 4, hidden: true },
        { widgetId: 'deadline', x: 0, y: 15, w: 4, h: 4, hidden: true },
        { widgetId: 'announcements', x: 4, y: 15, w: 4, h: 4, hidden: true },
    ];
}

/** Load layout from chrome.storage.local, fallback to default.
 *  Merges any new widgets from the default into an existing saved layout
 *  so users don't lose positions when new widgets are added. */
export async function loadLayout(): Promise<LayoutEntry[]> {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([STORAGE_KEY], (result) => {
                const saved = result[STORAGE_KEY] as LayoutEntry[] | undefined;
                if (!saved || saved.length === 0) {
                    resolve(getDefaultLayout());
                    return;
                }
                // Append any widgets added since the layout was saved
                const savedIds = new Set(saved.map(e => e.widgetId));
                const missing = getDefaultLayout().filter(d => !savedIds.has(d.widgetId));
                resolve(missing.length > 0 ? [...saved, ...missing] : saved);
            });
        } else {
            resolve(getDefaultLayout());
        }
    });
}

/** Persist layout to chrome.storage.local */
export async function saveLayout(layout: LayoutEntry[]): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [STORAGE_KEY]: layout }, resolve);
        } else {
            resolve();
        }
    });
}

/** Toggle a widget's hidden state in the layout */
export function toggleWidgetVisibility(layout: LayoutEntry[], widgetId: string): LayoutEntry[] {
    return layout.map(entry =>
        entry.widgetId === widgetId
            ? { ...entry, hidden: !entry.hidden }
            : entry
    );
}
