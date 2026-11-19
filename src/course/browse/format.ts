import { localeTag } from '../../i18n/core.ts';

function createListFormats(tag: string) {
    const relative = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
    return {
        natural: new Intl.Collator(tag, { numeric: true, sensitivity: 'base' }),
        size: new Intl.NumberFormat(tag, { maximumSignificantDigits: 3, useGrouping: false }),
        date: new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric' }),
        today: relative.format(0, 'day'),
        yesterday: relative.format(-1, 'day'),
    };
}

// Reuse the formatters across list rows. The active locale is selected at render time.
const formats = new Map<string, ReturnType<typeof createListFormats>>();
function listFormats() {
    const tag = localeTag();
    const cached = formats.get(tag);
    if (cached) return cached;
    const local = createListFormats(tag);
    formats.set(tag, local);
    return local;
}
export const naturalCompare = (a: string, b: string): number => listFormats().natural.compare(a, b);

export function splitName(name: string): { head: string; tail: string } {
    if (name.length <= 24) return { head: name, tail: '' };
    let cut = name.length - 12;
    // Prefer a separator near the tail, keeping its following token intact.
    for (let i = cut; i >= name.length - 18; i--) {
        if (/[_\-. ]/.test(name[i])) { cut = i; break; }
    }
    // Without a separator, never cut a number or leave a tiny word fragment.
    if (!/[_\-. ]/.test(name[cut])) {
        const start = name.slice(0, cut).search(/[\p{L}\p{N}]+$/u);
        const end = name.slice(cut).match(/^[\p{L}\p{N}]+/u)?.[0] ?? '';
        if (start >= 0 && (/\d/.test(name[cut - 1]) && /\d/.test(name[cut]) || end.length < 4)) cut = start;
    }
    return { head: name.slice(0, cut), tail: name.slice(cut) };
}

export function formatSize(sizeText: string | undefined): { text: string; bytes?: number } {
    const match = sizeText?.trim().match(/^(\d+(?:[.,]\d+)?)\s*(bytes?|[kmgt]?i?b)$/i);
    if (!match) return { text: '' };
    const value = Number(match[1].replace(',', '.'));
    const unit = match[2].toUpperCase().replace(/^BYTES?$/, 'B');
    const exponent = ['B', 'KB', 'MB', 'GB', 'TB'].indexOf(unit.replace('I', ''));
    if (exponent < 0) return { text: '' };
    const rounded = Number(value.toPrecision(3));
    return { text: `${listFormats().size.format(rounded)} ${unit}`, bytes: value * 1024 ** exponent };
}

export function formatModified(ms: number | undefined, now: number): string {
    if (ms === undefined || !Number.isFinite(ms)) return '';
    const date = new Date(ms), today = new Date(now), yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const localized = listFormats();
    if (date.toDateString() === today.toDateString()) return localized.today;
    if (date.toDateString() === yesterday.toDateString()) return localized.yesterday;
    return localized.date.format(date);
}
