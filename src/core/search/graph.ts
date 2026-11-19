import { enrichNode } from './enrich.ts';
import type { IndexNode } from './types';
import { tokenize, numbers, aliases, semesters } from './tokenizer.ts';
import type { Semester } from './tokenizer';
export interface Derived {
    node: IndexNode; pathTitles: string[]; titleTokens: string[]; pathTokens: string[];
    titleNumbers: string[]; pathNumbers: string[]; primaryTitleNumber?: string;
    aliases: string[]; ownAliases: string[]; weakTokens: string[]; semesters: Semester[]; fileExtension?: string;
}
export function derive(node: IndexNode, nodes: Map<string, IndexNode>): Derived {
    const seen = new Set([node.id]);
    const path: IndexNode[] = [];
    let current = node.parentId ? nodes.get(node.parentId) : undefined;
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        path.unshift(current);
        current = current.parentId ? nodes.get(current.parentId) : undefined;
    }
    const course = nodes.get(node.courseId);
    if (course && !seen.has(course.id)) path.unshift(course);
    const pathTitles = path.map(n => n.title);
    const titleNumbers = numbers(node.title);
    return { node: enrichNode(node, { ancestorTitles: pathTitles }), pathTitles, titleTokens: tokenize(node.title), pathTokens: tokenize(pathTitles.join(' ')),
        titleNumbers, pathNumbers: numbers(pathTitles.join(' ')), primaryTitleNumber: titleNumbers[0],
        aliases: [...new Set([node, ...path].flatMap(n => aliases(n.title)))], ownAliases: aliases(node.title),
        weakTokens: tokenize([node.author, node.description].filter(Boolean).join(' ')),
        semesters: semesters([node, ...path].map(n => n.title + ' ' + (n.semester ?? '')).join(' ')),
        fileExtension: node.type === 'file' ? (node.fileExtension?.toLowerCase().replace(/^\./, '') ?? node.title.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()) : undefined };
}
