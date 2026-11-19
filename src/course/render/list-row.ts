/* ━━ Course view: one file row ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * [icon][name · check · Neu · file name][Lösung][Ort][Typ][Größe][Geändert]
 * The name link is stretched over the whole row (::after), so the row
 * is the link; "Lösung" is a sibling control in its own cell (links
 * must not nest). The name is split for middle truncation: `head`
 * shrinks with an ellipsis, `tail` never shrinks, so
 * "Aero_I_Kap_0_2026-10…_Notizseiten" and "Aero_I_Kap_0_2026-10-12"
 * stay tellable apart. The file name is the first thing to be clipped.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../../i18n/messages/course.ts';
import type { ListEntry } from '../browse/types.ts';
import type { Columns } from './list-head.ts';
import { ICON, NEW_TAB, esc, formatDate, highlight, href } from './format.ts';

export function pinToggle(url: string, pinned = false): string {
    return `<button type="button" class="opal-course-pin${pinned ? ' is-pinned' : ''}" data-pin="${esc(url)}" data-fk="pin:${esc(url)}" aria-pressed="${pinned}" aria-label="${pinned ? t('unpin') : t('pin')}" title="${pinned ? t('unpin') : t('pin')}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m16 3 5 5-4 1-3 5v3l-7-7h3l5-3zM9 15l-6 6"/></svg></button>`;
}
export function doneMark(at: number): string {
    const label = esc(t('doneOn', { date: formatDate(at) }));
    return `<span class="opal-course-opened" role="img" title="${label}" aria-label="${label}">${ICON.check}</span>`;
}
export function rowIcon(e: ListEntry): string {
    if (e.type === 'Literatur') return ICON.book;
    if (e.entry.kind === 'video') return ICON.video;
    if (e.entry.kind === 'link') return ICON.link;
    if (/^(zip|rar|7z|tar|gz)$/i.test(e.entry.extension ?? '')) return ICON.archive;
    return ICON.file;
}

/** "Geöffnet am 12.11.2026": a check with a text label, never colour alone. */
export function openedMark(openedAt: number): string {
    const label = t('openedOn', { date: formatDate(openedAt) });
    return `<span class="opal-course-opened" role="img" aria-label="${esc(label)}" title="${esc(label)}">${ICON.check}</span>`;
}

/** File-name style ("Aero_I_Kap_2.10_Notizseiten") reads as words with spaces.
 *  One character for one, so search ranges still line up; the tooltip keeps the real name. */
export const readable = (text: string, name: string) => /\s/.test(name) ? text : text.replace(/_/g, ' ');

/** The part every name in a group starts with ("Aero_I_"), cut at a separator so a word is never split. */
export function sharedPrefix(names: string[]): number {
    if (names.length < 3) return 0;
    let n = names[0].length;
    for (const name of names) {
        let i = 0;
        while (i < n && i < name.length && name[i].toLowerCase() === names[0][i].toLowerCase()) i++;
        n = i;
    }
    while (n > 0 && !/[\s_.-]/.test(names[0][n - 1])) n--;
    // Too short to be noise, or it would leave a name with almost nothing of its own.
    return n >= 3 && names.every(name => name.length - n >= 3) ? n : 0;
}

/** Name markup: head (may shrink), tail (never shrinks), search emphasis across both.
 *  The first `prefix` characters are the group's shared start, set back so the distinct part leads. */
export function nameHtml(e: ListEntry, prefix = 0): string {
    const head = readable(e.head || e.name, e.name);
    // Spaces the name really starts its tail with are dropped; an underscore turned space stays as the word gap.
    const tail = e.head ? readable(e.tail.trimStart(), e.name) : '';
    const lead = prefix && !e.ranges.length && prefix < head.length
        ? `<span class="opal-course-name-p">${highlight(head.slice(0, prefix), [], 0)}</span>${highlight(head.slice(prefix), [], 0)}`
        : highlight(head, e.ranges, 0);
    return `<span class="opal-course-name-h">${lead}</span>${tail ? `<span class="opal-course-name-t">${highlight(tail, e.ranges, head.length + e.tail.length - tail.length)}</span>` : ''}`;
}

export interface RowContext {
    cols: Columns;
    pinned?: ReadonlySet<string>;
    done?: ReadonlyMap<string, number>;
    /** Below a folder label: indented one step. */
    nested: boolean;
    /** Key part for focus restore (group id). */
    group: string;
    /** Length of the group's shared name start (see sharedPrefix). */
    prefix?: number;
}

export function renderRow(e: ListEntry, ctx: RowContext): string {
    const url = e.entry.url;
    const link = href(url);
    const opened = e.openedAt && e.openedAt > 0 ? e.openedAt : 0;
    const title = [e.entry.title, e.fileName].filter(Boolean).join('\n');
    const solution = e.solution && href(e.solution.url) !== '#'
        ? `<a class="opal-course-solution" href="${href(e.solution.url)}" ${NEW_TAB} data-url="${esc(e.solution.url)}" data-fk="sol:${esc(ctx.group)}:${esc(e.solution.url)}" aria-label="${esc(t('solutionFor', { title: e.name }))}" title="${esc(e.solution.title)}">${t('categorySolution')}</a>`
        : '';
    const done = ctx.done?.get(url);
    const cls = `opal-course-row${e.isNew ? ' is-new' : ''}${done ? ' is-done' : ''}${opened ? ' is-opened' : ''}${ctx.nested ? ' is-nested' : ''}`;
    return `<div role="row" class="${cls}" data-url="${esc(url)}">
      <span role="cell" class="c-icon">${e.isNew ? '<span class="opal-course-new-dot" aria-hidden="true"></span>' : ''}${rowIcon(e)}</span>
      <span role="cell" class="c-name"><a class="opal-course-name" href="${link}" ${NEW_TAB} data-url="${esc(url)}" data-fk="row:${esc(ctx.group)}:${esc(url)}" title="${esc(title)}">${e.isNew ? `<span class="sr-only">${t('newPrefix')}</span>` : ''}${nameHtml(e, ctx.prefix)}${done ? doneMark(done) : opened ? openedMark(opened) : ''}${e.fileName ? `<span class="opal-course-file">${esc(e.fileName)}</span>` : ''}</a></span>
      <span role="cell" class="c-act">${solution}${pinToggle(url, ctx.pinned?.has(url))}</span>${ctx.cols.loc ? `
      <span role="cell" class="c-loc" title="${esc(e.location)}">${esc(e.location)}</span>` : ''}${ctx.cols.type ? `
      <span role="cell" class="c-type">${esc(e.type)}</span>` : ''}${ctx.cols.size ? `
      <span role="cell" class="c-size is-num">${esc(e.size)}</span>` : ''}${ctx.cols.modified ? `
      <span role="cell" class="c-date is-num">${esc(e.modified)}</span>` : ''}
    </div>`;
}

const SKELETON_WIDTHS = ['62%', '46%', '70%', '38%', '55%'];

/** Placeholder rows on the same grid, so nothing moves when data arrives. */
export function renderSkeletonRows(n: number, cols: Columns, seed = 0): string {
    let out = '';
    for (let i = 0; i < n; i++) {
        const w = SKELETON_WIDTHS[(i + seed) % SKELETON_WIDTHS.length];
        out += `<div class="opal-course-row is-skeleton" aria-hidden="true">
          <span class="c-icon"><span class="opal-course-skel opal-course-skel-ico"></span></span>
          <span class="c-name"><span class="opal-course-skel" style="width:${w}"></span></span>
          <span class="c-act"></span>${cols.loc ? '<span class="c-loc"></span>' : ''}${cols.type ? '<span class="c-type"><span class="opal-course-skel" style="width:28px"></span></span>' : ''}${cols.size ? '<span class="c-size is-num"><span class="opal-course-skel" style="width:40px"></span></span>' : ''}${cols.modified ? '<span class="c-date is-num"><span class="opal-course-skel" style="width:64px"></span></span>' : ''}
        </div>`;
    }
    return out;
}
