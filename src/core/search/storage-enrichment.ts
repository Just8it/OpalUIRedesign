import { enrichNode } from './enrich.ts';
import type { IndexNode } from './types.ts';
/** Root-first context, including parents from the same unordered write batch. */
export async function enrichBatch(nodes: IndexNode[], get: (id: string) => Promise<IndexNode | undefined>): Promise<void> {
    const known = new Map(nodes.map(n => [n.id, n]));
    for (const node of nodes) {
        const titles: string[] = [], seen = new Set([node.id]);
        let id = node.parentId;
        while (id && !seen.has(id)) {
            seen.add(id);
            const parent = known.get(id) ?? await get(id);
            if (!parent) break;
            known.set(id, parent); titles.unshift(parent.title); id = parent.parentId;
        }
        if (node.type === 'file') Object.assign(node, enrichNode(node, { ancestorTitles: titles }));
    }
}
