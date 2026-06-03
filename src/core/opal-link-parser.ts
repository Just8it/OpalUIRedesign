export interface ExtractedCourseNodeLink {
    url: string;
    title: string;
}

export const FILE_EXTENSION_PATTERN = /\.(pdf|zip|docx?|pptx?|xlsx?|mp4|png|jpe?g|svg|csv|txt|7z|rar|html?|odt|ods|odp|md|json|xml|webm|mov)(\?|$)/i;
export const DOWNLOAD_EXTENSION_PATTERN = /\.(pdf|zip|docx?|pptx?|xlsx?|mp4|png|jpe?g|svg|csv|txt|7z|rar|odt|ods|odp|md|json|xml|webm|mov)(\?|$)/i;

export function inferExtensionFromUrl(url: string): string | undefined {
    const m = url.toLowerCase().match(/\.([a-z0-9]{2,5})(\?|$)/);
    return m ? m[1] : undefined;
}

export function inferExtensionFromName(name: string): string | undefined {
    const m = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    return m ? m[1] : undefined;
}

export function isDownloadUrl(url: string, includeHtml = false): boolean {
    if (!includeHtml) return DOWNLOAD_EXTENSION_PATTERN.test(url);
    if (!FILE_EXTENSION_PATTERN.test(url)) return false;
    return !/\.html?(\?|$)/i.test(url) || url.includes('FolderResource');
}

export function filenameFromUrl(url: string): string {
    try {
        const path = new URL(url, 'https://bildungsportal.sachsen.de').pathname;
        return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
    } catch {
        return '';
    }
}

export function cleanLinkTitle(text: string): string {
    return decodeEntities(text.replace(/\s+/g, ' ').trim());
}

export function readBestLinkTitle(
    attrs: Record<string, string | undefined>,
    textContent: string,
    href: string,
): string {
    return cleanLinkTitle(
        attrs['data-file-name']
        || attrs.download
        || attrs.title
        || attrs['aria-label']
        || textContent
        || filenameFromUrl(href)
    );
}

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function stripTags(html: string): string {
    return cleanLinkTitle(html.replace(/<[^>]*>/g, ' '));
}

function readAttrs(tag: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)) {
        attrs[match[1].toLowerCase()] = decodeEntities(match[3]);
    }
    return attrs;
}

function addUnique(
    links: ExtractedCourseNodeLink[],
    seen: Set<string>,
    url: string,
    title: string,
): void {
    const key = url.split('?')[0].replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ url, title: cleanLinkTitle(title) || key });
}

/** Extract CourseNode links from raw OPAL markup, including Wicket javascript/onClick payloads. */
export function extractCourseNodeLinksFromMarkup(html: string, courseUrl: string): ExtractedCourseNodeLink[] {
    const repoId = /\/RepositoryEntry\/(\d+)/i.exec(courseUrl)?.[1];
    if (!repoId) return [];

    const links: ExtractedCourseNodeLink[] = [];
    const seen = new Set<string>();
    const origin = (() => {
        try { return new URL(courseUrl).origin; } catch { return 'https://bildungsportal.sachsen.de'; }
    })();
    const courseNodeRe = new RegExp(`(?:\\/opal\\/auth)?\\/RepositoryEntry\\/${repoId}\\/CourseNode\\/(\\d+)`, 'ig');

    for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        const attrs = readAttrs(anchor[1]);
        const title = readBestLinkTitle(attrs, stripTags(anchor[2]), '');
        const payload = [
            attrs.href,
            attrs.onclick,
            attrs['data-url'],
            attrs['data-target'],
            attrs['data-href'],
            attrs['data-link'],
        ].filter(Boolean).join(' ');

        let decoded = payload;
        try { decoded = decodeURIComponent(payload); } catch { /* keep original */ }

        for (const match of decoded.matchAll(courseNodeRe)) {
            const fullUrl = `${origin}/opal/auth/RepositoryEntry/${repoId}/CourseNode/${match[1]}`;
            addUnique(links, seen, fullUrl, title);
        }
    }

    return links;
}
