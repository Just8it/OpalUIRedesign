import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
import { indexCourseCatalog, isCatalogStale, indexUpcomingCourses, refreshFavoriteIndex } from './indexer';
import { CLAIM_TYPE, type ClaimJob } from './core/claims';

/** Asks the background script, the one serializer across all open OPAL tabs, whether this tab runs the job. */
function claimJob(job: ClaimJob, token?: number | string, release = false): Promise<boolean> {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({ type: CLAIM_TYPE, job, token, release }, reply => {
                void chrome.runtime.lastError;
                resolve(reply?.granted === true);
            });
        } catch { resolve(false); }
    });
}

/**
 * Work that the options page (or the setup) asks for through storage. Every open OPAL tab sees the same
 * change at once, so each job is claimed through the background script first and runs in exactly one tab:
 *  - catalog switched on and the catalog is stale: index the public catalog
 *  - preload switched on: index the favourite courses that matter today
 *  - "Jetzt aktualisieren": the request key holds the time of the request; the tab that wins the claim
 *    resets it to 0 and refreshes the favourites and, when the catalog is on, the catalog. The options
 *    page watches the key: when it drops back to 0 a tab has taken the request; if not, the request stays
 *    pending and the next OPAL page that loads picks it up.
 */
export function startIndexRequestWatchers(): void {
    let catalogOn: boolean | undefined;
    let preloadOn: boolean | undefined;
    void Promise.all([store.get(keys.catalog), store.get(keys.preload)]).then(([catalog, preload]) => {
        catalogOn ??= catalog.enabled;
        preloadOn ??= preload.enabled;
    });
    store.watch(keys.catalog, async value => {
        const was = catalogOn;
        catalogOn = value.enabled;
        if (!value.enabled || was === true || !await claimJob('catalog')) return;
        try { if (await isCatalogStale()) await indexCourseCatalog(); }
        catch (error) { console.warn(error); }
        finally { void claimJob('catalog', undefined, true); }
    });
    store.watch(keys.preload, async value => {
        const was = preloadOn;
        preloadOn = value.enabled;
        if (!value.enabled || was === true || !await claimJob('preload')) return;
        try { await indexUpcomingCourses(); }
        catch (error) { console.warn(error); }
        finally { void claimJob('preload', undefined, true); }
    });

    const claim = async (requested: number) => {
        if (!await claimJob('refresh', requested)) return;
        await store.update(keys.refreshRequested, value => value === requested ? 0 : value);
        try {
            await refreshFavoriteIndex();
            if ((await store.get(keys.catalog)).enabled) await indexCourseCatalog(true);
        } catch (error) { console.warn('[OPAL] Requested refresh failed:', error); }
    };
    store.watch(keys.refreshRequested, value => { if (value > 0) void claim(value); });
    void store.get(keys.refreshRequested).then(value => { if (value > 0) void claim(value); });
}
