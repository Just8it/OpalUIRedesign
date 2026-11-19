import { t, type PageMessageKey } from './i18n/messages/pages.ts';

/** Open options from content scripts in Chrome and Firefox, including stale tabs. */
function runtimeApi(): { runtime: typeof chrome.runtime; promises: boolean } {
    const browserApi = (globalThis as typeof globalThis & { browser?: { runtime: typeof chrome.runtime } }).browser;
    if (browserApi) return { runtime: browserApi.runtime, promises: true };
    return { runtime: chrome.runtime, promises: false };
}

function hint(message: PageMessageKey): void {
    document.getElementById('opal-options-hint')?.remove();
    const el = document.createElement('div');
    el.id = 'opal-options-hint';
    el.setAttribute('role', 'alert');
    el.dataset.i18n = message;
    el.textContent = t(message);
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#222;color:#fff;padding:12px 20px;border-radius:8px;max-width:90vw';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 8000);
}

export async function openExtensionOptions(): Promise<void> {
    let api: ReturnType<typeof runtimeApi>;
    try {
        api = runtimeApi();
        if (!api.runtime?.id) throw new Error('Extension context invalidated');
    } catch {
        hint('optionsContextReloaded');
        return;
    }
    const { runtime, promises } = api;
    try {
        if (promises) await runtime.openOptionsPage();
        else await new Promise<void>((resolve, reject) => {
            const result: unknown = runtime.openOptionsPage(() => {
                const error = runtime.lastError;
                if (error) reject(new Error(error.message)); else resolve();
            });
            // Also handle implementations returning a promise with a callback.
            if (result) Promise.resolve(result).then(() => resolve(), reject);
        });
        return;
    } catch { /* Content-script API unavailable: ask the background context. */ }
    try {
        if (!runtime.id) throw new Error('Extension context invalidated');
        const message = { type: 'opal-open-options' };
        const response = promises ? await runtime.sendMessage(message)
            : await new Promise<{ ok?: boolean }>((resolve, reject) => {
                runtime.sendMessage(message, reply => {
                    const error = runtime.lastError;
                    if (error) reject(new Error(error.message)); else resolve(reply);
                });
            });
        if (!response?.ok) throw new Error('Options could not be opened');
    } catch {
        hint('optionsOpenFailed');
    }
}
