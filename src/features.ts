import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
import { loadLayout, saveLayout } from './layout.ts';

export { FEATURE_KEYS } from './storage/feature-keys.ts';
export interface FeatureChoices { course: boolean; preload: boolean; news: boolean; deadlines: boolean; mensa: boolean; }
/** Widgets whose visibility is the feature switch itself. */
const WIDGET_FEATURES = { 'whats-new': 'news', deadline: 'deadlines', mensa: 'mensa' } as const satisfies Record<string, keyof FeatureChoices>;
export async function readFeatureChoices(): Promise<FeatureChoices> {
    const [course, preload, deadlines, layout] = await Promise.all([store.get(keys.courseView), store.get(keys.preload), store.get(keys.deadlines), loadLayout()]);
    const shown = (id: string) => layout.some(e => e.widgetId === id && !e.hidden);
    return {
        course,
        preload: preload.enabled,
        news: shown('whats-new'),
        deadlines: deadlines && shown('deadline'),
        mensa: shown('mensa'),
    };
}
export async function applyFeatureChoices(choices: FeatureChoices): Promise<boolean> {
    const layout = await loadLayout();
    let changed = false;
    for (const entry of layout) {
        const feature = WIDGET_FEATURES[entry.widgetId as keyof typeof WIDGET_FEATURES];
        if (feature && entry.hidden === choices[feature]) { entry.hidden = !choices[feature]; changed = true; }
    }
    await Promise.all([
        store.set(keys.courseView, choices.course),
        store.set(keys.preload, { enabled: choices.preload }),
        store.set(keys.deadlines, choices.deadlines),
    ]);
    if (changed) await saveLayout(layout);
    return changed;
}
