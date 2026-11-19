/** The only extension-storage boundary. Resolve lazily for content scripts and tests. */
export function extensionStorage(): typeof chrome.storage | undefined {
    const browser = (globalThis as typeof globalThis & { browser?: { storage: typeof chrome.storage } }).browser;
    return browser?.storage ?? (typeof chrome !== 'undefined' ? chrome.storage : undefined);
}
export const storageAvailable = () => !!extensionStorage()?.local;
