import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
import { loadLayout, saveLayout } from './layout.ts';

export { FEATURE_KEYS } from './storage/feature-keys.ts';
export interface FeatureChoices { course: boolean; preload: boolean; news: boolean; deadlines: boolean; }
export async function readFeatureChoices(): Promise<FeatureChoices> {
    const [course, preload, deadlines, layout] = await Promise.all([store.get(keys.courseView), store.get(keys.preload), store.get(keys.deadlines), loadLayout()]);
    return {
        course,
        preload: preload.enabled,
        news: layout.some(e => e.widgetId === 'whats-new' && !e.hidden),
        deadlines: deadlines && layout.some(e => e.widgetId === 'deadline' && !e.hidden),
    };
}
export async function applyFeatureChoices(choices: FeatureChoices): Promise<boolean> {
    const layout = await loadLayout();
    let changed = false;
    for (const entry of layout) {
        const visible = entry.widgetId === 'whats-new' ? choices.news : entry.widgetId === 'deadline' ? choices.deadlines : undefined;
        if (visible !== undefined && entry.hidden === visible) { entry.hidden = !visible; changed = true; }
    }
    await Promise.all([
        store.set(keys.courseView, choices.course),
        store.set(keys.preload, { enabled: choices.preload }),
        store.set(keys.deadlines, choices.deadlines),
    ]);
    if (changed) await saveLayout(layout);
    return changed;
}
