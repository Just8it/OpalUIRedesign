import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
/* ━━ Mensa Store — OpenMensa v2 API ━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Fetches meals from the Studentenwerk Dresden API and caches
 * them for synchronous access by mensa.ts scrape().
 *
 * View state (current date offset + canteen index) is transient:
 * it lives in memory for the page session, not in storage.
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
    { id: 1,  name: 'Neue Mensa',        location: 'Bergstraße 51' },
    { id: 4,  name: 'Alte Mensa',        location: 'Mommsenstraße 13' },
    { id: 6,  name: 'Mensa Matrix',      location: 'Reichenbachstraße 1' },
    { id: 8,  name: 'Mensologie',        location: 'Blasewitzer Straße 84' },
    { id: 9,  name: 'Mensa Siedepunkt',  location: 'Zellescher Weg 17' },
    { id: 13, name: 'Mensa Stimm-Gabel', location: 'Wettiner Platz 13' },
    { id: 29, name: 'Mensa U-Boot',      location: 'George-Bähr-Straße 3' },
    { id: 32, name: 'Mensa Johanna',     location: 'Marschnerstraße 38' },
    { id: 33, name: 'Mensa WUeins',      location: 'Wundtstraße 1' },
    { id: 34, name: 'Mensa Brühl',       location: 'Brühlsche Terrasse 1' },
];

/* ── Storage ───────────────────────────────────────────────── */



const DEFAULT_SETTINGS = keys.mensa.default();

let settings: MensaSettings = { ...DEFAULT_SETTINGS };

/* ── View state (transient — resets on page load) ──────────── */

const viewState = {
    canteenIndex: 0,      // index into settings.favoriteCanteenIds
    dateOffset: 0,        // 0=today, 1=tomorrow, -1=yesterday, etc.
    showFavorites: false, // toggle: favorites-across-canteens view
};

/* ── Favorites view cache (cross-canteen) ──────────────────── */

export interface FavViewEntry {
    canteenId: number;
    meals: MensaMeal[];
}

/** Data shape produced by mensaWidget.scrape() and consumed by mensaWidget.render(). */
export interface MensaWidgetData {
    state: MensaState;
    settings: MensaSettings;
    viewState: { canteenIndex: number; dateOffset: number; showFavorites: boolean };
    favData: FavViewEntry[];
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

    favViewDate = '';
    favViewCache = [];

    const results = await Promise.allSettled(
        settings.favoriteCanteenIds.map(async (id) => {
            const all = await fetchMeals(id, dateStr);
            return { canteenId: id, meals: all.filter(m => favNames.has(m.name)) };
        }),
    );

    if (results.every(r => r.status === 'fulfilled')) favViewDate = dateStr;
    favViewCache = results
        .flatMap(r => r.status === 'fulfilled' && r.value.meals.length ? [r.value] : []);
}

/** Synchronous read — valid after initFavoritesView() has resolved. */
export function getFavoritesViewData(): FavViewEntry[] {
    return favViewDate === dateForOffset(viewState.dateOffset) ? favViewCache : [];
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
    settings = await store.get(keys.mensa);
    return settings;
}

export async function saveMensaSettings(next: MensaSettings): Promise<void> {
    settings = next;
    favViewDate = '';
    // Clamp canteen index if the favorites list got shorter
    viewState.canteenIndex = Math.min(
        viewState.canteenIndex,
        Math.max(0, next.favoriteCanteenIds.length - 1),
    );
    await store.set(keys.mensa, next);
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

export function dateForOffset(offset: number, now = new Date()): string {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function mensaCacheKey(canteenId: number, date: string): string {
    return `${canteenId}:${date}`;
}
const mealsCache = new Map<string, MensaMeal[]>();

/** The API has named the price groups both in English (students, employees,
 *  others) and in German (Studierende, Bedienstete); accept either. A malformed
 *  meal is dropped on its own instead of failing the whole day. */
export function normaliseMeal(value: unknown): MensaMeal | null {
    const m = value as Record<string, unknown> | null;
    if (!m || typeof m.id !== 'number' || typeof m.name !== 'string') return null;
    const p = (m.prices && typeof m.prices === 'object' ? m.prices : {}) as Record<string, unknown>;
    const price = (...keys: string[]): number | null => {
        for (const k of keys) if (typeof p[k] === 'number') return p[k] as number;
        return null;
    };
    return {
        id: m.id,
        name: m.name,
        category: typeof m.category === 'string' ? m.category : '',
        prices: {
            students: price('students', 'Studierende'),
            employees: price('employees', 'Bedienstete'),
            others: price('others', 'Gäste', 'Gaeste', 'Schüler'),
        },
        notes: Array.isArray(m.notes) ? m.notes.filter((n): n is string => typeof n === 'string') : [],
    };
}

async function fetchMeals(canteenId: number, date: string): Promise<MensaMeal[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(`https://api.studentenwerk-dresden.de/openmensa/v2/canteens/${canteenId}/days/${date}/meals`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw: unknown = await res.json();
        if (!Array.isArray(raw)) throw new Error('Invalid meal data');
        const meals = raw.map(normaliseMeal).filter((m): m is MensaMeal => m !== null);
        if (raw.length && !meals.length) throw new Error('Invalid meal data');
        mealsCache.set(mensaCacheKey(canteenId, date), meals);
        return meals;
    } finally {
        clearTimeout(timer);
    }
}
export async function initMensa(force = false): Promise<void> {
    const canteenId = settings.favoriteCanteenIds[viewState.canteenIndex] ?? settings.favoriteCanteenIds[0] ?? 4;
    const dateOffset = viewState.dateOffset;
    const date = dateForOffset(dateOffset);
    const key = mensaCacheKey(canteenId, date);
    const previous = mealsCache.get(key);
    let next: MensaState;
    try {
        const meals = !force && previous ? previous : await fetchMeals(canteenId, date);
        next = { meals, date, dateOffset, canteenId, error: false };
    } catch {
        next = { meals: mealsCache.get(key) || [], date, dateOffset, canteenId, error: true };
    }
    if (dateOffset === viewState.dateOffset && canteenId === (settings.favoriteCanteenIds[viewState.canteenIndex] ?? 4)) cache = next;
}

/** Return the cached state (synchronous — call initMensa first). */
export function getCachedMensaState(): MensaState {
    const date = dateForOffset(viewState.dateOffset);
    const canteenId = settings.favoriteCanteenIds[viewState.canteenIndex] ?? 4;
    return cache.date === date && cache.canteenId === canteenId ? cache
        : { meals: [], date, dateOffset: viewState.dateOffset, canteenId, error: false };
}
