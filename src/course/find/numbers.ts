import type { CourseEntry } from '../types.ts';
import { normalize, numberKey } from '../../core/search/tokenizer.ts';

export function itemNumber(entry: CourseEntry): number | undefined {
    const texts = [entry.title, entry.fileName ?? '', ...entry.folderPath];
    const clean = (s: string) => normalize(s)
        .replace(/\b(?:ws|wise|ss|sose)\s*\d+(?:[/_-]\d+)?\b/g, ' ')
        .replace(/\b\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b/g, ' ')
        .replace(/\b(?:version|ver|v)\s*\d+\.\d+(?:\.\d+)*\b/g, ' ')
        .replace(/\b20(?:2[4-9]|[3-9]\d)\b/g, ' ');
    for (const text of texts) {
        // A03/L03 are sheet identifiers; the digit in a module name such as aero1 is not.
        const m = clean(text).match(/(?:^|[^a-z0-9])(?:uebung|ue|vorlesung|vl|week|kapitel|v|blatt|uebungsblatt|serie|exercise|sheet|aufgabe|versuch|a|l)\s*[_-]?\s*(\d+)(?=$|[^a-z0-9])/);
        if (m) return Number(numberKey(m[1]));
    }
    for (const text of texts) {
        const m = clean(text).match(/(?:^|[^a-z0-9])(\d+)(?=$|[^a-z0-9])/);
        if (m) return Number(numberKey(m[1]));
    }
    return undefined;
}
