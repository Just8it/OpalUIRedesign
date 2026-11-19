import type { Announcement } from './news-model';
const DE_DATE_RE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/;

function parseDEDate(text: string): { raw: string; ms: number } | undefined {
    const m = DE_DATE_RE.exec(text);
    if (!m) return undefined;
    return {
        raw: m[0],
        ms: new Date(+m[3], +m[2] - 1, +m[1]).getTime(),
    };
}

/** Return element text with <style>/<script> stripped (OPAL injects CSS into portlet content). */
function cleanText(el: Element): string {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll('style, script').forEach(e => e.remove());
    return clone.textContent ?? '';
}

/** Extract Announcement items from one portlet element. */
export function scrapePortlet(portlet: Element, tag: Announcement['tag']): Announcement[] {
    const items: Announcement[] = [];

    // Try structured rows: <li> or <tr> elements that contain a link
    const rows = [
        ...Array.from(portlet.querySelectorAll(
            'li.infomessage, li[class*="message"], li[class*="news"], li[class*="item"]'
        )),
        ...Array.from(portlet.querySelectorAll('tr')).filter(tr => tr.querySelector('a')),
    ];

    if (rows.length > 0) {
        for (const row of rows) {
            const a = row.querySelector<HTMLAnchorElement>('a[href]');
            const title = a?.textContent?.trim() || cleanText(row).trim() || '';
            if (!title || title.length < 3) continue;

            const rowText = cleanText(row);
            const parsed  = parseDEDate(rowText);

            // Sender/course: second non-empty text node or <td>/<span> after the link
            const cells = Array.from(row.querySelectorAll('td, span, div'))
                .map(el => cleanText(el).trim())
                .filter((t): t is string => !!t && t !== title && t !== parsed?.raw && t.length > 1);
            const source = cells[0];

            items.push({
                title,
                link:    a?.href,
                dateRaw: parsed?.raw,
                dateMs:  parsed?.ms,
                source,
                isNew:   row.classList.contains('new') || !!row.querySelector('.new, [class*="new"], .unread'),
                tag,
            });
        }
        return items;
    }

    // Fallback: every meaningful <a> in the content area
    const content = portlet.querySelector(
        '.panel-content, .o_portlet, [class*="content"]'
    ) ?? portlet;

    for (const a of Array.from(content.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        // Portlet chrome is not an announcement: the gear menu ("Verstecken",
        // "Konfigurieren"), the mobile "Alle anzeigen" link and the heading are
        // Wicket javascript: links or live in the portlet header.
        if ((a.getAttribute('href') ?? '').trim().toLowerCase().startsWith('javascript:')) continue;
        if (a.closest('.panel-header, .panel-functions, .panel-config, .showallmobile')) continue;
        const title = a.textContent?.trim();
        if (!title || title.length < 3) continue;
        const parentText = a.parentElement ? cleanText(a.parentElement) : '';
        const parsed = parseDEDate(parentText);
        items.push({ title, link: a.href, dateRaw: parsed?.raw, dateMs: parsed?.ms, tag });
    }

    // Ultimate fallback: show cleaned text as a single item
    if (items.length === 0) {
        const contentEl = portlet.querySelector('.panel-content');
        const text = contentEl ? cleanText(contentEl).trim() : '';
        if (text && !text.toLowerCase().includes('keine neuigkeiten') && text.length > 3) {
            items.push({ title: text.slice(0, 140), tag });
        }
    }

    return items;
}

/* ── Widget ───────────────────────────────────────────────────── */


