import type { SearchOptions, SearchResult, IndexNode } from './types';
import type { Derived } from './graph';
import type { Query } from './query';
import { alternatives, numberKey, oneEdit } from './tokenizer.ts';
import type { Params } from '../../i18n/core.ts';
import { t } from '../../i18n/messages/search.ts';

type MessageKey = Parameters<typeof t>[0];

export function scoreNode(d: Derived, q: Query, options: SearchOptions): SearchResult | undefined {
    const { node } = d;
    if ((q.type && node.type !== q.type) || (q.extension && d.fileExtension !== q.extension)) return;
    let score = 0;
    let matched = 0;
    const steps: [key: MessageKey, weight: number, params?: Params][] = [];
    const add = (key: MessageKey, weight: number, params?: Params): void => {
        score += weight;
        steps.push([key, weight, params]);
    };
    const semantic = q.intent.category !== undefined || q.intent.number?.includes('.');
    const tokens = semantic ? q.intent.rest : q.tokens;
    let intentCount = 0;
    if (semantic) {
        if (q.intent.category) {
            intentCount++;
            const hit = node.category === q.intent.category;
            if (hit) matched++;
            add(hit ? 'scoreCategoryMatch' : 'scoreCategoryMismatch', hit ? 600 : -600, { category: q.intent.category });
        }
        if (q.intent.number !== undefined) {
            intentCount++;
            const hit = node.itemNumber === q.intent.number;
            if (hit) matched++;
            add(hit ? 'scoreItemMatch' : 'scoreItemMismatch', hit ? 900 + (d.primaryTitleNumber === q.intent.number ? 100 : 0) : -1200, { number: q.intent.number });
        }
    }
    for (const [i, token] of tokens.entries()) {
        let weight = 0;
        let label: MessageKey = 'scoreMissingToken';
        const offer = (value: number, reason: MessageKey): void => { if (value > weight) { weight = value; label = reason; } };
        if (/^\d+$/.test(token)) {
            const n = numberKey(token);
            if (d.primaryTitleNumber === n) offer(420, 'scorePrimaryNumber');
            else if (d.titleNumbers.includes(n)) offer(100, 'scoreSecondaryNumber');
            else if (d.pathNumbers.includes(n)) offer(80, 'scorePathNumber');
            if (!weight) add('scoreMissingNumber', -180, { number: n });
        } else {
            if (d.titleTokens.includes(token)) offer(180, 'scoreTitleToken');
            if (weight < 180) {
                // The abbreviated thing itself outranks everything that merely sits inside it.
                if (d.ownAliases.includes(token)) offer(160, 'scoreGeneratedAlias');
                else if (d.aliases.includes(token)) offer(115, 'scorePathAlias');
                const alts = alternatives(token);
                if (alts.some(t => t !== token && (d.titleTokens.includes(t) || d.pathTokens.includes(t)))) offer(160, 'scoreAcademicAlias');
                if (d.pathTokens.includes(token)) offer(120, 'scorePathToken');
                const last = i === tokens.length - 1;
                if (d.titleTokens.some(t => t.startsWith(token))) offer(last ? 170 : 110, 'scoreTitlePrefix');
                if (d.pathTokens.some(t => t.startsWith(token))) offer(last ? 110 : 90, 'scorePathPrefix');
                if (token.length >= 4) {
                    if (weight < 60 && (d.titleTokens.some(t => oneEdit(token, t)) || d.pathTokens.some(t => oneEdit(token, t)))) offer(60, 'scoreTypo');
                    if (weight < 40 && (d.titleTokens.some(t => t.includes(token)) || d.pathTokens.some(t => t.includes(token)))) offer(40, 'scoreSubstring');
                }
                if (d.weakTokens.some(t => t === token || t.startsWith(token))) offer(20, 'scoreAuthorDescription');
            }
        }
        if (weight) matched++;
        add(label, weight, { token });
    }
    for (const constraint of q.constraints) {
        const hit = d.semesters.some(s => (!constraint.kind || s.kind === constraint.kind) && (!constraint.year || s.year === constraint.year));
        if (hit) matched++;
        add('scoreSemesterConstraint', hit ? 120 : -120);
    }
    if (semantic) for (const token of q.tokens) {
        if (!tokens.includes(token) && !/^\d+$/.test(token) && d.titleTokens.includes(token)) add('scoreIntentToken', 30, { token });
    }
    const count = tokens.length + q.constraints.length + intentCount;
    if (!matched && count) return;
    // A full match always beats partial coverage, regardless of query length.
    add('scoreCoverage', matched === count ? (count + 1) * 500 : -(count + 1) * 500);
    if (q.extension) add('scoreExtension', 12);
    const now = options.now ?? Date.now();
    let context = 0;
    const contextAdd = (key: MessageKey, weight: number): void => {
        context += weight;
        steps.push([key, weight]);
    };
    if (options.activeCourseId && node.courseId === options.activeCourseId) contextAdd('scoreActiveCourse', 8);
    if (node.type === 'file') contextAdd('scoreFilePreference', 4);
    if (node.visitCount > 0 && node.lastVisited > 0) {
        const age = Math.max(0, now - node.lastVisited);
        if (age < 86400000) contextAdd('scoreVisitDay', 2);
        else if (age < 7 * 86400000) contextAdd('scoreVisitWeek', 1);
        contextAdd('scoreVisitCount', Math.min(1, Math.log1p(node.visitCount) / 10));
    }
    const date = new Date(now);
    const month = date.getUTCMonth();
    const summer = month >= 3 && month <= 8;
    const year = date.getUTCFullYear() - (month < 3 ? 1 : 0);
    if (d.semesters.some(s => s.kind === (summer ? 'summer' : 'winter') && s.year === year)) contextAdd('scoreCurrentSemester', 2);
    if (node.source === 'catalog' && node.visitCount === 0) contextAdd('scoreCatalogOnly', -1);
    add('scoreContextTotal', Math.max(-1, Math.min(9, context)));
    return {
        node: { ...node }, path: [...d.pathTitles], score,
        // Only the ranked results need translated explanation text.
        get explanation() {
            return steps.map(([key, weight, params]) => t(key, { ...params, weight: `${weight >= 0 ? '+' : ''}${weight}` }));
        },
    };
}

export function frecency(node: IndexNode, now: number): number {
    return Math.log2(1 + node.visitCount) / (1 + Math.max(0, now - node.lastVisited) / (7 * 86400000));
}

export function rank(results: SearchResult[], limit: number): SearchResult[] {
    results.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.node.title.localeCompare(b.node.title) || a.node.id.localeCompare(b.node.id));
    const seen = new Set<string>();
    return results.filter(r => {
        const key = r.node.url.split('?')[0].replace(/\/+$/, '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, Math.max(0, limit));
}
