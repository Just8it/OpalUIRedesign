import { KEYWORDS } from '../../course/find/classify.ts';
import type { EntryCategory } from './types.ts';
import { normalizeItemNumber } from './enrich.ts';
import { normalize, tokenize, semesters, stripSemesters } from './tokenizer.ts';
import type { Semester } from './tokenizer';
export interface QueryIntent { category?: EntryCategory; number?: string; rest: string[] }
export interface Query { intent: QueryIntent; tokens: string[]; constraints: Semester[]; type?: string; extension?: string; empty: boolean }
const extensions = new Set('pdf zip doc docx ppt pptx xls xlsx mp4 png jpg jpeg svg csv txt md 7z rar htm html odt ods odp json xml webm mov'.split(' '));
export function parseQuery(raw: string): Query {
    let text = normalize(raw.trim());
    const type = text.startsWith('/c ') ? 'course' : text.startsWith('/f ') ? 'file' : undefined;
    if (type) text = text.slice(3);
    let extension: string | undefined;
    text = text.replace(/\b(?:ext:|type:)([a-z0-9]+)\b/g, (_, ext: string) => { extension = ext; return ' '; });
    const constraints = semesters(text);
    text = stripSemesters(text);
    const tokens = tokenize(text).filter(t => {
        if (extensions.has(t)) { extension = t; return false; }
        return true;
    });
    const intent = parseIntent(text);
    intent.rest = intent.rest.filter(t => !extensions.has(t));
    return { intent, tokens, constraints, type, extension, empty: !raw.trim() || (!tokens.length && !constraints.length && !extension) };
}

export function parseIntent(raw: string): QueryIntent {
    const words = normalize(raw).replace(/\b(ue|vl|blatt|kap|v)(?=\d)/g, '$1 ').match(/[a-z]+[a-z0-9]*|\d+(?:\.\d+)*/g) ?? [];
    let category: EntryCategory | undefined;
    let number: string | undefined;
    const rest: string[] = [];
    for (const word of words) {
        const found = (['solution', 'exam', 'lecture', 'exercise'] as const).find(c => (KEYWORDS[c] as readonly string[]).includes(word))
            ?? (word === 'kap' ? 'lecture' : /^(video|videos|aufzeichnung|aufzeichnungen)$/.test(word) ? 'video' : undefined);
        if (found) { if (!category || found === 'solution') category = found; }
        else if (/^\d/.test(word) && number === undefined) number = normalizeItemNumber(word);
        else rest.push(word);
    }
    return { category, number, rest };
}
