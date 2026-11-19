import type { IndexNode, SearchIndex } from './types';
import type { Derived } from './graph';
import { derive } from './graph.ts';
import { parseQuery } from './query.ts';
import { scoreNode, rank, frecency } from './scorer.ts';
import { t } from '../../i18n/messages/search.ts';

export function createSearchIndex(): SearchIndex {
    const nodes = new Map<string, IndexNode>();
    const derived = new Map<string, Derived>();
    // Include course dependencies so broken parent chains are refreshed too.
    const dependents = new Map<string, Set<string>>();
    const dependencies = (n: IndexNode): string[] => [...new Set([n.parentId, n.courseId].filter((id): id is string => !!id && id !== n.id))];
    function unlink(n: IndexNode): void {
        for (const id of dependencies(n)) {
            const set = dependents.get(id);
            set?.delete(n.id);
            if (!set?.size) dependents.delete(id);
        }
    }
    function insert(n: IndexNode): void {
        nodes.set(n.id, { ...n });
        for (const id of dependencies(n)) {
            let children = dependents.get(id);
            if (!children) { children = new Set(); dependents.set(id, children); }
            children.add(n.id);
        }
    }
    function refresh(id: string): void {
        const seen = new Set<string>();
        const queue = [id];
        for (let i = 0; i < queue.length; i++) {
            const next = queue[i];
            if (seen.has(next)) continue;
            seen.add(next);
            const n = nodes.get(next);
            if (n) derived.set(next, derive(n, nodes));
            for (const child of dependents.get(next) ?? []) queue.push(child);
        }
    }
    return {
        setAll(all) {
            nodes.clear(); derived.clear(); dependents.clear();
            for (const n of all) { const old = nodes.get(n.id); if (old) unlink(old); insert(n); }
            for (const n of nodes.values()) derived.set(n.id, derive(n, nodes));
        },
        upsert(n) {
            const old = nodes.get(n.id);
            if (old) unlink(old);
            insert(n);
            if (!old || old.title !== n.title || old.parentId !== n.parentId || old.courseId !== n.courseId || old.semester !== n.semester) refresh(n.id);
            else derived.set(n.id, derive({ ...n }, nodes));
        },
        remove(id) { const n = nodes.get(id); if (n) unlink(n); nodes.delete(id); derived.delete(id); refresh(id); },
        clear() { nodes.clear(); derived.clear(); dependents.clear(); },
        get(id) { const n = nodes.get(id); return n ? { ...n } : undefined; },
        size() { return nodes.size; },
        search(raw, options = {}) {
            const q = parseQuery(raw);
            if (q.empty) return [];
            const hits = [];
            for (const d of derived.values()) {
                if (options.courseId && d.node.courseId !== options.courseId) continue;
                if (options.excludeCatalog && d.node.source === 'catalog') continue;
                const hit = scoreNode(d, q, options);
                if (hit) hits.push(hit);
            }
            // Partial matches (negative score) are only worth showing when nothing matches fully.
            const full = hits.filter(h => h.score > 0);
            return rank(full.length ? full : hits, options.limit ?? 8).map(hit => ({ ...hit }));
        },
        recents(limit = 8, now = Date.now()) {
            const hits = [];
            for (const d of derived.values()) {
                if (d.node.visitCount <= 0 || d.node.lastVisited <= 0) continue;
                const score = frecency(d.node, now);
                hits.push({ node: { ...d.node }, path: [...d.pathTitles], score, explanation: [] });
            }
            return rank(hits, limit).map(hit => ({
                ...hit,
                explanation: [t('scoreFrecency', { count: hit.node.visitCount, score: String(hit.score) })],
            }));
        },
    };
}
