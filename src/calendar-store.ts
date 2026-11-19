import { t } from './i18n/messages/widgets.ts';
import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
/* ━━ Calendar Event Store ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Handles ICS/VCS parsing, event persistence, and queries.
 * Events stored in storage.local.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export interface CalendarEvent {
    id: string;
    title: string;
    start: string;           // ISO datetime string
    end: string;             // ISO datetime string
    location?: string;
    description?: string;
    color?: string;          // hex color for display
    timeZone?: string;
    allDay?: boolean;
    exdates?: string[];
    rrule?: string;          // original RRULE string for recurring events
    sourceFile?: string;     // filename it was imported from
    isDeadline?: boolean;    // true → appears in Deadline Countdown widget
    createdAt?: string;      // ISO datetime when this event was manually added
}

export interface CalendarSettings {
    showFavoritesAsEvents: boolean;
    matchThreshold: number; // Fuse.js threshold 0-1 (lower = stricter). Mapped from 30-100% UI slider.
}


/* ── ICS / VCS Parser ──────────────────────────────────────── */


function wall(value: Date, zone?: string): Date {
    if (!zone) return new Date(value);
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value);
    const get = (key: string) => Number(parts.find(p => p.type === key)?.value);
    return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}
function stamp(d: Date): number {
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
}
function instant(d: Date, zone?: string): Date {
    if (!zone) return new Date(d);
    let result = new Date(stamp(d));
    for (let i = 0; i < 3; i++) result = new Date(result.getTime() + stamp(d) - stamp(wall(result, zone)));
    return result;
}
function parseICSDate(value: string, zone?: string): Date {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/.exec(value);
    if (!m) throw new Error(t('calendarInvalidDate'));
    return instant(new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), m[7] ? 'UTC' : zone);
}
export function parseICS(text: string): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    let current: Partial<CalendarEvent> | undefined;
    const decode = (v: string) => v.replace(/\\([nN,;\\])/g, (_, c: string) => c.toLowerCase() === 'n' ? '\n' : c);
    for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
        if (line === 'BEGIN:VEVENT') { current = {}; continue; }
        if (!current) continue;
        if (line === 'END:VEVENT') {
            if (current.start && current.title) {
                const end = new Date(current.start);
                if (current.allDay) end.setDate(end.getDate() + 1);
                events.push({ ...current, id: crypto.randomUUID(), end: current.end || end.toISOString() } as CalendarEvent);
            }
            current = undefined;
            continue;
        }
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const property = line.slice(0, colon);
        const key = property.split(';')[0].toUpperCase();
        const value = line.slice(colon + 1);
        const zone = /;TZID="?([^;"]+)"?/.exec(property)?.[1];
        if (key === 'DTSTART') {
            current.start = parseICSDate(value, zone).toISOString();
            current.timeZone = value.endsWith('Z') ? 'UTC' : zone;
            current.allDay = !value.includes('T');
        } else if (key === 'DTEND') current.end = parseICSDate(value, zone).toISOString();
        else if (key === 'EXDATE') current.exdates = [...(current.exdates || []), ...value.split(',').map(v => parseICSDate(v, zone).toISOString())];
        else if (key === 'SUMMARY') current.title = decode(value).trim();
        else if (key === 'LOCATION') current.location = decode(value);
        else if (key === 'DESCRIPTION') current.description = decode(value);
        else if (key === 'RRULE') current.rrule = value;
    }
    return events;
}
function overlaps(ev: CalendarEvent, start: Date, end: Date): boolean {
    const first = Date.parse(ev.start);
    const last = Date.parse(ev.end);
    return first <= +end && (last > +start || (last === first && first >= +start));
}
export function expandRecurring(events: CalendarEvent[], rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
    const result: CalendarEvent[] = [];
    const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    for (const ev of events) {
        if (!ev.rrule) { if (overlaps(ev, rangeStart, rangeEnd)) result.push(ev); continue; }
        const r: Record<string, string> = Object.fromEntries(ev.rrule.split(';').map(p => p.split('=')));
        const first = wall(new Date(ev.start), ev.timeZone);
        const duration = stamp(wall(new Date(ev.end), ev.timeZone)) - stamp(first);
        const interval = Math.max(1, Number(r.INTERVAL) || 1);
        const until = r.UNTIL ? parseICSDate(r.UNTIL.length === 8 ? r.UNTIL + 'T235959' : r.UNTIL, ev.timeZone) : rangeEnd;
        const cursor = new Date(first);
        let count = 0;
        while (count < (r.COUNT ? Number(r.COUNT) : Infinity)) {
            const start = instant(cursor, ev.timeZone);
            if (start > rangeEnd || start > until) break;
            const day = Math.round((Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()) - Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())) / 86400000);
            const months = (cursor.getFullYear() - first.getFullYear()) * 12 + cursor.getMonth() - first.getMonth();
            const byday = r.BYDAY?.split(',');
            const matchesDay = !byday || byday.some(value => {
                const match = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(value);
                if (!match || match[2] !== days[cursor.getDay()]) return false;
                if (!match[1]) return true;
                const ordinal = Number(match[1]);
                const monthDays = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
                return ordinal > 0 ? Math.ceil(cursor.getDate() / 7) === ordinal
                    : -Math.ceil((monthDays - cursor.getDate() + 1) / 7) === ordinal;
            });
            const matches = r.FREQ === 'DAILY' ? day % interval === 0
                : r.FREQ === 'WEEKLY' ? Math.floor((day + (first.getDay() + 6) % 7) / 7) % interval === 0 && (byday ? matchesDay : cursor.getDay() === first.getDay())
                : r.FREQ === 'MONTHLY' ? months % interval === 0 && (byday ? matchesDay : cursor.getDate() === first.getDate())
                : day === 0;
            if (matches && matchesDay) {
                count++;
                const end = new Date(cursor);
                end.setSeconds(end.getSeconds() + duration / 1000);
                const occurrence = { ...ev, id: `${ev.id}_${count}`, start: start.toISOString(), end: instant(end, ev.timeZone).toISOString() };
                if (!ev.exdates?.includes(occurrence.start) && overlaps(occurrence, rangeStart, rangeEnd)) result.push(occurrence);
            }
            cursor.setDate(cursor.getDate() + 1);
        }
    }
    return result;
}

/* ── Storage ───────────────────────────────────────────────── */

export async function loadCalendarEvents(): Promise<CalendarEvent[]> { return store.get(keys.calendarEvents); }
export async function saveCalendarEvents(events: CalendarEvent[]): Promise<void> { return store.set(keys.calendarEvents, events); }
export async function loadCalendarSettings(): Promise<CalendarSettings> { return store.get(keys.calendarSettings); }
export async function saveCalendarSettings(settings: CalendarSettings): Promise<void> { return store.set(keys.calendarSettings, settings); }

export async function importICSFile(file: File): Promise<number> {
    const text = await file.text();
    const newEvents = parseICS(text);
    // Tag events with source filename
    newEvents.forEach(ev => { ev.sourceFile = file.name; });
    const existing = await loadCalendarEvents();

    // Deduplicate: skip events with same title + start time
    const existingKeys = new Set(existing.map(e => `${e.title}|${e.start}`));
    const unique = newEvents.filter(e => !existingKeys.has(`${e.title}|${e.start}`));

    const merged = [...existing, ...unique];
    await saveCalendarEvents(merged);
    return unique.length;
}

export async function addCustomEvent(event: Omit<CalendarEvent, 'id'>): Promise<void> {
    const newEvent: CalendarEvent = {
        ...event,
        id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
        sourceFile: 'Manual Entry',
        createdAt: new Date().toISOString(),
    };
    const existing = await loadCalendarEvents();
    existing.push(newEvent);
    await saveCalendarEvents(existing);
}

export async function clearCalendarEvents(): Promise<void> {
    await saveCalendarEvents([]);
}

/* ── Query helpers ─────────────────────────────────────────── */

export function getEventsForDay(events: CalendarEvent[], date: Date): CalendarEvent[] {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return events.filter(ev => new Date(ev.start) < end && overlaps(ev, start, end))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
export function getEventsForMonth(events: CalendarEvent[], year: number, month: number): CalendarEvent[] {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    return events.filter(ev => new Date(ev.start) < end && overlaps(ev, start, end))
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Get Monday of the week containing the given date */
export function getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}
