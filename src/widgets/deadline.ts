import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
/* ━━ Deadline Countdown Widget ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Shows upcoming deadline-flagged calendar events and deadlines found on
 * OPAL pages (core/deadline-store.ts) as plain rows with the time left in
 * words; urgency only tints that text.
 * Reloads automatically when either changes in storage.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { formatDate } from '../i18n/core.ts';
import { t } from '../i18n/messages/widgets.ts';
import type { Widget } from '../types.ts';
import { escapeHtml, escapeAttr, safeHref } from '../utils';
import { loadCalendarEvents, expandRecurring, type CalendarEvent } from '../calendar-store.ts';
import { matchEventToCourse } from '../course-matcher';
import {
    loadScrapedDeadlines,
    loadScrapedDeadlinesEnabled,
    dismissScrapedDeadline,
    dismissInList,
    visibleScrapedDeadlines,
    type ScrapedDeadline,
} from '../core/deadline-store';
import type { DeadlineKind } from '../core/deadline-parser';

/* ── Constants ─────────────────────────────────────────────── */

const MS_HOUR    = 3_600_000;
const MS_DAY     = 86_400_000;
const LOOK_AHEAD = 30 * MS_DAY;

/* ── Module-level cache (same pattern as calendar widget) ───── */

let cachedEvents: CalendarEvent[] = [];
let eventsLoaded = false;
let cachedScraped: ScrapedDeadline[] = [];
let scrapedEnabled = false;

async function loadScraped(): Promise<void> {
    scrapedEnabled = await loadScrapedDeadlinesEnabled();
    cachedScraped = scrapedEnabled ? await loadScrapedDeadlines() : [];
}

async function ensureLoaded(): Promise<void> {
    if (eventsLoaded) return;
    const [raw] = await Promise.all([loadCalendarEvents(), loadScraped()]);
    const now  = new Date();
    const end  = new Date(now.getTime() + LOOK_AHEAD);
    cachedEvents = expandRecurring(raw, now, end);
    eventsLoaded = true;
}

function rerenderDeadlines(): void {
    const el = document.querySelector(
        '#opal-modern-ui [data-widget-id="deadline"] .widget-content'
    ) as HTMLElement | null;
    if (!el) return;
    el.innerHTML = deadlineWidget.render(cachedEvents);
}

/* Auto-invalidate when calendar events or scraped deadlines are saved anywhere */
store.watch(keys.calendarEvents, () => {
    eventsLoaded = false;
    void ensureLoaded().then(() => rerenderDeadlines());
});
for (const entry of [keys.scrapedDeadlines, keys.deadlines]) {
    store.watch<unknown>(entry, () => { void loadScraped().then(() => { if (eventsLoaded) rerenderDeadlines(); }); });
}

/* Dismiss control on scraped rows. Delegated on document, so it survives
 * every re-render without main.ts wiring it up. */
document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest<HTMLButtonElement>('#opal-modern-ui .deadline-dismiss');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = btn.dataset.deadlineId;
    if (!id) return;
    cachedScraped = dismissInList(cachedScraped, id);
    rerenderDeadlines();
    void dismissScrapedDeadline(id);
});

/* ── Countdown helpers ─────────────────────────────────────── */

type Urgency = 'danger' | 'warning' | 'normal';

/* The label says in words how long is left, so the colour is only a second cue. */
function formatCountdown(ms: number): { label: string; urgency: Urgency } {
    if (ms < 0)          return { label: t('deadlineInProgress'), urgency: 'danger' };
    if (ms < MS_HOUR)    return { label: t('deadlineMinutes', { count: Math.max(1, Math.floor(ms / 60_000)) }), urgency: 'danger' };
    if (ms < MS_DAY)     return { label: t('deadlineHours', { count: Math.floor(ms / MS_HOUR) }), urgency: 'danger' };
    const days = Math.floor(ms / MS_DAY);
    return { label: t('deadlineDays', { count: days }), urgency: ms < 3 * MS_DAY ? 'warning' : 'normal' };
}

/* Static class maps — never interpolate Tailwind dynamically */
const URGENCY_CLS: Record<Urgency, string> = {
    danger:  'text-opal-danger',
    warning: 'text-opal-warning',
    normal:  '',
};

/* ── Date/time formatting ──────────────────────────────────── */

function timeFmt(d: Date): string {
    return formatDate(d, { hour: '2-digit', minute: '2-digit' });
}

function formatEventLine(start: string, end: string, location?: string): string {
    const s    = new Date(start);
    const e    = new Date(end);
    const now  = new Date();
    const tom  = new Date(now.getTime() + MS_DAY);

    let datePart: string;
    if (s.toDateString() === now.toDateString())  datePart = t('sharedToday');
    else if (s.toDateString() === tom.toDateString()) datePart = t('sharedTomorrow');
    else datePart = t('deadlineDate', { day: s.getDate(), month: formatDate(s, { month: 'long' }).slice(0, 3) });

    const timePart = e > s ? t('calendarTimeRange', { start: timeFmt(s), end: timeFmt(e) }) : timeFmt(s);
    const loc      = location ? ` · ${escapeHtml(location)}` : '';
    return `${datePart} · ${timePart}${loc}`;
}

/** Course the event belongs to if the matcher knows it, else the calendar file it came from. */
function eventContext(ev: CalendarEvent): string {
    const course = matchEventToCourse(ev.title)?.course.title;
    if (course) return course;
    if (ev.sourceFile === 'Manual Entry') return t('deadlineManualEvent');
    return ev.sourceFile ?? '';
}

/* ── Upcoming filter ───────────────────────────────────────── */

type RichEvent = CalendarEvent & { msUntil: number };
type Upcoming =
    | { source: 'calendar'; ev: RichEvent; msUntil: number }
    | { source: 'opal'; item: ScrapedDeadline; msUntil: number };

function getUpcoming(events: CalendarEvent[], scraped: ScrapedDeadline[], limit = 7): Upcoming[] {
    const now     = Date.now();
    const cutoff  = now + LOOK_AHEAD;
    const fromCalendar: Upcoming[] = events
        .map(ev => ({ ...ev, msUntil: new Date(ev.start).getTime() - now }))
        .filter(ev =>
            ev.isDeadline === true &&                // only deadline-flagged events
            new Date(ev.end).getTime()   > now &&   // not fully past
            new Date(ev.start).getTime() < cutoff   // within look-ahead
        )
        .map(ev => ({ source: 'calendar' as const, ev, msUntil: ev.msUntil }));
    const fromOpal: Upcoming[] = visibleScrapedDeadlines(scraped, now)
        .filter(d => Date.parse(d.due) < cutoff)
        .map(item => ({ source: 'opal' as const, item, msUntil: Date.parse(item.due) - now }));
    return [...fromCalendar, ...fromOpal]
        .sort((a, b) => a.msUntil - b.msUntil)
        .slice(0, limit);
}

/* ── Event row ─────────────────────────────────────────────── */

function renderEvent(ev: RichEvent): string {
    const { label, urgency } = formatCountdown(ev.msUntil);
    const context = eventContext(ev);
    const line  = formatEventLine(ev.start, ev.end, ev.location);

    return `
    <div class="deadline-card flex items-start gap-3 py-2">
      <div class="flex-1 min-w-0">
        <p class="text-[13px] text-opal-text leading-snug truncate">${escapeHtml(ev.title)}</p>
        ${context ? `<p class="text-xs text-opal-text-muted truncate">${escapeHtml(context)}</p>` : ''}
        <p class="text-xs text-opal-text-muted truncate">${line}</p>
      </div>
      <span class="opal-row-meta ${URGENCY_CLS[urgency]}">${label}</span>
    </div>`;
}

/* ── Scraped row ───────────────────────────────────────────── */

const KIND_LABEL = {
    deadline:  'deadlineFromOpal',
    enrolment: 'deadlineEnrolment',
    exam:      'deadlineExam',
} as const satisfies Record<DeadlineKind, Parameters<typeof t>[0]>;

const DISMISS_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/** A deadline found on an OPAL page: links to that page, can be hidden. */
function renderScraped(d: ScrapedDeadline, msUntil: number): string {
    const { label, urgency } = formatCountdown(msUntil);
    const context = [t(KIND_LABEL[d.kind]), d.courseTitle ?? ''].filter(Boolean).map(escapeHtml).join(' · ');
    const line = formatEventLine(d.due, d.due);
    const hint = d.description ? ` title="${escapeAttr(d.description)}"` : '';

    return `
    <div class="deadline-card deadline-scraped flex items-start gap-3 py-2">
      <a class="deadline-scraped-link flex-1 min-w-0" href="${safeHref(d.pageUrl)}"${hint}>
        <span class="deadline-scraped-title block text-[13px] text-opal-text leading-snug truncate">${escapeHtml(d.title || t('deadlineFallbackTitle'))}</span>
        <span class="block text-xs text-opal-text-muted truncate">${context}</span>
        <span class="block text-xs text-opal-text-muted truncate">${line}</span>
      </a>
      <span class="opal-row-meta ${URGENCY_CLS[urgency]}">${label}</span>
      <button type="button" class="deadline-dismiss" data-deadline-id="${escapeAttr(d.id)}" aria-label="${t('deadlineDismiss')}" title="${t('deadlineDismiss')}">${DISMISS_ICON}</button>
    </div>`;
}

/* ── Widget definition ─────────────────────────────────────── */

export const deadlineWidget: Widget<CalendarEvent[]> = {
    id: 'deadline',
    opalPortletOrder: '',
    get title() { return t('deadlineTitle'); },
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    defaultW: 4,
    defaultH: 4,
    hasNativeConfig: false,

    scrape() {
        return cachedEvents;
    },

    render(data: CalendarEvent[]): string {
        const events = data as CalendarEvent[];

        if (!eventsLoaded) {
            ensureLoaded().then(() => rerenderDeadlines());
            return `
            <div class="opal-empty">
              <p class="opal-empty-hint">${t('deadlineLoading')}</p>
            </div>`;
        }

        const upcoming = getUpcoming(events, scrapedEnabled ? cachedScraped : []);

        if (upcoming.length === 0) {
            return `
            <div class="opal-empty">
              <p class="opal-empty-title">${t('deadlineEmpty')}</p>
              <p class="opal-empty-hint">${t(scrapedEnabled ? 'deadlineEmptyHintWithScraping' : 'deadlineEmptyHint')}</p>
            </div>`;
        }

        const rows = upcoming.map(u => (u.source === 'calendar' ? renderEvent(u.ev) : renderScraped(u.item, u.msUntil))).join('');
        // Detected deadlines are a convenience, not a source of truth: say so wherever one is shown.
        const note = upcoming.some(u => u.source === 'opal') ? `<p class="text-xs text-opal-text-muted pt-2">${t('deadlineUnofficial')}</p>` : '';
        return `<div>${rows}${note}</div>`;
    },
};
