import { tokenize } from '../../core/search/tokenizer.ts';
import { KEYWORDS } from './classify.ts';
import type { Located, PairedEntry } from './types.ts';

export function pairSolutions(located: Located[]): PairedEntry[] {
    const used = new Set<Located>();
    const pairs = new Map<Located, Located>();
    const base = (i: Located) => tokenize(i.entry.title).filter(t => !(KEYWORDS.solution as readonly string[]).includes(t)).join(' ');
    for (const solution of located.filter(i => i.category === 'solution')) {
        const same = (i: Located) => i.section.nodeId === solution.section.nodeId && (solution.number !== undefined ? i.number === solution.number : i.number === undefined && base(i) === base(solution));
        const candidates = located.filter(i => (i.category === 'exercise' || i.category === 'exam') && same(i));
        if (candidates.length === 1 && located.filter(i => i.category === 'solution' && same(i)).length === 1) {
            pairs.set(candidates[0], solution); used.add(solution);
        }
    }
    return located.filter(i => !used.has(i)).map(i => ({ ...i, ...(pairs.has(i) ? { solution: pairs.get(i)?.entry } : {}) }));
}
