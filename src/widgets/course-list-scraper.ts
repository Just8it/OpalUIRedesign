import type { CourseItem } from '../types';

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function stripTags(html: string): string {
    return decodeEntities(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function readAttr(tag: string, name: string): string {
    const pattern = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
    return decodeEntities(pattern.exec(tag)?.[2] ?? '');
}

/** Parse OPAL's list-group course links from a portlet HTML fragment. */
export function parseCourseListItems(
    html: string,
    type: CourseItem['type'],
    detectModuleCode: boolean,
): CourseItem[] {
    const items: CourseItem[] = [];
    const liMatches = html.matchAll(/<li\b[^>]*class=["'][^"']*list-group-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi);

    for (const li of liMatches) {
        const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(li[1]);
        if (!anchor) continue;

        const title = readAttr(anchor[1], 'title') || stripTags(anchor[2]);
        const href = readAttr(anchor[1], 'href') || '#';
        if (!title) continue;

        const moduleMatch = detectModuleCode ? title.match(/\b([A-Z]{2,}-[A-Z0-9-]+)\b/) : null;
        items.push({
            title,
            href,
            type,
            moduleCode: moduleMatch ? moduleMatch[1] : null,
        });
    }

    return items;
}
