/* ━━ Course view: list columns and column header ━━━━━━━━━━━━━━━━
 * Every row of the list pane sits on ONE grid:
 *   [icon 20][Name 1fr][action 72][Ort][Typ 56][Größe 72][Geändert 92]
 * The template is computed here and set as a custom property on the
 * table, so the header, group heads, folder labels, rows and skeletons
 * share the same vertical lines. Typ / Größe / Geändert can be switched
 * off and disappear when no entry has a value; "Ort" exists only in
 * flat lists. Narrow panes keep Name and Geändert (CSS container query
 * switches to the narrow template).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../../i18n/messages/course.ts';
import type { BrowseLayout, ListModel, Sort, SortKey } from '../browse/types.ts';
import { ICON } from './format.ts';

export interface Columns {
    loc: boolean;
    type: boolean;
    size: boolean;
    modified: boolean;
}

export function listColumns(model: ListModel, prefs: BrowseLayout['columns']): Columns {
    const entries = model.groups.flatMap(g => g.folders.flatMap(f => f.entries));
    // Before anything has loaded the skeleton shows the preferred columns.
    const has = (pick: (e: (typeof entries)[number]) => string) => entries.length === 0 || entries.some(e => !!pick(e));
    return {
        loc: !model.grouped && model.showLocation,
        // One type for every file ("PDF" fifteen times) says nothing; the column returns when types differ.
        type: prefs.type && has(e => e.type) && (entries.length < 2 || entries.some(e => e.type !== entries[0].type)),
        size: prefs.size && has(e => e.size),
        modified: prefs.modified && has(e => e.modified),
    };
}

/** Number of grid columns (for aria-colspan). */
export function columnCount(c: Columns, narrow = false): number {
    return 4 + (c.loc && !narrow ? 1 : 0) + (c.type && !narrow ? 1 : 0) + (c.size && !narrow ? 1 : 0);
}

export function gridTemplate(c: Columns, narrow = false): string {
    const cols = ['20px', 'minmax(0, 1fr)', '100px'];
    if (c.loc && !narrow) cols.push('minmax(0, 0.5fr)');
    if (c.type && !narrow) cols.push('56px');
    if (c.size && !narrow) cols.push('72px');
    // The last column always exists: group heads put "In OPAL öffnen" there.
    cols.push(c.modified ? '92px' : '28px');
    return cols.join(' ');
}

const SORT_LABEL = { order: 'sortOrder', name: 'columnName', type: 'columnType', size: 'columnSize', modified: 'columnModified' } as const;
export const sortLabel = (key: SortKey): string => t(SORT_LABEL[key]);

const FIRST_DIR: Record<SortKey, Sort['dir']> = { order: 'asc', name: 'asc', type: 'asc', size: 'desc', modified: 'desc' };

/** Click on a column header: first direction, reversed, then the lecturer's order. */
export function nextSort(current: Sort, key: SortKey): Sort {
    if (current.key !== key) return { key, dir: FIRST_DIR[key] };
    if (current.dir === FIRST_DIR[key]) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
    return { key: 'order', dir: 'asc' };
}

function sortHeader(key: SortKey, cls: string, sort: Sort): string {
    const label = sortLabel(key);
    const active = sort.key === key;
    const aria = active ? ` aria-sort="${sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
    const chevron = active ? `<span class="opal-course-sort-ico">${sort.dir === 'asc' ? ICON.sortUp : ICON.sortDown}</span>` : '';
    const hint = active ? (nextSort(sort, key).key === 'order' ? t('sortRestore') : t('sortReverse')) : t('sortBy', { label });
    return `<span role="columnheader" class="${cls}"${aria}><button type="button" class="opal-course-sort${active ? ' is-active' : ''}" data-sort="${key}" title="${hint}">${cls.includes('is-num') ? chevron + label : label + chevron}</button></span>`;
}

export function renderColumnHead(c: Columns, sort: Sort): string {
    return `<div role="row" class="opal-course-colhead">
      <span role="columnheader" class="c-icon"><span class="sr-only">${t('columnKind')}</span></span>
      ${sortHeader('name', 'c-name', sort)}
      <span role="columnheader" class="c-act"><span class="sr-only">${t('categorySolution')}</span></span>${c.loc ? `
      <span role="columnheader" class="c-loc">${t('columnLocation')}</span>` : ''}${c.type ? `
      ${sortHeader('type', 'c-type', sort)}` : ''}${c.size ? `
      ${sortHeader('size', 'c-size is-num', sort)}` : ''}${c.modified ? `
      ${sortHeader('modified', 'c-date is-num', sort)}` : ''}
    </div>`;
}
