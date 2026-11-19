/* ━━ Deadline parser ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Finds hand-in, enrolment and exam dates in plain page text.
 * Pure: no DOM, no browser APIs, so it runs under node --test.
 *
 * Conservative by design. A date only counts when a keyword stands
 * near it (same sentence, about 80 characters before or 60 after).
 * Ranges keep their end date. Without a time the deadline is 23:59
 * local time. Built on text patterns only; not yet checked against
 * real OPAL task pages.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export type DeadlineKind = 'deadline' | 'enrolment' | 'exam';

export interface FoundDeadline {
    due: Date;
    kind: DeadlineKind;
    /** The sentence the date was found in, whitespace collapsed and shortened. */
    sentence: string;
    hasTime: boolean;
}

/* ── Limits ────────────────────────────────────────────────── */

export const MAX_SCAN_CHARS = 30_000;
const WINDOW_BEFORE = 80;
const WINDOW_AFTER = 60;
const NEGATIVE_WINDOW = 28;
const SENTENCE_MAX = 160;
const MAX_FUTURE_MS = 2 * 366 * 86_400_000;
const MAX_RESULTS = 25;

/* ── Date patterns ─────────────────────────────────────────── */

const MONTHS: Record<string, number> = {
    januar: 1, jänner: 1, jan: 1, january: 1,
    februar: 2, feb: 2, february: 2,
    märz: 3, maerz: 3, mär: 3, mrz: 3, march: 3, mar: 3,
    april: 4, apr: 4,
    mai: 5, may: 5,
    juni: 6, jun: 6, june: 6,
    juli: 7, jul: 7, july: 7,
    august: 8, aug: 8,
    september: 9, sept: 9, sep: 9,
    oktober: 10, okt: 10, october: 10, oct: 10,
    november: 11, nov: 11,
    dezember: 12, dez: 12, december: 12, dec: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

/** 24.11.2026 · 24.11.26 · 24.11. (year inferred) */
const RE_NUMERIC = /(?<![\p{L}\p{N}.,/:-])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})(?![\p{N}]|[:.,]\d))?(?!\d)/gu;
/** 2026-11-24 */
const RE_ISO = /(?<![\p{N}./-])(\d{4})-(\d{2})-(\d{2})(?![\p{N}-])/gu;
/** 24. November 2026 · 24. Nov. 2026 · 24 November 2026 */
const RE_DAY_MONTH = new RegExp(`(?<![\\p{L}\\p{N}.])(\\d{1,2})\\.?\\s*(${MONTH_ALT})\\.?(?:\\s*,?\\s*(\\d{4}))?(?![\\p{L}\\p{N}])`, 'giu');
/** November 24, 2026 (year required: month words double as ordinary words) */
const RE_MONTH_DAY = new RegExp(`(?<![\\p{L}])(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?![\\p{N}])`, 'giu');

/** Time right after a date: ", 23:59 Uhr", " um 12 Uhr", "T23:59", " 11:59 pm" */
const RE_TIME_TAIL = /^(?:T|\s*,?\s*(?:um\s+|at\s+|gegen\s+|-\s*)?)(\d{1,2})(?:([:.])(\d{2}))?(?::\d{2})?\s*(uhr|h(?![\p{L}])|am(?![\p{L}])|pm(?![\p{L}]))?/iu;

/** What may stand between two dates for them to form a range. */
const RE_RANGE_GAP = /^\s*(?:[-–—]|bis(?:\s+(?:zum|einschließlich))?|to|until|till|through)\s*$/iu;

/** Cheap pre-check: does the text hold anything date-shaped at all? */
const RE_ANY_DATE = new RegExp(`\\d{1,2}\\.\\s?\\d{1,2}\\.|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\.?\\s*(?:${MONTH_ALT})(?![\\p{L}])|(?:${MONTH_ALT})\\.?\\s+\\d{1,2}`, 'iu');

/* ── Keyword patterns ──────────────────────────────────────── */

const RE_ENROL = /(?<![\p{L}])(?:einschreibung\s+(?:endet|bis|schließt|ist\s+bis|möglich\s+bis)|einschreibe(?:frist|schluss|zeitraum|ende)|einschreibungsfrist|enrol(?:l)?ment\s+(?:deadline|ends|closes|period)|registration\s+(?:deadline|ends|closes))(?![\p{L}])/giu;
const RE_EXAM = /(?<![\p{L}])(?:\p{L}*(?:klausur|prüfung)(?:\s+findet)?\s+am|\p{L}*(?:klausur|prüfungs)termin|(?:final\s+)?exam(?:ination)?\s+(?:on|date))(?![\p{L}])/giu;
const RE_DEADLINE = /(?<![\p{L}])(?:abgabe\p{L}*|einreichung\p{L}*|einzureichen|einreichen|abzugeben|abgeben|hochzuladen|hochladen|\p{L}*frist(?:en)?|deadline\p{L}*|fällig\p{L}*|due|spätestens|bis\s+zum|bearbeitungszeit\p{L}*|submission|submit|hand\s+in|upload)(?![\p{L}])/giu;

/** Words right before a date that make it a non-deadline: "Stand: 01.10.2026", "Tel.", "ab 1.11.". */
const RE_NEGATIVE_BEFORE = /(?<![\p{L}])(?:stand|zuletzt\s+(?:geändert|aktualisiert|bearbeitet)|aktualisiert|geändert|erstellt|veröffentlicht|letzte\s+änderung|last\s+(?:updated|modified|changed)|updated|posted|published|tel(?:efon)?|fax|version|ver|v|seit|ab|since|from|geboren)\.?\s*:?\s*(?:am\s+|dem\s+|den\s+|on\s+)?$/iu;

/* ── Internals ─────────────────────────────────────────────── */

interface DateHit {
    start: number;
    /** End including a trailing time, if any. */
    end: number;
    year: number | null;
    month: number;
    day: number;
    hour: number | null;
    minute: number | null;
}

interface KeywordHit { start: number; end: number; kind: DeadlineKind }

const at = (m: RegExpMatchArray): number => m.index ?? 0;

function parseYear(raw: string | undefined): number | null {
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return raw.length === 2 ? 2000 + n : n;
}

function readTime(text: string, at: number): { end: number; hour: number; minute: number } | null {
    const m = RE_TIME_TAIL.exec(text.slice(at, at + 24));
    if (!m) return null;
    const [whole, hRaw, sep, mRaw, suffixRaw] = m;
    const suffix = suffixRaw?.toLowerCase();
    // Only a real time: "23:59", "23.59 Uhr" or "12 Uhr". Plain trailing numbers are not times.
    if (sep === ':' && mRaw) { /* ok */ }
    else if (sep === '.' && mRaw && suffix === 'uhr') { /* ok */ }
    else if (!sep && suffix && suffix !== 'h') { /* "12 Uhr", "5 pm" */ }
    else return null;
    let hour = parseInt(hRaw, 10);
    let minute = mRaw ? parseInt(mRaw, 10) : 0;
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    if (hour === 24 && minute === 0) { hour = 23; minute = 59; }
    if (hour > 23 || minute > 59) return null;
    return { end: at + whole.length, hour, minute };
}

function collectDateHits(text: string): DateHit[] {
    const hits: DateHit[] = [];
    const push = (start: number, end: number, year: number | null, month: number, day: number) => {
        if (month < 1 || month > 12 || day < 1 || day > 31) return;
        if (year !== null && (year < 2000 || year > 2100)) return;
        const time = readTime(text, end);
        hits.push({ start, end: time?.end ?? end, year, month, day, hour: time?.hour ?? null, minute: time?.minute ?? null });
    };
    for (const m of text.matchAll(RE_NUMERIC)) push(at(m), at(m) + m[0].length, parseYear(m[3]), +m[2], +m[1]);
    for (const m of text.matchAll(RE_ISO)) push(at(m), at(m) + m[0].length, +m[1], +m[2], +m[3]);
    for (const m of text.matchAll(RE_DAY_MONTH)) push(at(m), at(m) + m[0].length, parseYear(m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
    for (const m of text.matchAll(RE_MONTH_DAY)) push(at(m), at(m) + m[0].length, +m[3], MONTHS[m[1].toLowerCase()], +m[2]);

    // Overlaps: keep the earliest, then the longest.
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    const out: DateHit[] = [];
    for (const h of hits) {
        const last = out[out.length - 1];
        if (last && h.start < last.end) continue;
        out.push(h);
    }
    return out;
}

/** Builds the local date; null when it does not exist (31.02.). Year missing: next occurrence from today. */
function toDate(hit: DateHit, now: Date): Date | null {
    const hour = hit.hour ?? 23;
    const minute = hit.minute ?? 59;
    const build = (year: number) => {
        const d = new Date(year, hit.month - 1, hit.day, hour, minute, 0, 0);
        return d.getMonth() === hit.month - 1 && d.getDate() === hit.day ? d : null;
    };
    if (hit.year !== null) return build(hit.year);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (let year = now.getFullYear(); year <= now.getFullYear() + 4; year++) {
        const d = build(year);
        if (d && d.getTime() >= todayStart) return d;
    }
    return null;
}

/** Copy of the text with every date replaced by "#", so date dots never end a sentence. */
function maskDates(text: string, hits: DateHit[]): string {
    let out = '';
    let pos = 0;
    for (const h of hits) {
        out += text.slice(pos, h.start) + '#'.repeat(h.end - h.start);
        pos = h.end;
    }
    return out + text.slice(pos);
}

function isBoundary(masked: string, i: number): boolean {
    const c = masked[i];
    if (c === '\n') return true;
    if (c !== '.' && c !== '!' && c !== '?' && c !== ';') return false;
    if (c === '.' && /\p{N}/u.test(masked[i - 1] ?? '')) return false; // "1. Aufgabe"
    const after = masked.slice(i + 1, i + 3);
    return after === '' || /^\s*\n/.test(after) || /^\s+[\p{Lu}"„(]/u.test(after);
}

function sentenceBounds(masked: string, start: number, end: number): [number, number] {
    let s = start;
    while (s > 0 && start - s < 400 && !isBoundary(masked, s - 1)) s--;
    let e = end;
    while (e < masked.length && e - end < 400 && !isBoundary(masked, e)) e++;
    if (e < masked.length && masked[e] !== '\n') e++; // keep the full stop
    return [s, e];
}

function findKeywords(text: string): KeywordHit[] {
    const enrol: KeywordHit[] = [...text.matchAll(RE_ENROL)].map(m => ({ start: at(m), end: at(m) + m[0].length, kind: 'enrolment' as const }));
    const exam: KeywordHit[] = [...text.matchAll(RE_EXAM)].map(m => ({ start: at(m), end: at(m) + m[0].length, kind: 'exam' as const }));
    const strong = [...enrol, ...exam];
    const overlaps = (k: KeywordHit) => strong.some(s => k.start < s.end && s.start < k.end);
    const deadline = [...text.matchAll(RE_DEADLINE)]
        .map(m => ({ start: at(m), end: at(m) + m[0].length, kind: 'deadline' as const }))
        .filter(k => !overlaps(k));
    return [...strong, ...deadline].sort((a, b) => a.start - b.start);
}

/** Nearest keyword inside [from, to] around the date span; one before the date wins ties. */
function nearestKeyword(keywords: KeywordHit[], from: number, to: number, dateStart: number, dateEnd: number): KeywordHit | null {
    let best: KeywordHit | null = null;
    let bestDist = Infinity;
    for (const k of keywords) {
        if (k.end <= from || k.start >= to) continue;
        let dist: number;
        if (k.end <= dateStart) dist = dateStart - k.end;
        else if (k.start >= dateEnd) dist = k.start - dateEnd + 10;
        else continue;
        if (dist < bestDist) { bestDist = dist; best = k; }
    }
    return best;
}

function shorten(sentence: string): string {
    const s = sentence.replace(/\s+/g, ' ').trim();
    return s.length <= SENTENCE_MAX ? s : s.slice(0, SENTENCE_MAX - 1).trimEnd() + '…';
}

function dayKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── Public API ────────────────────────────────────────────── */

export function hasDateLikeText(text: string): boolean {
    return RE_ANY_DATE.test(text);
}

/**
 * All deadlines in the text, at most one per (calendar day, kind), only
 * those still ahead of `now`. Never throws on odd input.
 */
export function parseDeadlines(input: string, now: Date = new Date()): FoundDeadline[] {
    if (!input) return [];
    const text = input.slice(0, MAX_SCAN_CHARS).replace(/[^\S\n]/g, ' ');
    if (!hasDateLikeText(text)) return [];

    const hits = collectDateHits(text);
    if (hits.length === 0) return [];
    const keywords = findKeywords(text);
    if (keywords.length === 0) return [];
    const masked = maskDates(text, hits);
    const nowMs = now.getTime();

    const byKey = new Map<string, FoundDeadline>();
    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        const next = hits[i + 1];
        // Range start: the end date carries the deadline.
        if (next && RE_RANGE_GAP.test(text.slice(hit.end, next.start))) continue;

        let anchor = hit.start;
        for (let j = i; j > 0 && RE_RANGE_GAP.test(text.slice(hits[j - 1].end, hits[j].start)); j--) anchor = hits[j - 1].start;

        const [sStart, sEnd] = sentenceBounds(masked, anchor, hit.end);
        const before = text.slice(Math.max(sStart, anchor - NEGATIVE_WINDOW), anchor);
        if (RE_NEGATIVE_BEFORE.test(before)) continue;

        const from = Math.max(sStart, anchor - WINDOW_BEFORE);
        const to = Math.min(sEnd, hit.end + WINDOW_AFTER);
        const kw = nearestKeyword(keywords, from, to, anchor, hit.end);
        if (!kw) continue;

        const due = toDate(hit, now);
        if (!due) continue;
        const dueMs = due.getTime();
        if (dueMs < nowMs || dueMs > nowMs + MAX_FUTURE_MS) continue;

        const found: FoundDeadline = {
            due,
            kind: kw.kind,
            sentence: shorten(text.slice(sStart, sEnd)),
            hasTime: hit.hour !== null,
        };
        const key = `${dayKey(due)}|${kw.kind}`;
        const prev = byKey.get(key);
        if (!prev || (!prev.hasTime && found.hasTime)) byKey.set(key, found);
        if (byKey.size >= MAX_RESULTS) break;
    }
    return [...byKey.values()].sort((a, b) => a.due.getTime() - b.due.getTime());
}
