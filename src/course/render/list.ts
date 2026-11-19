/* ━━ Course view: the list pane's table ━━━━━━━━━━━━━━━━━━━━━━━━━
 * A role="table" whose rows all share the grid from list-head.ts.
 * Grouped lists get one rowgroup per section: a 32px head row
 * (disclosure, title · path, count in the Größe column, "In OPAL
 * öffnen", and for hand-in folders "Hochladen"), 24px folder labels,
 * then the file rows. Flat lists (recent, changed, search) are one
 * rowgroup without a head. view.ts reconciles rowgroups by key, so
 * only groups whose signature changed are replaced.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../../i18n/messages/course.ts';
import { formatNumber, localeTag } from '../../i18n/core.ts';
import type { ListGroup, ListModel, Sort } from '../browse/types.ts';
import { ICON, NEW_TAB, esc, href } from './format.ts';
import { columnCount, type Columns } from './list-head.ts';
import { renderRow, renderSkeletonRows, sharedPrefix } from './list-row.ts';

/** Explicit sorting compares the whole selection; course order restores folders. */
export function sortedList(model: ListModel, sort: Sort): ListModel {
    if (sort.key === 'order' || !model.grouped || model.groups.some(g => g.canUpload || g.state === 'pending' || g.state === 'error')) return model;
    const entries = model.groups.flatMap(g => g.folders.flatMap(f => f.entries));
    const value = (e: (typeof entries)[number]) => sort.key === 'name' ? e.name : sort.key === 'type' ? e.type || undefined : sort.key === 'size' ? e.sizeBytes : e.modifiedMs;
    entries.sort((a, b) => {
        const av = value(a), bv = value(b);
        if (av === undefined) return bv === undefined ? 0 : 1;
        if (bv === undefined) return -1;
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), localeTag(), { numeric: true });
        return cmp * (sort.dir === 'desc' ? -1 : 1);
    });
    const note = model.groups.filter(g => g.note).map(g => `${g.title}: ${g.note}`).join(' · ');
    return { ...model, grouped: false, showLocation: true, groups: entries.length ? [{ id: 'sorted', title: model.title, path: [], count: entries.length, state: 'loaded', note, folders: [{ label: '', entries }] }] : [] };
}

export interface GroupContext {
    pinned?: ReadonlySet<string>;
    done?: ReadonlyMap<string, number>;
    /** DOM key of the rowgroup (view.ts reconciles by it). */
    key: string;
    cols: Columns;
    grouped: boolean;
    collapsed: boolean;
    /** The page text of this group is unfolded. */
    introOpen?: boolean;
}

/** One muted line spanning the row (states and notes). */
function line(text: string, cols: Columns, cls = ''): string {
    return `<div role="row" class="opal-course-line${cls}"><span role="cell" aria-colspan="${columnCount(cols)}">${esc(text)}</span></div>`;
}

function groupHead(g: ListGroup, ctx: GroupContext): string {
    const id = esc(g.id);
    const open = !ctx.collapsed;
    const path = g.path.length ? `<span class="opal-course-ghead-path"><span aria-hidden="true">·</span> ${esc(g.path.join(' › '))}</span>` : '';
    const upload = g.canUpload && g.url
        ? `<span class="opal-course-ghead-upload"><span class="opal-course-ghead-note">${t('submissionFolder')}</span><a class="opal-course-tool" href="${href(g.url)}" data-fk="up:${id}">${t('upload')}</a></span>`
        : '';
    const count = g.state === 'pending' ? '' : `<span class="sr-only">${t('entriesPrefix')}</span>${formatNumber(g.count)}`;
    const fresh = g.state === 'pending' ? 0 : g.folders.reduce((n, f) => n + f.entries.filter(e => e.isNew).length, 0);
    const news = fresh ? `<span class="opal-course-ghead-new">${t('newCount', { count: fresh })}</span>` : '';
    const opal = g.url
        ? `<a class="opal-course-icon-btn" href="${href(g.url)}" data-fk="opal:${id}" aria-label="${esc(t('openNamedInOpal', { title: g.title }))}" title="${t('openInOpal')}">${ICON.open}</a>`
        : '';
    return `<div role="row" class="opal-course-ghead">
      <span role="cell" class="opal-course-ghead-title" aria-colspan="${columnCount(ctx.cols) - 2}">
        <button type="button" class="opal-course-ghead-toggle" data-toggle-group="${id}" data-fk="tog:${id}" aria-expanded="${open}"><span class="opal-course-chevron">${ICON.chevron}</span><span class="opal-course-ghead-name">${esc(g.title)}</span></button>${path}${news}${upload}
      </span>
      <span role="cell" class="opal-course-ghead-count">${count}</span>
      <span role="cell" class="opal-course-ghead-actions">${opal}</span>
    </div>`;
}

/** A page's text inside a list: one line ending in "…" and "Mehr"; unfolded, the whole page. */
function introRow(g: ListGroup, ctx: GroupContext): string {
    if (!g.intro || !ctx.grouped) return '';
    const id = esc(g.id), open = !!ctx.introOpen;
    const toggle = `<button type="button" class="opal-course-intro-toggle" data-intro="${id}" data-fk="intro:${id}" aria-expanded="${open}">${open ? t('less') : t('more')}</button>`;
    const body = open
        ? `<div class="opal-course-doc is-inline">${g.intro.html}</div>${g.intro.truncated && g.url ? `<p class="opal-course-doc-cut">${t('introTruncated')} <a href="${href(g.url)}" ${NEW_TAB}>${t('fullPageOpal')}</a></p>` : ''}`
        : `<p class="opal-course-intro-line">${esc(g.intro.excerpt)}</p>`;
    return `<div role="row" class="opal-course-intro${open ? ' is-open' : ''}"><div role="cell" aria-colspan="${columnCount(ctx.cols)}">${body}${toggle}</div></div>`;
}

function groupBody(g: ListGroup, ctx: GroupContext, seed: number): string {
    if (g.state === 'pending') return renderSkeletonRows(3, ctx.cols, seed);
    const intro = introRow(g, ctx);
    if (intro) return intro + groupFiles(g, ctx);
    return groupFiles(g, ctx);
}

function groupFiles(g: ListGroup, ctx: GroupContext): string {
    if (g.state === 'error') return line(g.note || t('sectionErrorOpenOpal'), ctx.cols);
    const entries = g.folders.reduce((n, f) => n + f.entries.length, 0);
    // A page that is only text needs no "Keine Dateien" under its text.
    if (entries === 0) return g.intro && ctx.grouped ? '' : line(g.state === 'empty' ? t('sectionNoFiles') : t('sectionNoSelection'), ctx.cols);
    let out = '';
    // The group's shared name start is set back, only where the course order is shown.
    const prefix = ctx.grouped ? sharedPrefix(g.folders.flatMap(f => f.entries.map(e => e.name))) : 0;
    for (const f of g.folders) {
        if (f.label) out += `<div role="row" class="opal-course-folder"><span role="cell" class="c-icon">${ICON.folder}</span><span role="cell" class="c-folder" aria-colspan="${columnCount(ctx.cols) - 1}"><span class="opal-course-folder-name">${esc(f.label)}</span><span class="opal-course-folder-count"><span class="sr-only">${t('filesPrefix')}</span>${formatNumber(f.entries.length)}</span></span></div>`;
        for (const e of f.entries) out += renderRow(e, { pinned: ctx.pinned, done: ctx.done, cols: ctx.cols, nested: !!f.label && ctx.grouped, group: g.id, prefix });
    }
    if (g.note) out += line(g.note, ctx.cols, ' is-note');
    return out;
}

/** A rowgroup: head (grouped lists only) and, unless collapsed, the body. */
export function renderGroup(g: ListGroup, ctx: GroupContext, seed = 0): string {
    const head = ctx.grouped ? groupHead(g, ctx) : '';
    const body = groupBody(g, ctx, seed);
    const label = ctx.grouped ? ` aria-label="${esc(g.title)}"` : '';
    return `<div role="rowgroup" class="opal-course-group${ctx.grouped ? ' is-grouped' : ''}${ctx.collapsed && ctx.grouped ? ' is-collapsed' : ''}" data-group="${esc(ctx.key)}"${label}>${head}<div class="opal-course-group-body"${ctx.collapsed ? ' hidden' : ''}>${body}</div></div>`;
}

/** Changes whenever anything renderGroup shows changes. */
export function groupSignature(g: ListGroup, ctx: GroupContext): string {
    let sig = `${ctx.grouped ? 1 : 0}${ctx.collapsed ? 1 : 0}${ctx.introOpen ? 1 : 0}${g.intro ? g.intro.html.length + g.intro.excerpt : ''}${ctx.cols.loc ? 1 : 0}${ctx.cols.type ? 1 : 0}${ctx.cols.size ? 1 : 0}${ctx.cols.modified ? 1 : 0}|${g.state}|${g.title}|${g.path.join('>')}|${g.count}|${g.url ?? ''}|${g.canUpload ? 1 : 0}|${g.note ?? ''}`;
    for (const f of g.folders) {
        sig += `#${f.label}`;
        for (const e of f.entries) sig += `|${e.entry.url}:${e.name}:${e.head.length}:${e.fileName ?? ''}:${e.type}:${e.size}:${e.modified}:${e.isNew ? 1 : 0}:${e.openedAt ?? ''}:${e.solution?.url ?? ''}:${e.location}:${e.ranges.join(';')}`;
    }
    return sig;
}

/** A placeholder group while the course menu is not known yet. */
export function renderSkeletonGroup(i: number, cols: Columns): string {
    return `<div role="rowgroup" class="opal-course-group is-grouped" data-group="__skeleton-${i}" aria-hidden="true">
      <div class="opal-course-ghead is-skeleton"><span class="opal-course-ghead-title"><span class="opal-course-skel" style="width:${[160, 120, 200][i % 3]}px"></span></span></div>
      ${renderSkeletonRows(3, cols, i)}
    </div>`;
}
