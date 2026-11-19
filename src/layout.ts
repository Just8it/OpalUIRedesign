import { getAvailablePortletOrders, isWidgetAvailable } from './widget-availability.ts';
/* ━━ Layout Manager ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { LayoutEntry } from './types';

import { getDefaultLayout as defaults } from './storage/layout.ts';
export { migrateNewsLayout } from './storage/layout.ts';
import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';

/** Load layout from storage.local, fallback to default.
 *  Merges any new widgets from the default into an existing saved layout
 *  so users don't lose positions when new widgets are added. */
export async function loadLayout(availableOrders?: ReadonlySet<string>): Promise<LayoutEntry[]> {
    // Onboarding/feature choices also load layouts from the dashboard.
    if (!availableOrders && typeof document !== 'undefined'
        && document.querySelector('[data-portlet-order], #opal-modern-ui')) {
        availableOrders = getAvailablePortletOrders();
    }
    const saved = await store.get({ ...keys.layout, default: () => getDefaultLayout(availableOrders) });
    if (await store.get(keys.whatsNewRevealed) === undefined) {
        const existing = await store.get({ ...keys.layout, default: () => [] });
        await store.set(keys.whatsNewRevealed, migrateWhatsNewVisibility(existing));
    }
    const savedIds = new Set(saved.map(e => e.widgetId));
    return [...saved, ...getDefaultLayout(availableOrders).filter(d => !savedIds.has(d.widgetId))];
}
export async function saveLayout(layout: LayoutEntry[]): Promise<void> {
    // Showing, hiding or removing the widget is the user's call; after that it is never revealed again.
    const before = (await store.get({ ...keys.layout, default: () => [] })).find(e => e.widgetId === 'whats-new');
    const after = layout.find(e => e.widgetId === 'whats-new');
    if (before && (!after || before.hidden !== after.hidden)) await store.set(keys.whatsNewRevealed, true);
    await store.set(keys.layout, layout);
}

/** Toggle a widget's hidden state in the layout */
export function toggleWidgetVisibility(layout: LayoutEntry[], widgetId: string): LayoutEntry[] {
    return layout.map(entry =>
        entry.widgetId === widgetId
            ? { ...entry, hidden: !entry.hidden }
            : entry
    );
}


export function getDefaultLayout(availableOrders?: ReadonlySet<string>): LayoutEntry[] {
    return defaults().filter(e => !availableOrders?.size || isWidgetAvailable(e.widgetId, availableOrders));
}

export function revealWhatsNew(layout: LayoutEntry[], handled: boolean, hasItems: boolean): LayoutEntry[] {
    if (handled || !hasItems) return layout;
    const bottom = Math.max(0, ...layout.filter(e => !e.hidden).map(e => e.y + e.h));
    return layout.map(e => e.widgetId === 'whats-new' ? { ...e, hidden: false, x: 0, y: bottom } : e);
}

/** Saved layouts from before the flag cannot tell a default hide from a deliberate one. The widget
 *  shipped hidden by default, so a hidden entry is almost always the default: it is revealed once
 *  (hiding it again is final). Already visible or removed means the user decided. */
export function migrateWhatsNewVisibility(saved: readonly LayoutEntry[]): boolean {
    const entry = saved.find(e => e.widgetId === 'whats-new');
    if (!saved.length) return false;
    return !entry || !entry.hidden;
}
