import type { CourseAnnouncement, CourseEntry } from './types.ts';

export function plainText(html: string): string {
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ndash: '–', mdash: '—' };
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, key: string) => {
        if (!key.startsWith('#')) return entities[key] ?? all;
        const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }).replace(/\s+/g, ' ').trim();
}

export function attrs(tag: string): Record<string, string> {
    return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m => [m[1].toLowerCase(), plainText(m[3])]));
}

export function safeFetchUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return u.origin === 'https://bildungsportal.sachsen.de' && u.pathname.startsWith('/opal/') && !u.username && !u.password && !u.hash && !/[?&]\d+-\d+\./.test(url) && !/logout|signout|delete|unsubscribe|action|ical|calendarfeed/i.test(url);
    } catch { return false; }
}

export function parseDate(text: string): number | undefined {
    const numeric = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:.*?(\d{1,2}):(\d{2}))?/);
    if (numeric) return new Date(+numeric[3], +numeric[2] - 1, +numeric[1], +(numeric[4] ?? 0), +(numeric[5] ?? 0)).getTime();
    const m = text.toUpperCase().match(/(\d{1,2})\s+(JAN|FEB|MÄR|MAR|MRZ|APR|MAI|MAY|JUN|JUL|AUG|SEP|OKT|OCT|NOV|DEZ|DEC)\.?\s+(\d{4})/);
    const months: Record<string, number> = { JAN: 0, FEB: 1, MÄR: 2, MAR: 2, MRZ: 2, APR: 3, MAI: 4, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OKT: 9, OCT: 9, NOV: 10, DEZ: 11, DEC: 11 };
    return m ? new Date(+m[3], months[m[2]], +m[1]).getTime() : undefined;
}

function anchors(html: string): Record<string, string>[] {
    return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({ ...attrs(m[1]), text: plainText(m[2]) }));
}

export function parseLinks(html: string, base: string, folderPath: string[] = []): CourseEntry[] {
    const entries = new Map<string, CourseEntry>();
    for (const a of anchors(html)) {
        if (!a.href || /^(#|mailto:|javascript:|data:|tel:)/i.test(a.href)) continue;
        let u: URL;
        try { u = new URL(a.href.trim(), base); } catch { continue; }
        if (!/^https?:$/.test(u.protocol) || /[?&]\d+-\d+\.|logout|ical|calendarfeed/i.test(u.href)) continue;
        u.hash = '';
        const fileName = (() => { try { return decodeURIComponent(u.pathname.split('/').pop() ?? '').replace(/\+/g, ' '); } catch { return ''; } })();
        const extension = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1].toLowerCase();
        const external = u.origin !== 'https://bildungsportal.sachsen.de';
        const kind = /(^|\.)(videocampus\.sachsen\.de|youtube\.com|youtu\.be|vimeo\.com|panopto\.com)$/.test(u.hostname) ? 'video' : extension && (!external || /^(pdf|zip|docx?|pptx?|xlsx?|mp4)$/i.test(extension)) ? 'file' : 'link';
        const label = a['data-file-name'] || a.text || a.title;
        const old = entries.get(u.href);
        if (old && (!label || old.title !== old.fileName)) continue;
        entries.set(u.href, { kind, title: label || fileName || u.hostname, fileName, extension: kind === 'file' ? extension : undefined, url: u.href, external, folderPath: [...folderPath], firstSeen: 0, isNew: false });
    }
    return [...entries.values()];
}

/**
 * OPAL opens a subfolder through a Wicket click listener on the row's link;
 * a plain GET of the row's href just returns the parent listing again.
 * Returns anchor id -> listener url for the folder-row links of this page.
 * Only the row-link listener of this very node is accepted, nothing else.
 */
export function folderClickUrls(html: string, nodeUrl: string): Map<string, string> {
    const found = new Map<string, string>();
    let nodePath: string;
    try { nodePath = new URL(nodeUrl).pathname; } catch { return found; }
    for (const m of html.matchAll(/Wicket\.Ajax\.ajax\(\{"u":"([^"]+)","c":"([^"]+)"/g)) {
        let u: URL;
        try { u = new URL(m[1].replace(/\\\//g, '/'), nodeUrl); } catch { continue; }
        if (u.origin !== 'https://bildungsportal.sachsen.de' || u.pathname !== nodePath) continue;
        if (!/^\?\d+-\d+\.\d+-[\w-]*-tableRow-\d+-[\w-]*-tableLink$/.test(u.search)) continue;
        found.set(m[2], u.href);
    }
    return found;
}

/**
 * Folder tables show 20 rows per page. "Gehe zur nächsten Seite" is a plain
 * link to a Wicket listener of this node; following it returns the same folder
 * on its next page. Nothing but that pager link is accepted.
 */
export function nextPageUrl(html: string, nodeUrl: string): string | undefined {
    let nodePath: string;
    try { nodePath = new URL(nodeUrl).pathname; } catch { return undefined; }
    for (const a of anchors(html)) {
        if (!/nächsten Seite/.test(a.title ?? '') || a['aria-disabled'] === 'true' || !a.href) continue;
        let u: URL;
        try { u = new URL(a.href, nodeUrl); } catch { continue; }
        if (u.origin !== 'https://bildungsportal.sachsen.de' || u.pathname !== nodePath) continue;
        if (/^\?\d+-\d+\.-[\w-]*-pager-nextItem-next$/.test(u.search)) return u.href;
    }
    return undefined;
}

export function parseFolder(html: string, base: string, folderPath: string[] = []) {
    const entries: CourseEntry[] = [];
    const folders: { url: string; title: string; clickUrl?: string }[] = [];
    const root = base.split('?')[0].replace(/\/$/, '') + '/';
    const clicks = folderClickUrls(html, base.split('?')[0]);
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const links = parseLinks(row[1], base, folderPath).filter(e => e.url.startsWith(root));
        const anchorId = attrs(row[1].match(/<a\b[^>]*data-file-name[^>]*>/i)?.[0] ?? '').id;
        for (const entry of links) {
            if (/icon-folder\b|title=["']Ordner["']/i.test(row[1])) folders.push({ url: entry.url, title: entry.title, clickUrl: anchorId ? clicks.get(anchorId) : undefined });
            else {
                entry.kind = 'file';
                entry.sizeText = plainText(row[1]).match(/\d+(?:[,.]\d+)?\s*(?:Bytes?|[KMGT]?B)\b/i)?.[0];
                entry.modified = parseDate(plainText(row[1]));
                entries.push(entry);
            }
        }
    }
    const paging = anchors(html).filter(a => /Seite\s+\d+|zur nächsten Seite|zur letzten Seite/.test(a.title ?? '') && a['aria-current'] !== 'page' && a['aria-disabled'] !== 'true');
    const pages = paging.flatMap(a => { try { const url = new URL(a.href, base).href; return safeFetchUrl(url) ? [url] : []; } catch { return []; } });
    // "Sie dürfen Dateien hochladen." plus the upload button mark a hand-in folder.
    const canUpload = /Sie d(?:ü|&uuml;)rfen Dateien hochladen|title=["']Datei hochladen["']/.test(html);
    return { entries, folders, pages, canUpload, incomplete: paging.some(a => { try { return !a.href || !safeFetchUrl(new URL(a.href, base).href); } catch { return true; } }) };
}

export function parseFrameUrl(html: string, base: string): string | undefined {
    for (const m of html.matchAll(/<iframe\b([^>]*)>/gi)) {
        const src = attrs(m[1]).src;
        try { const url = new URL(src, base).href; if (safeFetchUrl(url) && new URL(url).pathname.startsWith('/opal/FolderResource/')) return url; } catch { /* Ignore malformed frames. */ }
    }
}

/* ── Lecturer pages (OPAL "Einzelseite") ──
 * A page is the lecturer's own HTML: schedules, contacts, notices. It is
 * kept as a small, safe subset so the course view can show it in its own
 * type and colours. Allowlist only: unknown tags lose their markup but keep
 * their text, scripts and embeds go with their content, and no attribute
 * survives except links, table spans, list starts and same-site images.
 * Inline colours are dropped (they were written for OPAL's white page and
 * made text unreadable in dark mode); a block that had a background is
 * kept as a notice (class "is-note"), because that is what it meant. */
const KEEP = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'code', 'pre', 'blockquote', 'a', 'span', 'div', 'img', 'figure', 'figcaption']);
const VOID = new Set(['br', 'hr', 'img']);
const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tagAttrs(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of raw.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) out[m[1].toLowerCase()] = plainText(m[2] ?? m[3] ?? m[4] ?? '');
    return out;
}

export interface PageContent { html: string; truncated: boolean }

export function sanitizePage(source: string, base: string, limit = 60000): PageContent {
    let html = source.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? source;
    html = html.replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|noscript|template|iframe|object|embed|svg|math|head|title|textarea|select|button|form|video|audio|canvas)\b[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<\/?(script|style|iframe|object|embed|link|meta|base|frame|frameset)\b[^>]*>/gi, '')
        .replace(/<![^>]*>|<\?[^>]*>/g, '');
    let out = '', truncated = false;
    for (const part of html.split(/(<\/?[a-zA-Z][^>]*>)/)) {
        if (out.length > limit) { truncated = true; break; }
        const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)>$/.exec(part);
        if (!tag) { out += part.replace(/</g, '&lt;').replace(/>/g, '&gt;'); continue; }
        const [, closing, rawName, rest] = tag;
        const name = rawName.toLowerCase();
        if (!KEEP.has(name)) continue;
        if (closing) {
            if (!VOID.has(name)) out += name === 'table' ? '</table></div>' : `</${name}>`;
            continue;
        }
        const a = tagAttrs(rest.replace(/\/\s*$/, ''));
        let attrs = '';
        if (name === 'a') {
            try {
                const u = new URL(a.href ?? '', base);
                if (/^https?:$/.test(u.protocol)) attrs = ` href="${escAttr(u.href)}" data-url="${escAttr(u.href)}" target="_blank" rel="noopener noreferrer"`;
                else if (u.protocol === 'mailto:') attrs = ` href="${escAttr(u.href)}"`;
            } catch { /* A link without a usable target stays plain text. */ }
        } else if (name === 'img') {
            try {
                const u = new URL(a.src ?? '', base);
                if (u.origin !== 'https://bildungsportal.sachsen.de' || !u.pathname.startsWith('/opal/')) continue;
                attrs = ` src="${escAttr(u.href)}" alt="${escAttr(a.alt ?? '')}" loading="lazy"`;
            } catch { continue; }
        } else if (name === 'td' || name === 'th') {
            for (const key of ['colspan', 'rowspan']) if (/^\d{1,2}$/.test(a[key] ?? '') && a[key] !== '1') attrs += ` ${key}="${a[key]}"`;
        } else if (name === 'ol' && /^\d{1,4}$/.test(a.start ?? '')) attrs = ` start="${a.start}"`;
        else if ((name === 'div' || name === 'p') && /background(?:-color)?\s*:\s*(?!\s*(?:transparent|none|#fff\b|#ffffff\b|white\b|inherit))/i.test(a.style ?? '')) attrs = ' class="is-note"';
        out += name === 'table' ? `<div class="opal-course-doc-scroll"><table${attrs}>` : `<${name}${attrs}>`;
    }
    // Lecturers space their pages with empty paragraphs and runs of <br>; the stylesheet spaces it instead.
    out = out.replace(/<(p|div|span|strong|b)>(?:\s|&nbsp;|&#160;|<br>)*<\/\1>/gi, '').replace(/(?:<br>\s*){3,}/gi, '<br><br>').trim();
    return { html: out, truncated };
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();

/** Lecturer pages often open with the course name ("Aerodynamik, Wintersemester 2026/2027"),
 *  which the course header already shows. A short first block that only says that is dropped. */
export function withoutTitleLine(html: string, courseTitle: string): string {
    const first = /^\s*<(h[1-6]|p|div|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html);
    if (!first || !courseTitle) return html;
    const text = fold(plainText(first[2])), title = fold(courseTitle);
    return title && text.startsWith(title) && text.length <= title.length + 40 ? html.slice(first[0].length).trimStart() : html;
}

/** One calm line for a collapsed page: plain text, title line removed, cut at a word with "…". */
export function pageExcerpt(html: string, courseTitle: string, max = 160): string {
    const text = plainText(withoutTitleLine(html, courseTitle));
    if (text.length <= max) return text;
    const cut = text.slice(0, max), space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, '')}…`;
}

/** Enough to be worth a block on the overview: a table, or a few lines of text. */
export function isRichPage(html: string | undefined): boolean {
    return !!html && (/<table\b/i.test(html) || plainText(html).length >= 280);
}

export function parseAnnouncements(html: string, url: string): CourseAnnouncement[] {
    return html.split(/<div\b[^>]*class=["']box box-neutral["'][^>]*>/i).slice(1).flatMap(block => {
        const title = plainText(block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? '');
        if (!title) return [];
        const content = block.split(/<div\b[^>]*class=["']post-content["'][^>]*>/i)[1] ?? '';
        return [{ title, date: parseDate(plainText(block.split(/<h3\b/i)[0])), author: plainText(block.match(/<a\b[^>]*title=["']Profil anzeigen[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '') || undefined, text: plainText(content).slice(0, 600), url }];
    });
}

export function parseLiterature(html: string, base: string): CourseEntry[] {
    return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(row => {
        const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
        if (cells.length < 2) return [];
        const title = plainText(cells[1][1]);
        const links = parseLinks(row[1], base);
        return links.length ? links.map(e => ({ ...e, title })) : [{ kind: 'link' as const, title, url: base, folderPath: [], external: false, firstSeen: 0, isNew: false }];
    });
}

