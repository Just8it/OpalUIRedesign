import { t } from '../../i18n/messages/course.ts';
import type { CourseEntry } from '../types.ts';
import type { CourseProgress, HomeModel } from '../home/types.ts';
import { splitName } from '../browse/index.ts';
import { esc, href, NEW_TAB, ICON } from './format.ts';
import { pinToggle } from './list-row.ts';

export interface HomeRenderState {
    progress: CourseProgress;
    expanded: Set<string>;
    editing: boolean;
    rename: string;
    adding: boolean;
    previousVisit: number;
}
export function homeButton(action: string, label: string, id = '', extra = '', primary = false): string {
    return `<button type="button" class="opal-course-home-button${primary ? ' is-primary' : ''}" data-home="${action}" data-id="${esc(id)}" data-fk="home:${action}:${esc(id)}" ${extra}>${label}</button>`;
}
export function homeFile(entry: CourseEntry, state: HomeRenderState): string {
    const name = entry.title.replace(/\.[a-z0-9]{2,5}$/i, '');
    const { head, tail } = splitName(name);
    return `<div class="opal-course-home-file" data-url="${esc(entry.url)}"><span>${ICON.file}</span><a href="${href(entry.url)}" ${NEW_TAB} data-url="${esc(entry.url)}" title="${esc(entry.title)}"><span class="opal-course-name-h">${esc(head)}</span><span class="opal-course-name-t">${esc(tail.trimStart())}</span></a><span class="opal-course-home-type">${esc(entry.extension?.toUpperCase() ?? t('fileTypeLink'))}</span>${pinToggle(entry.url, state.progress.pinned.includes(entry.url))}</div>`;
}
export function homeFiles(entries: CourseEntry[], state: HomeRenderState, limit = 5, key = ''): string {
    const expanded = state.expanded.has(`files:${key}`);
    return entries.slice(0, expanded ? undefined : limit).map(e => homeFile(e, state)).join('') + (entries.length > limit ? homeButton('expand', expanded ? t('homeFewerFiles') : t('homeMoreFiles', { count: entries.length - limit }), `files:${key}`, `aria-expanded="${expanded}"`) : '');
}
/** The browser can mark completed files without knowing how units were inferred. */
export function doneEntries(model: HomeModel): Map<string, number> {
    const result = new Map<string, number>();
    for (const block of model.blocks) if (block.kind === 'series') for (const unit of block.units) if (unit.doneAt) for (const e of [...unit.entries, ...unit.solutions]) result.set(e.url, unit.doneAt);
    return result;
}
