/* ━━ Course view: the find field ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * The page's only search control. It takes the place of the top bar's
 * "Suchen… Strg K" trigger (same slot, same size; the bar is sticky, so
 * it stays reachable while scrolling). Ctrl+K still opens the global
 * palette. Rendered once at mount and never replaced, so text, caret
 * and focus survive every loader update. Typing anywhere on the page
 * lands here (see typeToFind). With a query the list pane shows the
 * hits; arrow keys move a highlight through them and Enter opens it
 * (view.ts announces the highlighted row in the live region).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t as tr } from '../../i18n/messages/course.ts';
import { ICON, esc } from './format.ts';

export const FIND_ID = 'opal-course-find';
export const LIST_ID = 'opal-course-list';
const TITLE_MAX = 28;

/** `In „Aerodynamik“ suchen`; long titles are shortened. */
export function findPlaceholder(courseTitle: string): string {
    const t = courseTitle.trim().replace(/\s+/g, ' ');
    if (!t) return tr('findCourse');
    const short = [...t].length > TITLE_MAX ? `${[...t].slice(0, TITLE_MAX - 1).join('').trimEnd()}…` : t;
    return tr('findNamedCourseQuoted', { title: short });
}

/** The field, in the top bar's search slot. */
export function renderFindField(courseTitle: string): string {
    return `<label class="opal-search-trigger opal-course-find-field" for="${FIND_ID}">
        ${ICON.search}
        <input id="${FIND_ID}" type="search" autocomplete="off" spellcheck="false" enterkeyhint="go"
               aria-controls="${LIST_ID}" aria-describedby="opal-course-find-hint"
               aria-label="${esc(courseTitle ? tr('findNamedCourse', { title: courseTitle }) : tr('findCourse'))}" aria-keyshortcuts="/" placeholder="${esc(findPlaceholder(courseTitle))}">
        <span class="sr-only" id="opal-course-find-hint">${tr('findKeys')}</span>
        <span class="opal-course-find-keys" aria-hidden="true" title="${tr('findTooltip')}"><kbd class="opal-kbd">/</kbd></span>
      </label>`;
}

export interface KeyLike {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    /** The event target is an input, textarea, select or contenteditable. */
    editable: boolean;
}

/**
 * What a key press outside the field does: 'insert' moves focus into the
 * field and types the character, 'focus' only focuses it ("/"), null
 * leaves the key alone (Space and arrows keep scrolling the page).
 */
export function typeToFind(e: KeyLike): 'insert' | 'focus' | null {
    if (e.editable || e.ctrlKey || e.metaKey || e.altKey) return null;
    if (e.key === '/') return 'focus';
    if ([...e.key].length !== 1 || e.key === ' ') return null;
    return /\p{L}|\p{N}|\p{P}|\p{S}/u.test(e.key) ? 'insert' : null;
}
