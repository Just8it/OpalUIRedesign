import { normaliseHome } from '../course/home/config.ts';
import { normaliseProgress } from '../course/home/progress.ts';
import type { CourseSnapshot } from '../course/types.ts';
import type { GatewayState } from '../opal/coordinator.ts';
import { initialState } from '../opal/coordinator.ts';
import type { IndexProgress } from '../core/index-progress.ts';
import { sanitizeScrapedDeadlines } from '../core/deadline-store.ts';
import { IMPORT_VALIDATORS } from './import-validation.ts';
import type { MensaSettings } from '../mensa-store.ts';
import { key, family } from './store.ts';
import { getDefaultLayout, migrateNewsLayout } from './layout.ts';
import type { LayoutEntry } from '../types.ts';
import type { ThemeConfig } from '../theme.ts';
import type { CalendarEvent, CalendarSettings } from '../calendar-store.ts';
import { normaliseLayout, normalisePrefs } from '../course/browse/prefs.ts';
import type { LanguageSetting } from '../i18n/core.ts';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const bool = (name: string, fallback: boolean) => key(name, () => fallback, v => typeof v === 'boolean' ? v : fallback);
export type CustomizeRequest = { request: 'edit' | 'appearance'; at: number; tabId?: number } | null;
export const defaultTheme: ThemeConfig = { mode: 'dark', accent: '#2f6fe4' };
export function normaliseTheme(raw: unknown): ThemeConfig {
    const v = object(raw);
    return { mode: v.mode === 'light' || v.mode === 'oled' ? v.mode : 'dark', accent: typeof v.accent === 'string' && /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent : defaultTheme.accent };
}
const validated = <T>(name: keyof typeof IMPORT_VALIDATORS, fallback: () => T) => key<T>(name, fallback, raw => IMPORT_VALIDATORS[name](raw) ? raw as T : fallback());
const timestamp = (name: string) => key(name, () => 0, v => typeof v === 'number' && Number.isFinite(v) ? v : 0);
const timestamps = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(object(v)).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])));
export const keys = {
    gateway: key<GatewayState>('opalGatewayLeasesV1', initialState, v => {
        const o = object(v);
        return Array.isArray(o.jobs) && ['sequence', 'failures', 'retryAt'].every(k => typeof o[k] === 'number') ? v as GatewayState : initialState();
    }),
    progress: key<IndexProgress | null>('opalIndexProgress', () => null, v => {
        const o = object(v);
        return ['running','done','idle'].includes(String(o.status)) ? v as IndexProgress : null;
    }),
    scrapedDeadlines: key('opalScrapedDeadlines', () => [], sanitizeScrapedDeadlines),
    snapshotIndex: key('opalCourseSnapshotIndex', () => ({} as Record<string, number>), timestamps),
    activeIndex: key('opalActiveIndex_v1', () => ({} as Record<string, number>), timestamps),
    catalogIndexed: timestamp('opalCatalogIndexed_v1'),
    prunedAt: timestamp('opalIndexPrunedAt'),
    migrated: timestamp('opalIndexMigratedV2'),
    highlight: key<{title: string; url: string} | undefined>('opalHighlightFile', () => undefined, v => {
        const o = object(v); return typeof o.title === 'string' && typeof o.url === 'string' ? v as {title: string; url: string} : undefined;
    }),
    favoriteSnapshot: key<{href: string; title: string}[]>('opalFavoriteSnapshot', () => [], v => Array.isArray(v) ? v.filter(e => e && typeof e.href === 'string' && typeof e.title === 'string') : []),
    favoriteFingerprint: key<string[]>('opalFavoriteFingerprint', () => [], v => Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : []),
    mensa: key<MensaSettings>('opalMensaSettings', () => ({ favoriteCanteenIds: [4], favoriteNames: [] }), raw => {
        const v = object(raw);
        return { favoriteCanteenIds: Array.isArray(v.favoriteCanteenIds) && v.favoriteCanteenIds.every(Number.isInteger) ? v.favoriteCanteenIds : [4], favoriteNames: Array.isArray(v.favoriteNames) && v.favoriteNames.every(x => typeof x === 'string') ? v.favoriteNames : [] };
    }),
    preload: validated('opalActiveIndexSettings', () => ({ enabled: true })),
    catalog: validated('opalCatalogSettings', () => ({ enabled: false })),
    history: validated<string[]>('opalCmdHistory', () => []),
    onboarding: validated<Record<string, unknown> | null>('opalOnboarding', () => null),
    refreshRequested: key('opalIndexRefreshRequested', () => 0, v => typeof v === 'number' && Number.isFinite(v) ? v : 0),

    /** Short-lived request from the options page, written by the background script: open the dashboard in edit mode ('edit') or with the Darstellung panel ('appearance'). Only the named tab takes it; it expires after two minutes. Never exported. */
    customizeRequested: key<CustomizeRequest>('opalCustomizeRequested', () => null, v => {
        const o = object(v);
        return (o.request === 'edit' || o.request === 'appearance') && typeof o.at === 'number' && Number.isFinite(o.at)
            ? { request: o.request, at: o.at, ...(Number.isInteger(o.tabId) ? { tabId: o.tabId as number } : {}) } : null;
    }),

    enabled: bool('opalRedesignEnabled', true),
    courseView: bool('opalCourseViewEnabled', false),
    deadlines: bool('opalScrapedDeadlinesEnabled', true),
    reopen: bool('opalOnboardingRequested', false),
    explainRanking: bool('opalExplainRanking', false),
    downloadFiles: bool('opalDownloadFiles', false),
    /** Interface language: 'auto' follows the browser (German for de-*, otherwise English). */
    language: key<LanguageSetting>('opalLanguage', () => 'auto', v => v === 'de' || v === 'en' || v === 'auto' ? v : 'auto'),
    theme: key('opalTheme_v1', () => ({ ...defaultTheme }), normaliseTheme),
    layout: key<LayoutEntry[]>('opalDashboardLayout_v4', getDefaultLayout, raw => {
        if (!Array.isArray(raw) || !raw.length || !raw.every(e => e && typeof e.widgetId === 'string' && ['x','y','w','h'].every(k => Number.isFinite(e[k])) && typeof e.hidden === 'boolean')) return getDefaultLayout();
        return migrateNewsLayout(raw);
    }),
    courseLayout: key('opalCourseLayout', () => normaliseLayout(undefined), normaliseLayout),
    calendarEvents: key<CalendarEvent[]>('opalCalendarEvents_v1', () => [], raw => Array.isArray(raw) ? raw.filter(e => e && ['id','title','start','end'].every(k => typeof e[k] === 'string')) : []),
    calendarSettings: key<CalendarSettings>('opalCalendarSettings_v1', () => ({ showFavoritesAsEvents: false, matchThreshold: 0.4 }), raw => {
        const v = object(raw);
        return { showFavoritesAsEvents: v.showFavoritesAsEvents === true, matchThreshold: typeof v.matchThreshold === 'number' && v.matchThreshold >= 0 && v.matchThreshold <= 1 ? v.matchThreshold : 0.4 };
    }),
    newsFilter: key('opalNewsFilter', () => 'all', v => typeof v === 'string' ? v : 'all'),
    whatsNewRevealed: key<boolean | undefined>('opalWhatsNewRevealed', () => undefined, v => typeof v === 'boolean' ? v : undefined),
    whatsNew: key('opalWhatsNewSettings', () => ({ days: 14, limit: 12 }), raw => {
        const v = object(raw);
        return { days: [3,7,14,30].includes(Number(v.days)) ? Number(v.days) : 14, limit: Number.isInteger(v.limit) && Number(v.limit) >= 1 && Number(v.limit) <= 100 ? Number(v.limit) : 12 };
    }),
};
export const families = {
    home: family<ReturnType<typeof normaliseHome> | undefined>('opalCourseHome_', () => undefined, normaliseHome),
    courseProgress: family('opalCourseProgress_', () => normaliseProgress(undefined), normaliseProgress),
    snapshot: family<CourseSnapshot | undefined>('opalCourseSnapshot2_', () => undefined, v => {
        const o = object(v); return Array.isArray(o.sections) ? v as CourseSnapshot : undefined;
    }),
    legacySnapshot: family<CourseSnapshot | undefined>('opalCourseSnapshot_', () => undefined, v => {
        const o = object(v); return Array.isArray(o.sections) ? v as CourseSnapshot : undefined;
    }),
    homeHintDismissed: family('opalCourseHomeHintDismissed_', () => false, v => v === true),
    collapsed: family<string[]>('opalCourseCollapsed_', () => [], v => Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : []),
    prefs: family('opalCoursePrefs_', () => normalisePrefs(undefined, []), raw => {
        const v = object(raw);
        const ids = [...new Set(['order','hidden','collapsed','open'].flatMap(k => Array.isArray(v[k]) ? (v[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []))];
        if (typeof v.selected === 'string' && /^(sec|grp|area):/.test(v.selected)) ids.push(v.selected.slice(v.selected.indexOf(':') + 1));
        return normalisePrefs(raw, ids);
    }),
    announcementSeen: family('opalCourseAnnSeen_', () => '', v => typeof v === 'string' ? v : ''),
    opened: family<Record<string, number>>('opalCourseOpened_', () => ({}), v => Object.fromEntries(Object.entries(object(v)).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))),
};
