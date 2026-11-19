export const IMPORT_VALIDATORS = Object.freeze({
    opalRedesignEnabled: (v: unknown) => typeof v === 'boolean',
    opalLanguage: (v: unknown) => v === 'auto' || v === 'de' || v === 'en',
    opalDashboardLayout_v4: (v: unknown) => Array.isArray(v) && v.every(e => object(e) && typeof e.widgetId === 'string' && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(e[k])) && typeof e.hidden === 'boolean'),
    opalTheme_v1: (v: unknown) => object(v) && ['dark', 'light', 'oled'].includes(String(v.mode)) && typeof v.accent === 'string' && /^#[0-9a-f]{6}$/i.test(v.accent),
    opalCalendarEvents_v1: (v: unknown) => Array.isArray(v) && v.every(e => object(e) && ['id', 'title', 'start', 'end'].every(k => typeof e[k] === 'string') && Number.isFinite(Date.parse(String(e.start))) && Number.isFinite(Date.parse(String(e.end))) && (e.exdates === undefined || strings(e.exdates)) && (e.timeZone === undefined || validZone(e.timeZone)) && ['location', 'description', 'color', 'rrule', 'sourceFile', 'createdAt'].every(k => e[k] === undefined || typeof e[k] === 'string') && ['allDay', 'isDeadline'].every(k => e[k] === undefined || typeof e[k] === 'boolean')),
    opalCalendarSettings_v1: (v: unknown) => object(v) && typeof v.showFavoritesAsEvents === 'boolean' && Number.isFinite(v.matchThreshold) && typeof v.matchThreshold === 'number' && v.matchThreshold >= 0 && v.matchThreshold <= 1,
    opalMensaSettings: (v: unknown) => object(v) && Array.isArray(v.favoriteCanteenIds) && v.favoriteCanteenIds.every(Number.isInteger) && strings(v.favoriteNames),
    opalActiveIndexSettings: (v: unknown) => object(v) && typeof v.enabled === 'boolean',
    opalCmdHistory: strings,
    opalCourseViewEnabled: (v: unknown) => typeof v === 'boolean',
    opalCourseLayout: (v: unknown) => object(v) && ['compact','normal'].includes(String(v.density)) && (object(v.columns) && ['type','size','modified'].every(k => typeof (v.columns as Record<string, unknown>)[k] === 'boolean') && typeof v.sidebar === 'boolean' || ['auto',1,2,3].includes(v.columns as string | number) && object(v.blocks) && ['recent','latest','announcements','rail','more','scope'].every(k => typeof (v.blocks as Record<string, unknown>)[k] === 'boolean')),
    opalScrapedDeadlinesEnabled: (v: unknown) => typeof v === 'boolean',
    opalOnboarding: (v: unknown) => object(v) && (v.version === 1 || v.version === 2) && (Number.isFinite(v.completedAt) || Number.isFinite(v.skippedAt)) && object(v.choices) && ['course','preload','news','deadlines'].every(k => typeof (v.choices as Record<string, unknown>)[k] === 'boolean')
        && (v.accepted === undefined || object(v.accepted) && typeof v.accepted.version === 'string' && Number.isFinite(v.accepted.at)),
    opalOnboardingRequested: (v: unknown) => typeof v === 'boolean',
    opalWhatsNewRevealed: (v: unknown) => typeof v === 'boolean',
    opalWhatsNewSettings: (v: unknown) => object(v) && [3,7,14,30].includes(Number(v.days)) && Number.isInteger(v.limit) && typeof v.limit === 'number' && v.limit >= 1 && v.limit <= 100,
    opalNewsFilter: (v: unknown) => typeof v === 'string',
    opalExplainRanking: (v: unknown) => typeof v === 'boolean',
    opalDownloadFiles: (v: unknown) => typeof v === 'boolean',
});
function object(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function strings(v: unknown): v is string[] { return Array.isArray(v) && v.every(e => typeof e === 'string'); }
function validZone(v: unknown) {
    try { if (typeof v !== 'string') return false; new Intl.DateTimeFormat('de', { timeZone: v }); return true; }
    catch { return false; }
}
