/** Verified suffixes only. Fill empty entries from live Wicket debug output. */
export const NATIVE_COMPONENTS: Record<string, string[]> = {
    profil: ['optionsProfile', 'profileLink'],
    einstellungen: ['optionsSettings', 'settingsLink'],
    anzeige: ['optionsDisplaySettings'],
    neuigkeiten: ['optionsNews'],
    'persoenlicher kalender': ['optionsCalendar'],
    abmelden: ['logoutLink'],
    benachrichtigungen: ['notificationsLink'],
    // Checked on the live site: these controls have no semantic component name.
    // The gear menu is `optionWrapper-linkList-0-linkListLink` (hide) and
    // `…-linkList-1-linkListLink` (configure / end configure); the add-portlet
    // dialog entries are `addPortletLv-N-addPortletButton-btn`. Both are list
    // indices, which suffix matching deliberately ignores, so these stay empty
    // and callers use DOM position and `.panel-config` state instead.
    configurePortlet: [], hidePortlet: [], addPortletDialog: [],
};

/** Synchronous DOM-only request/response, including in Firefox isolated worlds. */
export function clickNativeComponent(suffixes: string[], container?: Element): boolean {
    if (!suffixes.length || (container && !container.isConnected)) return false;
    const root = document.documentElement;
    const marker = 'data-opal-component-scope';
    const previous = container?.getAttribute(marker);
    const token = `opal-${Math.random().toString(36).slice(2)}`;
    container?.setAttribute(marker, token);
    root.setAttribute('data-opal-component-request', JSON.stringify({ suffixes, scope: container ? token : null }));
    root.removeAttribute('data-opal-component-found');
    try {
        document.dispatchEvent(new Event('opal-component-click'));
        return root.getAttribute('data-opal-component-found') === 'true';
    } finally {
        root.removeAttribute('data-opal-component-request');
        root.removeAttribute('data-opal-component-found');
        if (container) {
            if (previous === null) container.removeAttribute(marker);
            else container.setAttribute(marker, previous ?? '');
        }
    }
}

const language = [...(document.body?.classList ?? [])].find(name => name.startsWith('lang-'))?.slice(5) ?? null;
export const nativeLanguageState = Object.freeze({ language, textFallbacksMayFail: language !== null && language !== 'de' });
if (nativeLanguageState.textFallbacksMayFail) console.warn(`[OPAL Redesign] Native language is ${language}; German text fallbacks may fail.`, nativeLanguageState);
