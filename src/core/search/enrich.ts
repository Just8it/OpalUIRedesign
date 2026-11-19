import { classify } from '../../course/find/classify.ts';
import { itemNumber } from '../../course/find/numbers.ts';
import type { IndexNode } from './types.ts';
import { normalize } from './tokenizer.ts';
export interface EnrichmentContext { ancestorTitles?: readonly string[]; fileName?: string }
/** Chapter components are integers, not a decimal fraction. */
export function normalizeItemNumber(value: string): string {
    return value.replace(/\.$/, '').split('.').map(part => String(Number(part))).join('.');
}
export function enrichNode(node: IndexNode, context: EnrichmentContext = {}): IndexNode {
    const ancestors = [...(context.ancestorTitles ?? [])].reverse();
    const entry = { title: node.title, fileName: context.fileName, url: node.url,
        kind: 'file' as const, extension: node.fileExtension, folderPath: ancestors,
        external: false, firstSeen: 0, isNew: false };
    const section = { nodeId: '', title: '', path: [], kind: 'folder' as const,
        rawType: '', url: '', state: 'loaded' as const, entries: [] };
    const texts = [node.title, context.fileName ?? '', ...ancestors];
    let category = node.category ?? classify({ ...entry, folderPath: [] }, section);
    if (category === 'other' && node.category === undefined) {
        for (const title of ancestors) {
            category = classify({ ...entry, title, fileName: undefined, folderPath: [] }, section);
            if (category !== 'other') break;
        }
    }
    if (category === 'other' && node.category === undefined) {
        if (texts.some(t => /(?:^|[^a-z0-9])(?:video|videos|aufzeichnung|aufzeichnungen)(?:$|[^a-z0-9])/.test(normalize(t)))) category = 'video';
        else if (texts.some(t => /(?:^|[^a-z0-9])kap[_ -]*\d/.test(normalize(t)))) category = 'lecture';
    }
    const chapter = texts.map(t => normalize(t).match(/(?:^|[^a-z0-9])kap(?:itel)?[_ -]*(\d+\.\d+(?:\.\d+)*)(?=$|\.[a-z]|[^a-z0-9.])/)).find(Boolean)?.[1];
    const number = itemNumber({ ...entry, folderPath: [] }) ?? itemNumber(entry);
    return { ...node, category, itemNumber: node.itemNumber !== undefined ? normalizeItemNumber(node.itemNumber)
        : chapter ? normalizeItemNumber(chapter) : number !== undefined ? String(number) : undefined };
}
