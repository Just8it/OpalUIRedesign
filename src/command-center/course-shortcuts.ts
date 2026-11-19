import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import { families } from '../storage/registry.ts';

import type { IndexNode } from '../core/search/types.ts';
import { locate } from '../course/find/index.ts';
import { buildHome } from '../course/home/blocks.ts';
import { loadHome, loadProgress } from '../course/home/store.ts';
import { snapshotIndexNodes } from '../course/index-nodes.ts';

export const changedSinceVisit = (node: IndexNode, visit: number) => Math.max(node.firstSeenAt ?? 0, node.modified ?? 0) > visit;
/** Read-only: mirrors each visible home series' Jetzt dran entry. */
export async function continueCourse(courseId: string): Promise<IndexNode[]> {
    const id = /RepositoryEntry\/(\d+)/.exec(courseId)?.[1];
    if (!id) return [];
    const snapshot = await store.get(families.snapshot(id));
    if (!snapshot) return [];
    const located = locate(snapshot.sections);
    const [config, progress] = await Promise.all([loadHome(id, snapshot, located), loadProgress(id)]);
    const model = buildHome({ snapshot, located, config, progress, opened: {}, editing: false });
    const nodes = snapshotIndexNodes(snapshot);
    return model.blocks.flatMap(block => {
        const entry = block.kind === 'series' ? block.current?.entries[0] : undefined;
        const node = entry && nodes.find(n => n.url === entry.url);
        return node ? [node] : [];
    });
}

export async function courseLastVisit(courseId: string): Promise<number> {
    const id = /RepositoryEntry\/(\d+)/.exec(courseId)?.[1];
    if (!id) return 0;
    const index = await store.get(keys.snapshotIndex);
    return Number(index?.[id]) || 0;
}
