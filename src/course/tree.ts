import type { CourseNode, CourseNodeKind, CourseSection } from './types.ts';
import { t } from '../i18n/messages/course.ts';
import { plainText, safeFetchUrl } from './parsers.ts';

export function nodeKind(type: string): CourseNodeKind {
    const kinds: Record<string, CourseNodeKind> = { root: 'root', st: 'structure', bc: 'folder', sp: 'page', file: 'page', info: 'announcements', ll: 'links', bib: 'literature', cal: 'calendar', calendar: 'calendar' };
    return kinds[type] ?? 'interactive';
}

interface RawNode { id: string; text: string; icon: string; a_attr: { href: string }; children?: RawNode[] }

export function extractTree(html: string): CourseNode {
    const start = /\bvar\s+initial_data\s*=\s*/.exec(html);
    if (!start) throw new Error(t('treeMissing'));
    const offset = start.index + start[0].length;
    let depth = 0, quoted = false, escaped = false, end = offset;
    for (; end < html.length; end++) {
        const c = html[end];
        if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === '[') depth++;
        else if (c === ']' && --depth === 0) { end++; break; }
    }
    const raw = JSON.parse(html.slice(offset, end)) as RawNode[];
    function convert(n: RawNode): CourseNode {
        const rawType = /\bicon-([\w-]+)/.exec(n.icon)?.[1] ?? '';
        if (!safeFetchUrl(n.a_attr.href)) throw new Error(t('treeInvalidLink'));
        return { id: n.id.replace(/^id/, ''), title: plainText(n.text), kind: nodeKind(rawType), rawType, url: n.a_attr.href, children: (n.children ?? []).map(convert) };
    }
    return convert(raw[0]);
}

export function sectionTitle(section: Pick<CourseSection, 'title'> & Partial<Pick<CourseSection, 'kind' | 'rawType'>>): string {
    // The synthetic start-page section uses a stable title in snapshots and search data.
    return section.kind === 'page' && section.rawType === 'root' ? t('courseInfo') : section.title;
}

export function buildSections(tree: CourseNode): CourseSection[] {
    const sections: CourseSection[] = [];
    function visit(node: CourseNode, path: string[]) {
        if (node.kind !== 'root' && node.kind !== 'structure') sections.push({ nodeId: node.id, title: node.title, kind: node.kind, rawType: node.rawType, path, url: node.url, state: node.kind === 'interactive' ? 'native' : node.kind === 'calendar' ? 'empty' : 'pending', entries: [] });
        for (const child of node.children) visit(child, node.kind === 'root' ? path : [...path, node.title]);
    }
    visit(tree, []);
    return sections;
}
