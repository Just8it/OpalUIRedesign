import { alternatives, normalize, numberKey, oneEdit, tokenize } from '../../core/search/tokenizer.ts';
import type { EntryCategory, FindHit, Located } from './types.ts';

const scopes: Record<string, EntryCategory> = { ue: 'exercise', u: 'exercise', uebung: 'exercise', exercise: 'exercise', vl: 'lecture', v: 'lecture', vorlesung: 'lecture', lecture: 'lecture', loesung: 'solution', lsg: 'solution', l: 'solution', solution: 'solution', k: 'exam', klausur: 'exam', pruefung: 'exam' };
interface Word { text: string; start: number; end: number }
function words(text: string): Word[] {
    let folded = '';
    const starts: number[] = [], ends: number[] = [];
    for (let i = 0; i < text.length; i++) {
        if (i && /[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i])) {
            folded += ' '; starts.push(i); ends.push(i);
        }
        const part = normalize(text[i]);
        folded += part;
        for (let j = 0; j < part.length; j++) { starts.push(i); ends.push(i + 1); }
    }
    return [...folded.matchAll(/[a-z]+|\d+/g)].map(m => ({ text: m[0], start: starts[m.index], end: ends[m.index + m[0].length - 1] }));
}
const cache = new WeakMap<Located, { signature: string; fields: Word[][] }>();
function fields(item: Located): Word[][] {
    const texts = [item.entry.title, item.entry.fileName ?? '', item.entry.folderPath.join(' '), item.section.title + ' ' + item.section.path.join(' ')];
    const signature = texts.join('\0');
    const previous = cache.get(item);
    if (previous?.signature === signature) return previous.fields;
    const result = texts.map(words);
    cache.set(item, { signature, fields: result });
    return result;
}
export function find(located: Located[], query: string, scope: EntryCategory | 'all' = 'all'): FindHit[] {
    const tokens = tokenize(query).flatMap(t => t.match(/^([a-z]+)(\d+)$/)?.slice(1) ?? [t]);
    if (!tokens.length) return scope === 'all' ? [] : located.filter(i => i.category === scope).map(i => ({ ...i, score: 1, titleRanges: [] }));
    if (tokens.some(t => t.length === 1 && !scopes[t] && !/^\d$/.test(t))) return [];
    const hits: FindHit[] = [];
    for (const item of located) {
        if (scope !== 'all' && item.category !== scope) continue;
        const source = fields(item);
        let score = 0;
        const ranges: [number, number][] = [];
        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index], category = scopes[token];
            const numeric = /^\d+$/.test(token);
            let best = numeric && item.number === Number(numberKey(token)) ? 110 : category === item.category ? 85 : 0;
            let range: Word | undefined;
            // Prefer the numbered label over a coincidental earlier number.
            const ownNumber = numeric && item.number === Number(numberKey(token))
                ? source[0].find((word, i, title) => numberKey(word.text) === numberKey(token)
                    && /^(uebung|ue|vorlesung|vl|week|kapitel|kap|v|blatt|uebungsblatt|serie|exercise|sheet|aufgabe|versuch)$/.test(title[i - 1]?.text ?? ''))
                : undefined;
            for (let field = 0; field < source.length; field++) for (const word of source[field]) {
                let value = 0;
                if (numeric) {
                    if (/^\d+$/.test(word.text) && numberKey(word.text) === numberKey(token) && !(Number(token) >= 2024 && Number(token) <= 2099)) value = item.number === Number(token) ? 110 : 12;
                } else if (word.text === token) value = field === 0 ? 100 : field === 1 ? 85 : 65;
                else if (alternatives(token).includes(word.text) || (category && scopes[word.text] === category)) value = field === 0 ? 92 : 64;
                else if (token.length >= 2 && index === tokens.length - 1 && word.text.startsWith(token)) value = field === 0 ? 82 : 55;
                else if (token.length >= 4 && oneEdit(token, word.text)) value = 35;
                else if (token.length >= 4 && word.text.includes(token)) value = 20;
                // Retain one title occurrence per token, including semantic ties.
                if (field === 0 && value > 0 && !range) range = word;
                if (value > best) best = value;
            }
            if (!best) { score = 0; break; }
            score += best + (category === item.category ? 35 : 0);
            const matched = ownNumber ?? range;
            if (matched) ranges.push([matched.start, matched.end]);
        }
        if (score) {
            const merged: [number, number][] = [];
            for (const range of ranges.sort((a, b) => a[0] - b[0])) {
                const last = merged[merged.length - 1];
                if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
                else merged.push([...range]);
            }
            hits.push({ ...item, score, titleRanges: merged });
        }
    }
    return hits.sort((a, b) => b.score - a.score || Number(b.entry.isNew) - Number(a.entry.isNew));
}
