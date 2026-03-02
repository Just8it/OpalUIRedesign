/* ━━ Announcements Widget — aggregated feed ━━━━━━━━━━━━━━━━━━━
 * Merges items from both OPAL portlets:
 *   • InfoMessages  (Kursnews — course-level announcements)
 *   • Information   (Aktuelles — institution-wide notices)
 * Items are sorted newest-first by parsed German date (DD.MM.YYYY).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';
import { escapeHtml } from '../utils';

interface Announcement {
    title: string;
    link?: string;
    dateRaw?: string;   // e.g. "01.03.2026"
    dateMs?: number;    // parsed timestamp for sorting
    source?: string;    // course / sender name
    isNew?: boolean;
    tag: 'news' | 'info';
}

interface AnnouncementsData {
    items: Announcement[];
    hasInfoMessages: boolean;
    hasInformation: boolean;
}

/* ── Helpers ──────────────────────────────────────────────────── */

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
function scrapePortlet(portlet: Element, tag: 'news' | 'info'): Announcement[] {
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

export const announcementsWidget: Widget = {
    id: 'announcements',
    opalPortletOrder: ['InfoMessages', 'Information'],
    title: 'Ankündigungen',
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3z"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>`,
    defaultW: 4,
    defaultH: 4,
    hasNativeConfig: false,

    scrape(): AnnouncementsData {
        const infoMsgPortlet = document.querySelector(
            'div[data-portlet-order="InfoMessages"] section.panel.portlet'
        );
        const informationPortlet = document.querySelector(
            'div[data-portlet-order="Information"] section.panel.portlet'
        );

        const items: Announcement[] = [];
        if (infoMsgPortlet)   items.push(...scrapePortlet(infoMsgPortlet,   'news'));
        if (informationPortlet) items.push(...scrapePortlet(informationPortlet, 'info'));

        // Sort: dated items newest-first, then undated
        items.sort((a, b) => {
            if (a.dateMs && b.dateMs) return b.dateMs - a.dateMs;
            if (a.dateMs) return -1;
            if (b.dateMs) return 1;
            return 0;
        });

        return {
            items,
            hasInfoMessages:  !!infoMsgPortlet,
            hasInformation:   !!informationPortlet,
        };
    },

    render(data: unknown): string {
        const d = data as AnnouncementsData;

        if (!d.hasInfoMessages && !d.hasInformation) {
            return `
            <div class="text-center py-6">
              <svg class="mx-auto mb-3 text-opal-text-muted/40" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3z"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <p class="text-sm text-opal-text-muted">Portlet nicht verfügbar.</p>
              <p class="text-xs text-opal-text-muted/60 mt-1">Aktiviere das „Kursnews"-Portlet auf der OPAL-Startseite.</p>
            </div>`;
        }

        if (d.items.length === 0) {
            return `
            <div class="text-center py-6">
              <p class="text-sm text-opal-text-muted">Keine Ankündigungen.</p>
            </div>`;
        }

        const cards = d.items.slice(0, 10).map(item => {
            const isNews = item.tag === 'news';
            const tagCls = isNews
                ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20'
                : 'text-amber-400  bg-amber-500/10  border-amber-500/20';
            const tagLabel = isNews ? 'Kurs' : 'OPAL';

            const newBadge = item.isNew
                ? `<span class="ml-1 px-1 py-0.5 rounded text-[9px] font-bold bg-[#6264f4]/20 text-[#6264f4] uppercase tracking-wide">Neu</span>`
                : '';

            const titleEl = item.link
                ? `<a href="${escapeHtml(item.link)}" class="text-xs font-semibold text-opal-text hover:text-white transition-colors line-clamp-2 flex-1 min-w-0" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`
                : `<span class="text-xs font-semibold text-opal-text line-clamp-2 flex-1 min-w-0">${escapeHtml(item.title)}</span>`;

            const meta = [
                item.source  ? `<span>${escapeHtml(item.source)}</span>` : '',
                item.dateRaw ? `<span>${item.dateRaw}</span>` : '',
            ].filter(Boolean).join('<span class="mx-1 opacity-30">·</span>');

            return `
            <div class="flex items-start gap-2.5 py-2 border-b border-white/5 last:border-0">
              <span class="mt-0.5 flex-shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide border ${tagCls}">${tagLabel}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-start gap-1 mb-0.5">
                  ${titleEl}
                  ${newBadge}
                </div>
                ${meta ? `<p class="text-[10px] text-opal-text-muted truncate">${meta}</p>` : ''}
              </div>
            </div>`;
        }).join('');

        return `<div class="divide-y divide-white/5 -mx-0">${cards}</div>`;
    },
};
