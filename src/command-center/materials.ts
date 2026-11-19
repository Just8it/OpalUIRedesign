import type { EntryCategory, SearchResult, IndexNode } from '../core/search/types.ts';
import { parseQuery } from '../core/search/query.ts';
import { t } from '../i18n/messages/search.ts';

const chips = [['all', 'chipAll'], ['lecture', 'chipLecture'], ['exercise', 'chipExercise'], ['solution', 'chipSolution'], ['exam', 'chipExam'], ['video', 'chipVideo']] as const;
export function availableChips(results: SearchResult[]) {
    return chips.filter(([key]) => key === 'all' || results.some(r => r.node.category === key))
        .map(([key, label]) => [key, t(label)] as const);
}
export function selectedChip(query: string): string { return parseQuery(query).intent.category ?? 'all'; }
export function filterMaterials(results: SearchResult[], category: string) { return category === 'all' ? results : results.filter(r => r.node.category === category as EntryCategory); }
export function pairedSolution(node: IndexNode, nodes: IndexNode[]) { return node.solutionUrl ? nodes.find(n => n.url === node.solutionUrl) ?? { ...node, id: node.solutionUrl, url: node.solutionUrl, title: t('solution'), solutionUrl: undefined } : undefined; }
export function parseShortcut(query: string) { const match = query.trim().match(/^(.+?)\s+(neu|weiter)$/i); return match ? { course: match[1], action: match[2].toLowerCase() } : null; }
