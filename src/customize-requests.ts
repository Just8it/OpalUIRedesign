import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';

/** The options page asks the background script to open the dashboard in edit mode; the request names the tab
 *  that may take it, so only that one tab enters edit mode and the others ignore the key. */
export const CUSTOMIZE_TYPE = 'opal-customize';
export const CUSTOMIZE_TAKE_TYPE = 'opal-customize-take';
export const CUSTOMIZE_MAX_AGE_MS = 2 * 60_000;
export type CustomizeKind = 'edit' | 'appearance';
type OpenKind = CustomizeKind | 'open';

/** Decides whether a tab may take the stored request. Pure, so the rule is testable. */
export function takeableRequest(stored: { request: CustomizeKind; at: number; tabId?: number } | null, tabId: number | undefined, now: number): CustomizeKind | '' {
    if (!stored || now - stored.at > CUSTOMIZE_MAX_AGE_MS || now < stored.at - 5000) return '';
    if (stored.tabId !== undefined && stored.tabId !== tabId) return '';
    return stored.request;
}

/** Content script side: asks the background whether this tab holds the request. */
export function takeCustomizeRequest(): Promise<CustomizeKind | ''> {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({ type: CUSTOMIZE_TAKE_TYPE }, reply => {
                void chrome.runtime.lastError;
                resolve(reply?.request === 'edit' || reply?.request === 'appearance' ? reply.request : '');
            });
        } catch { resolve(''); }
    });
}

const HOME_URL = 'https://bildungsportal.sachsen.de/opal/home';
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>): Promise<T> => { const run = chain.then(task, task); chain = run.catch(() => undefined); return run; };

function findDashboardTab(): Promise<chrome.tabs.Tab | undefined> {
    return new Promise(resolve => chrome.tabs.query({ url: [HOME_URL + '*', 'https://bildungsportal.sachsen.de/opal/', 'https://bildungsportal.sachsen.de/opal'] }, tabs => {
        void chrome.runtime.lastError;
        resolve(tabs?.find(tab => tab.active) ?? tabs?.[0]);
    }));
}

/** 'open' only opens or focuses the start page and leaves nothing for it to take. */
async function openDashboard(request: OpenKind): Promise<boolean> {
    if (!await store.get(keys.enabled)) return false;
    const tab = await findDashboardTab();
    if (tab?.id !== undefined) {
        if (request !== 'open') await store.set(keys.customizeRequested, { request, at: Date.now(), tabId: tab.id });
        chrome.tabs.update(tab.id, { active: true }, () => { void chrome.runtime.lastError; });
        if (tab.windowId !== undefined) chrome.windows.update(tab.windowId, { focused: true }, () => { void chrome.runtime.lastError; });
        return true;
    }
    const created = await new Promise<chrome.tabs.Tab | undefined>(resolve => chrome.tabs.create({ url: HOME_URL }, tab => { void chrome.runtime.lastError; resolve(tab); }));
    if (created?.id === undefined) return false;
    if (request !== 'open') await store.set(keys.customizeRequested, { request, at: Date.now(), tabId: created.id });
    return true;
}

export function installCustomizeRequests(): void {
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (sender.id !== chrome.runtime.id) return false;
        if (message?.type === CUSTOMIZE_TYPE && (message.request === 'edit' || message.request === 'appearance' || message.request === 'open') && sender.url?.startsWith(chrome.runtime.getURL(''))) {
            serial(() => openDashboard(message.request)).then(ok => respond({ ok }), () => respond({ ok: false }));
            return true;
        }
        if (message?.type === CUSTOMIZE_TAKE_TYPE && sender.tab?.id !== undefined && !sender.frameId) {
            const tabId = sender.tab.id;
            serial(async () => {
                const stored = await store.get(keys.customizeRequested);
                const request = takeableRequest(stored, tabId, Date.now());
                if (stored && (request || Date.now() - stored.at > CUSTOMIZE_MAX_AGE_MS)) await store.set(keys.customizeRequested, null);
                return request;
            }).then(request => respond({ request }), () => respond({ request: '' }));
            return true;
        }
        return false;
    });
}
