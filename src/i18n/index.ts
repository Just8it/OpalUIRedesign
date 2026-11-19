import { store } from '../storage/store';
import { keys } from '../storage/registry';
import { resolveLocale, setLocale, locale, type Locale } from './core';

export * from './core';

let watching = false;
/**
 * Applies the saved language before the first render; call and await it at every entry point
 * (content script, options page, popup, background).
 * `live: false` (OPAL tabs) keeps the language for the page's lifetime: those surfaces never redraw
 * as a whole, so switching mid-session would mix languages. They pick the change up on the next load.
 * Otherwise later changes reach `onLocaleChange` listeners.
 */
export async function initLocale(options: { live?: boolean } = {}): Promise<Locale> {
    try { setLocale(resolveLocale(await store.get(keys.language))); } catch { /* keep the detected language */ }
    if (options.live !== false && !watching) {
        watching = true;
        try { store.watch(keys.language, value => setLocale(resolveLocale(value))); } catch { /* no storage events here */ }
    }
    return locale();
}
