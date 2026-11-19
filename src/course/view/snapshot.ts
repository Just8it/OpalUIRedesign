/* Owns snapshot rendering and helpers. */

import type { CourseNode, CourseSection, CourseSnapshot } from '../types.ts';

/** Everything that decides what the find layer sees. */
export function entriesSignature(sections: CourseSection[]): string {
    let sig = '';
    for (const s of sections) {
        sig += `\n${s.nodeId}|${s.state}|${s.title}|${s.canUpload ? 1 : 0}|${JSON.stringify(s.error) ?? ''}|${s.entries.length}`;
        for (const e of s.entries)
            sig += `|${e.url}:${e.title}:${e.fileName ?? ''}:${e.sizeText ?? ''}:${e.modified ?? ''}:${e.isNew ? 1 : 0}:${e.folderPath.join('>')}`;
    }
    return sig;
}

export function nodeIds(snap: CourseSnapshot): string[] {
    const ids = new Set<string>();
    const walk = (n: CourseNode) => {
        ids.add(n.id);
        for (const c of n.children ?? []) walk(c);
    };
    if (snap.tree) walk(snap.tree);
    for (const s of snap.sections) ids.add(s.nodeId);
    return [...ids];
}

export { snapshotIndexNodes } from '../index-nodes.ts';
