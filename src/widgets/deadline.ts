/* ━━ Deadline Countdown Widget ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Design language: DESIGN.md — Deep Space Glassmorphism.
 * Shows upcoming calendar events with urgency-colored countdown labels.
 * Reloads automatically when calendar events change in storage.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';
import { escapeHtml } from '../utils';
import { loadCalendarEvents, expandRecurring, type CalendarEvent } from '../calendar-store';

/* ── Constants ─────────────────────────────────────────────── */

const EVENTS_KEY = 'opalCalendarEvents_v1';
const MS_HOUR    = 3_600_000;
const MS_DAY     = 86_400_000;
const LOOK_AHEAD = 30 * MS_DAY;

/* ── Module-level cache (same pattern as calendar widget) ───── */

let cachedEvents: CalendarEvent[] = [];
let eventsLoaded = false;

async function ensureLoaded(): Promise<void> {
    if (eventsLoaded) return;
    const raw = await loadCalendarEvents();
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

/* Auto-invalidate when calendar events are saved anywhere */
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && EVENTS_KEY in changes) {
        eventsLoaded = false;
        ensureLoaded().then(() => rerenderDeadlines());
    }
});

/* ── Countdown helpers ─────────────────────────────────────── */

type Urgency = 'danger' | 'warning' | 'normal';

function formatCountdown(ms: number): { label: string; urgency: Urgency } {
    if (ms < 0)          return { label: 'Jetzt',          urgency: 'danger'  };
    if (ms < MS_HOUR)    return { label: `${Math.floor(ms / 60_000)}m`,         urgency: 'danger'  };
    if (ms < MS_DAY)     return { label: `${Math.floor(ms / MS_HOUR)}h`,        urgency: 'danger'  };
    if (ms < 3 * MS_DAY) return { label: `${Math.floor(ms / MS_DAY)}d`,         urgency: 'warning' };
    return               { label: `${Math.floor(ms / MS_DAY)}d`,                urgency: 'normal'  };
}

/* Static class maps — never interpolate Tailwind dynamically */
const BADGE_CLS: Record<Urgency, string> = {
    danger:  'text-opal-danger  bg-opal-danger/10  border-opal-danger/20',
    warning: 'text-opal-warning bg-opal-warning/10 border-opal-warning/20',
    normal:  'text-opal-text-muted bg-opal-surface-2 border-opal-glass-border',
};

/* Progress bar colors per urgency (inline — no dynamic Tailwind) */
const BAR_COLOR: Record<Urgency, string> = {
    danger:  'var(--color-opal-danger,  #f87171)',
    warning: 'var(--color-opal-warning, #fbbf24)',
    normal:  'var(--color-opal-accent,  #6264f4)',
};

/**
 * Returns 0–100 fill percentage based on createdAt → now → start.
 * If createdAt is missing falls back to a 30-day window ending at start.
 */
function progressPct(ev: CalendarEvent): number {
    const deadline  = new Date(ev.start).getTime();
    const now       = Date.now();
    const origin    = ev.createdAt
        ? new Date(ev.createdAt).getTime()
        : deadline - 30 * MS_DAY;   // fallback: 30-day window
    const total = deadline - origin;
    if (total <= 0) return 100;
    return Math.min(100, Math.max(0, ((now - origin) / total) * 100));
}

/* ── Date/time formatting ──────────────────────────────────── */

const MONTH_SHORT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

function timeFmt(d: Date): string {
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatEventLine(start: string, end: string, location?: string): string {
    const s    = new Date(start);
    const e    = new Date(end);
    const now  = new Date();
    const tom  = new Date(now.getTime() + MS_DAY);

    let datePart: string;
    if (s.toDateString() === now.toDateString())  datePart = 'Heute';
    else if (s.toDateString() === tom.toDateString()) datePart = 'Morgen';
    else datePart = `${s.getDate()}. ${MONTH_SHORT[s.getMonth()]}`;

    const timePart = e > s ? `${timeFmt(s)}–${timeFmt(e)}` : timeFmt(s);
    const loc      = location ? ` · ${escapeHtml(location)}` : '';
    return `${datePart} · ${timePart}${loc}`;
}

/* ── Upcoming filter ───────────────────────────────────────── */

type RichEvent = CalendarEvent & { msUntil: number };

function getUpcoming(events: CalendarEvent[], limit = 7): RichEvent[] {
    const now     = Date.now();
    const cutoff  = now + LOOK_AHEAD;
    return events
        .map(ev => ({ ...ev, msUntil: new Date(ev.start).getTime() - now }))
        .filter(ev =>
            ev.isDeadline === true &&                // only deadline-flagged events
            new Date(ev.end).getTime()   > now &&   // not fully past
            new Date(ev.start).getTime() < cutoff   // within look-ahead
        )
        .sort((a, b) => a.msUntil - b.msUntil)
        .slice(0, limit);
}

/* ── Event card ────────────────────────────────────────────── */

function renderEvent(ev: RichEvent): string {
    const { label, urgency } = formatCountdown(ev.msUntil);
    const line  = formatEventLine(ev.start, ev.end, ev.location);
    const pct   = progressPct(ev);
    const color = BAR_COLOR[urgency];

    return `
    <div class="deadline-card p-2.5">
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-opal-text leading-snug">${escapeHtml(ev.title)}</p>
          <p class="text-[10px] text-opal-text-muted mt-0.5">${line}</p>
        </div>
        <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 mt-0.5 ${BADGE_CLS[urgency]}">${label}</span>
      </div>
      <div style="margin-top:6px;height:3px;border-radius:2px;background:var(--color-opal-divider);overflow:hidden">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:${color};border-radius:2px;transition:width 0.4s"></div>
      </div>
    </div>`;
}

/* ── Widget definition ─────────────────────────────────────── */

export const deadlineWidget: Widget = {
    id: 'deadline',
    opalPortletOrder: '',
    title: 'Termine & Deadlines',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    defaultW: 4,
    defaultH: 4,
    hasNativeConfig: false,

    scrape() {
        return cachedEvents;
    },

    render(data: unknown): string {
        const events = data as CalendarEvent[];

        if (!eventsLoaded) {
            ensureLoaded().then(() => rerenderDeadlines());
            return `
            <div class="text-center py-6">
              <p class="text-xs text-opal-text-muted">Lade Termine…</p>
            </div>`;
        }

        const upcoming = getUpcoming(events);

        if (upcoming.length === 0) {
            return `
            <div class="text-center py-6">
              <svg class="mx-auto mb-2 text-opal-text-muted/30" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <p class="text-sm text-opal-text-muted">Keine Deadlines in den nächsten 30 Tagen.</p>
              <p class="text-xs text-opal-text-muted/60 mt-1">Markiere Termine im Kalender-Widget mit „Als Deadline markieren".</p>
            </div>`;
        }

        return `<div class="space-y-1.5">${upcoming.map(renderEvent).join('')}</div>`;
    },
};
