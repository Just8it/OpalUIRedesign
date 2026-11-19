import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import { isStableNewFileUrl } from './whats-new-helpers';
import { getNewFiles, getNode, getIndexStats } from '../core/search-engine';
import type { SearchResult } from '../core/search/types.ts';
export let whatsNewSettings = keys.whatsNew.default();
export let newFiles: (SearchResult & { href: string })[] = [];
export let pending = false;
export let hasFileIndex = false;
export let loaded = false;
let fetchedAt = 0;
export let newFilesError = false;
export async function loadWhatsNewSettings(): Promise<void> {
    whatsNewSettings = await store.get(keys.whatsNew);
}
export function refreshNewFiles(refresh: () => void, force = false): void {
    if (pending || (!force && Date.now() - fetchedAt < 30000)) return;
    pending = true;
    void (async () => {
        try {
            await loadWhatsNewSettings();
            hasFileIndex = (await getIndexStats()).files > 0;
            const results = await getNewFiles(whatsNewSettings.days, whatsNewSettings.limit);
            newFiles = await Promise.all(results.map(async item => {
                const parent = !isStableNewFileUrl(item.node.url) && item.node.parentId ? await getNode(item.node.parentId) : null;
                return { ...item, href: isStableNewFileUrl(item.node.url) ? item.node.url : parent?.url || item.node.url };
            }));
            newFilesError = false;
        } catch { newFilesError = true; }
        finally { loaded = true; pending = false; fetchedAt = Date.now(); refresh(); }
    })();
}
export async function saveWhatsNewSettings(days: number, limit: number): Promise<void> {
    whatsNewSettings = { days, limit };
    await store.set(keys.whatsNew, whatsNewSettings);
    fetchedAt = 0;
}
