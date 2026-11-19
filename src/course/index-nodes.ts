import type { CourseSnapshot } from './types.ts';
import { locate, pairSolutions } from './find/index.ts';
import type { IndexNode } from '../core/search/types.ts';
import { classify } from './find/classify.ts';
import { enrichNode } from '../core/search/enrich.ts';
const indexId = (url: string) => { const u = new URL(url, 'https://bildungsportal.sachsen.de'); return (u.origin === 'https://bildungsportal.sachsen.de' ? (u.pathname + (/^\?\d+$/.test(u.search) ? '' : u.search)).replace(/\/$/, '') : u.href); };
export function snapshotIndexNodes(snap: CourseSnapshot): IndexNode[] {
    const courseId = indexId(snap.url), nodes = new Map<string, IndexNode>();
    const add = (id: string, title: string, url: string, type: IndexNode['type'], parentId: string | null) => {
        const node: IndexNode = { id, title, url, type, parentId, courseId, visitCount: 0, lastVisited: 0, source: 'user' };
        nodes.set(id, node); return node;
    };
    add(courseId, snap.title, snap.url, 'course', null);
    for (const section of snap.sections) {
        add(indexId(section.url), section.title, section.url, 'folder', courseId);
        for (const entry of section.entries) {
            let parent = indexId(section.url);
            for (const folder of entry.folderPath) {
                const id = parent + '/__folder/' + encodeURIComponent(folder);
                add(id, folder, section.url, 'folder', parent); parent = id;
            }
            const node = add(indexId(entry.url), entry.title, entry.url, 'file', parent);
            node.modified = entry.modified; node.fileExtension = entry.extension; node.category = classify(entry, section);
            Object.assign(node, enrichNode(node, { ancestorTitles: [snap.title, ...section.path, section.title, ...entry.folderPath], fileName: entry.fileName }));
        }
    }
    for (const pair of pairSolutions(locate(snap.sections))) if (pair.solution) {
        const node = nodes.get(indexId(pair.entry.url));
        if (node) node.solutionUrl = new URL(pair.solution.url, 'https://bildungsportal.sachsen.de').href;
    }
    return [...nodes.values()];
}
