export function normalize(value: string): string {
    // WiSe/SoSe must survive the camelCase split, otherwise they read as "wi se".
    return value.replace(/\b(Wi|So)Se(?=\d|\b)/g, m => m.toLowerCase()).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
        .replace(/\u00e4/g, 'ae').replace(/\u00f6/g, 'oe').replace(/\u00fc/g, 'ue').replace(/\u00df/g, 'ss');
}

export function tokenize(value: string): string[] {
    return normalize(value).match(/[a-z0-9]+/g) ?? [];
}

/** Removes "ws 2025/26", "sose26", "2025/26" and "2025" from normalised text. */
export function stripSemesters(text: string): string {
    return text
        .replace(/\b(?:ws|wise|wintersemester|ss|sose|sommersemester)\s*(?:(?:20\d{2}|\d{2})(?:\s*[/_-]\s*\d{2,4})?)?\b/g, ' ')
        .replace(/\b20\d{2}(?:\s*[/_-]\s*\d{2,4})?\b/g, ' ');
}

export const numberKey = (value: string): string => String(Number(value));
/** Sheet-style numbers. Years and semester parts ("2026/27") are not counted. */
export function numbers(value: string): string[] {
    return [...new Set(tokenize(stripSemesters(normalize(value))).filter(t => /^\d+$/.test(t)).map(numberKey))];
}

const groups = ['vl vorlesung lecture', 'ue uebung uebungen exercise exercises', 'skript skripte script notes', 'folien slides', 'klausur exam exams pruefung'];
const aliasGroups = new Map(groups.flatMap(g => {
    const tokens = g.split(' ');
    return tokens.map(t => [t, tokens] as const);
}));
export function alternatives(token: string): string[] {
    return aliasGroups.get(token) ?? [token];
}

const stop = new Set('der die das und fuer von zur zum des the and of'.split(' '));
export function aliases(title: string): string[] {
    // Brackets hold module codes and semesters, not the name people abbreviate.
    const name = stripSemesters(normalize(title.replace(/\([^)]*\)?/g, ' ')));
    const tokens = (name.match(/[a-z0-9]+/g) ?? []).filter(t => !stop.has(t));
    const words = tokens.filter(t => !/^\d+$/.test(t));
    if (words.length < 2) return [];
    const acronym = words.map(t => t[0]).join('');
    const number = tokens.find(t => /^\d+$/.test(t));
    return [acronym, ...(number ? [acronym + numberKey(number)] : [])];
}

export interface Semester { kind?: string; year?: number }
export function semesters(value: string): Semester[] {
    const text = normalize(value);
    const found: Semester[] = [];
    const pattern = /\b(ws|wise|wintersemester|ss|sose|sommersemester)\s*(?:(20\d{2}|\d{2})(?:\s*[/_-]\s*\d{2,4})?)?\b/g;
    for (const m of text.matchAll(pattern)) {
        found.push({ kind: /^(ws|wise|winter)/.test(m[1]) ? 'winter' : 'summer', year: m[2] ? (Number(m[2]) < 100 ? 2000 + Number(m[2]) : Number(m[2])) : undefined });
    }
    for (const m of text.matchAll(/\b(20\d{2})(?:\s*\/\s*\d{2,4})?\b/g)) {
        if (!found.some(s => s.year === Number(m[1]))) found.push({ year: Number(m[1]) });
    }
    return found;
}

// Linear one-edit check includes adjacent transpositions without a distance matrix.
export function oneEdit(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (i === a.length) return b.length === a.length + 1;
    if (a.length === b.length) {
        return a.slice(i + 1) === b.slice(i + 1) ||
            (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    }
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

