/* ━━ Calendar Event Store ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Handles ICS/VCS parsing, event persistence, and queries.
 * Events stored in chrome.storage.local.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export interface CalendarEvent {
    id: string;
    title: string;
    start: string;           // ISO datetime string
    end: string;             // ISO datetime string
    location?: string;
    description?: string;
    color?: string;          // hex color for display
    rrule?: string;          // original RRULE string for recurring events
    sourceFile?: string;     // filename it was imported from
    isDeadline?: boolean;    // true → appears in Deadline Countdown widget
    createdAt?: string;      // ISO datetime when this event was manually added
}

export interface CalendarSettings {
    showFavoritesAsEvents: boolean;
    matchThreshold: number; // Fuse.js threshold 0-1 (lower = stricter). Mapped from 30-100% UI slider.
}

const EVENTS_KEY = 'opalCalendarEvents_v1';
const SETTINGS_KEY = 'opalCalendarSettings_v1';

/* ── ICS / VCS Parser ──────────────────────────────────────── */

function parseICSDate(val: string): Date {
    // ICS dates: 20260225T073000 or 20260225T073000Z or 20260225
    const clean = val.replace(/[^0-9T]/g, '');
    if (clean.length >= 15) {
        // YYYYMMDDTHHmmss
        const y = parseInt(clean.slice(0, 4));
        const m = parseInt(clean.slice(4, 6)) - 1;
        const d = parseInt(clean.slice(6, 8));
        const h = parseInt(clean.slice(9, 11));
        const mi = parseInt(clean.slice(11, 13));
        const s = parseInt(clean.slice(13, 15));
        return new Date(y, m, d, h, mi, s);
    }
    if (clean.length >= 8) {
        // YYYYMMDD (all-day event)
        const y = parseInt(clean.slice(0, 4));
        const m = parseInt(clean.slice(4, 6)) - 1;
        const d = parseInt(clean.slice(6, 8));
        return new Date(y, m, d, 0, 0, 0);
    }
    return new Date(val);
}

function unfoldICS(raw: string): string {
    // ICS line folding: continuation lines start with a space or tab
    return raw.replace(/\r?\n[ \t]/g, '');
}

export function parseICS(text: string): CalendarEvent[] {
    const unfolded = unfoldICS(text);
    const lines = unfolded.split(/\r?\n/);
    const events: CalendarEvent[] = [];
    let inEvent = false;
    let current: Partial<CalendarEvent> = {};

    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') {
            inEvent = true;
            current = {};
            continue;
        }
        if (line === 'END:VEVENT') {
            inEvent = false;
            if (current.title && current.start) {
                events.push({
                    id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
                    title: current.title,
                    start: current.start,
                    end: current.end || current.start,
                    location: current.location,
                    description: current.description,
                    rrule: current.rrule,
                });
            }
            continue;
        }
        if (!inEvent) continue;

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const keyPart = line.slice(0, colonIdx);
        const value = line.slice(colonIdx + 1);
        // Strip parameters (e.g., DTSTART;TZID=Europe/Berlin:...)
        const key = keyPart.split(';')[0];

        switch (key) {
            case 'SUMMARY':
                current.title = value.replace(/\\n/g, ' ').replace(/\\,/g, ',').trim();
                break;
            case 'DTSTART':
                current.start = parseICSDate(value).toISOString();
                break;
            case 'DTEND':
                current.end = parseICSDate(value).toISOString();
                break;
            case 'LOCATION':
                current.location = value.replace(/\\n/g, ' ').replace(/\\,/g, ',').trim();
                break;
            case 'DESCRIPTION':
                current.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').trim();
                break;
            case 'RRULE':
                current.rrule = value;
                break;
        }
    }

    return events;
}

/* ── Recurrence expansion ──────────────────────────────────── */

/**
 * Expand recurring events (weekly RRULE) into individual occurrences
 * within the given date range.
 */
export function expandRecurring(
    events: CalendarEvent[],
    rangeStart: Date,
    rangeEnd: Date
): CalendarEvent[] {
    const result: CalendarEvent[] = [];

    for (const ev of events) {
        if (!ev.rrule) {
            // Non-recurring: include if within range
            const evStart = new Date(ev.start);
            if (evStart >= rangeStart && evStart <= rangeEnd) {
                result.push(ev);
            }
            continue;
        }

        // Parse RRULE (simplified: supports WEEKLY with BYDAY and COUNT/UNTIL)
        const parts = ev.rrule.split(';').reduce((acc, p) => {
            const [k, v] = p.split('=');
            acc[k] = v;
            return acc;
        }, {} as Record<string, string>);

        if (parts.FREQ !== 'WEEKLY') {
            // Only support weekly recurrence for now
            const evStart = new Date(ev.start);
            if (evStart >= rangeStart && evStart <= rangeEnd) {
                result.push(ev);
            }
            continue;
        }

        const originalStart = new Date(ev.start);
        const originalEnd = new Date(ev.end);
        const duration = originalEnd.getTime() - originalStart.getTime();
        const interval = parseInt(parts.INTERVAL || '1');
        const maxCount = parts.COUNT ? parseInt(parts.COUNT) : 52; // Default 1 year of weeks
        const until = parts.UNTIL ? parseICSDate(parts.UNTIL) : new Date(rangeEnd.getTime() + 86400000);

        let occurrences = 0;
        const cursor = new Date(originalStart);

        while (cursor <= until && occurrences < maxCount && cursor <= rangeEnd) {
            if (cursor >= rangeStart) {
                const occEnd = new Date(cursor.getTime() + duration);
                result.push({
                    ...ev,
                    id: `${ev.id}_${occurrences}`,
                    start: cursor.toISOString(),
                    end: occEnd.toISOString(),
                });
            }
            cursor.setDate(cursor.getDate() + 7 * interval);
            occurrences++;
        }
    }

    return result;
}

/* ── Storage ───────────────────────────────────────────────── */

export async function loadCalendarEvents(): Promise<CalendarEvent[]> {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([EVENTS_KEY], (result) => {
                resolve(result[EVENTS_KEY] || []);
            });
        } else {
            resolve([]);
        }
    });
}

export async function saveCalendarEvents(events: CalendarEvent[]): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [EVENTS_KEY]: events }, resolve);
        } else {
            resolve();
        }
    });
}

export async function loadCalendarSettings(): Promise<CalendarSettings> {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([SETTINGS_KEY], (result) => {
                resolve(result[SETTINGS_KEY] || { showFavoritesAsEvents: false, matchThreshold: 0.4 });
            });
        } else {
            resolve({ showFavoritesAsEvents: false, matchThreshold: 0.4 });
        }
    });
}

export async function saveCalendarSettings(settings: CalendarSettings): Promise<void> {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ [SETTINGS_KEY]: settings }, resolve);
        } else {
            resolve();
        }
    });
}

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

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

export function getEventsForDay(events: CalendarEvent[], date: Date): CalendarEvent[] {
    return events.filter(ev => isSameDay(new Date(ev.start), date))
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export function getEventsForMonth(events: CalendarEvent[], year: number, month: number): CalendarEvent[] {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59);
    return events.filter(ev => {
        const d = new Date(ev.start);
        return d >= start && d <= end;
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
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
