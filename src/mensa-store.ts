/* ━━ Mensa Store — OpenMensa v2 API ━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Fetches meals from the Studentenwerk Dresden API and caches
 * them for synchronous access by mensa.ts scrape().
 *
 * View state (current date offset + canteen index) is transient:
 * it lives in memory for the page session, not in chrome.storage.
 *
 * API: https://api.studentenwerk-dresden.de/openmensa/v2/
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export interface MensaMeal {
    id: number;
    name: string;
    category: string;
    prices: {
        students: number | null;
        employees: number | null;
        others: number | null;
    };
    notes: string[];
}

export interface MensaSettings {
    favoriteCanteenIds: number[]; // ordered list — user cycles through these
    favoriteNames: string[];      // persisted meal names the user has starred
}

export interface MensaState {
    meals: MensaMeal[];
    date: string;       // ISO date fetched
    dateOffset: number; // 0=today, 1=tomorrow, -1=yesterday
    canteenId: number;
    error: boolean;
}

/* ── Known Dresden Studentenwerk canteens ──────────────────── */
/* IDs verified against https://api.studentenwerk-dresden.de/openmensa/v2/canteens/ */
export const CANTEENS: { id: number; name: string; location: string }[] = [
    { id: 4,  name: 'Alte Mensa',        location: 'Mommsenstraße 13' },
    { id: 6,  name: 'Mensa Matrix',      location: 'Reichenbachstraße 1' },
    { id: 8,  name: 'Mensologie',        location: 'Blasewitzer Straße 84' },
    { id: 9,  name: 'Mensa Siedepunkt',  location: 'Zellescher Weg 17' },
    { id: 13, name: 'Mensa Stimm-Gabel', location: 'Wettiner Platz 13' },
    { id: 29, name: 'Mensa U-Boot',      location: 'George-Bähr-Straße 3' },
    { id: 32, name: 'Mensa Johanna',     location: 'Marschnerstraße 38' },
    { id: 33, name: 'Mensa WUeins',      location: 'Wundtstraße 1' },
    { id: 34, name: 'Mensa Brühl',       location: 'Brühlsche Terrasse 1' },
    { id: 35, name: 'Zeltschlösschen',   location: 'Nürnberger Straße 55' },
];

/* ── Storage ───────────────────────────────────────────────── */

const SETTINGS_KEY = 'opalMensaSettings';

const DEFAULT_SETTINGS: MensaSettings = {
    favoriteCanteenIds: [4],
    favoriteNames: [],
};

let settings: MensaSettings = { ...DEFAULT_SETTINGS };

/* ── View state (transient — resets on page load) ──────────── */

let viewState = {
    canteenIndex: 0,      // index into settings.favoriteCanteenIds
    dateOffset: 0,        // 0=today, 1=tomorrow, -1=yesterday, etc.
    showFavorites: false, // toggle: favorites-across-canteens view
};

/* ── Favorites view cache (cross-canteen) ──────────────────── */

export interface FavViewEntry {
    canteenId: number;
    canteenName: string;
    meals: MensaMeal[];
}

let favViewCache: FavViewEntry[] = [];
let favViewDate = ''; // ISO date the cache is valid for

/**
 * Fetch today's meals for ALL favoriteCanteenIds, filter to starred meals,
 * and store grouped by canteen. Call before rendering the favorites view.
 */
export async function initFavoritesView(): Promise<void> {
    const dateStr = dateForOffset(viewState.dateOffset);
    const favNames = new Set(settings.favoriteNames);

    if (favViewDate === dateStr && favViewCache.length > 0) return; // still valid

    favViewDate = dateStr;

    const results = await Promise.allSettled(
        settings.favoriteCanteenIds.map(async (id) => {
            const url = `https://api.studentenwerk-dresden.de/openmensa/v2/canteens/${id}/days/${dateStr}/meals`;
            const res = await fetch(url);
            if (!res.ok) return { canteenId: id, meals: [] as MensaMeal[] };
            const all = (await res.json()) as MensaMeal[];
            return { canteenId: id, meals: all.filter(m => favNames.has(m.name)) };
        }),
    );

    favViewCache = results
        .filter((r): r is PromiseFulfilledResult<{ canteenId: number; meals: MensaMeal[] }> =>
            r.status === 'fulfilled')
        .map(r => ({
            ...r.value,
            canteenName: CANTEENS.find(c => c.id === r.value.canteenId)?.name ?? `Mensa #${r.value.canteenId}`,
        }))
        .filter(e => e.meals.length > 0);
}

/** Synchronous read — valid after initFavoritesView() has resolved. */
export function getFavoritesViewData(): FavViewEntry[] {
    return favViewCache;
}

/** Step the date offset by delta. Also invalidates the favorites view cache. */
export function setViewDate(delta: number): void {
    viewState.dateOffset += delta;
    favViewDate = ''; // force re-fetch when date changes
}

/** Cycle through the favourite canteen list by delta (±1). Wraps around. */
export function setViewCanteen(delta: number): void {
    const len = settings.favoriteCanteenIds.length;
    if (len < 2) return;
    viewState.canteenIndex = ((viewState.canteenIndex + delta) % len + len) % len;
}

/** Toggle between normal view and the cross-canteen favorites view. */
export function toggleFavoritesView(): void {
    viewState.showFavorites = !viewState.showFavorites;
}

/** Return current transient view state (read-only snapshot). */
export function getViewState(): { canteenIndex: number; dateOffset: number; showFavorites: boolean } {
    return { ...viewState };
}

/* ── Settings persistence ──────────────────────────────────── */

export async function loadMensaSettings(): Promise<MensaSettings> {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([SETTINGS_KEY], (result) => {
                const saved = result[SETTINGS_KEY] as MensaSettings | undefined;
                settings = saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS };
                resolve(settings);
            });
        } else {
            resolve(settings);
        }
    });
}

export async function saveMensaSettings(next: MensaSettings): Promise<void> {
    settings = next;
    // Clamp canteen index if the favorites list got shorter
    viewState.canteenIndex = Math.min(
        viewState.canteenIndex,
        Math.max(0, next.favoriteCanteenIds.length - 1),
    );
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [SETTINGS_KEY]: next }, resolve);
        } else {
            resolve();
        }
    });
}

/** Synchronous read — valid after loadMensaSettings() has resolved. */
export function getMensaSettings(): MensaSettings {
    return settings;
}

/** Toggle a meal name in the favourites list and persist. */
export async function toggleMensaFavorite(mealName: string): Promise<void> {
    const idx = settings.favoriteNames.indexOf(mealName);
    await saveMensaSettings({
        ...settings,
        favoriteNames: idx === -1
            ? [...settings.favoriteNames, mealName]
            : settings.favoriteNames.filter((_, i) => i !== idx),
    });
}

/* ── Meal cache ────────────────────────────────────────────── */

let cache: MensaState = {
    meals: [],
    date: '',
    dateOffset: 0,
    canteenId: DEFAULT_SETTINGS.favoriteCanteenIds[0],
    error: false,
};

function dateForOffset(offset: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
}

/**
 * Fetch meals for the current view (canteen + date offset) and cache.
 * Call with force=true after view state changes.
 */
export async function initMensa(force = false): Promise<void> {
    const canteenId = settings.favoriteCanteenIds[viewState.canteenIndex]
        ?? settings.favoriteCanteenIds[0]
        ?? 4;
    const dateStr = dateForOffset(viewState.dateOffset);

    if (!force && cache.date === dateStr && cache.canteenId === canteenId && !cache.error) return;

    cache = { meals: [], date: dateStr, dateOffset: viewState.dateOffset, canteenId, error: false };

    try {
        const url = `https://api.studentenwerk-dresden.de/openmensa/v2/canteens/${canteenId}/days/${dateStr}/meals`;
        const res = await fetch(url);
        if (res.ok) {
            cache.meals = (await res.json()) as MensaMeal[];
        } else {
            cache.error = true;
        }
    } catch {
        cache.error = true;
    }
}

/** Return the cached state (synchronous — call initMensa first). */
export function getCachedMensaState(): MensaState {
    return cache;
}
