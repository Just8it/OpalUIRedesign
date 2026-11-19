/* ━━ Course view: sidebar ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Says what the list pane shows. Blocks come from browse/buildNav:
 * the untitled study block (Übersicht, Vorlesungen, Übungen, ...),
 * "Aktuell", "Kursinhalt" and "Weitere Bereiche". Every item except an area
 * SELECTS (a button with aria-current); areas are links to OPAL's page.
 * The whole sidebar is one tab stop: view.ts keeps exactly one item at
 * tabindex 0 and moves focus with the arrow keys.
 * While customising, each section row in "Kursinhalt" gets a grip to
 * drag it (arrow keys on the focused grip work too, see ../drag.ts)
 * and an eye toggle; hidden sections are shown dimmed.
 * Below 900px the same element becomes a popover opened by the
 * "Anzeigen: …" disclosure above the list.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../../i18n/messages/course.ts';
import { formatNumber } from '../../i18n/core.ts';
import type { NavBlock, NavItem } from '../browse/types.ts';
import { ICON, esc, href } from './format.ts';
import { gripButton } from './home-edit.ts';

export const NAV_ID = 'opal-course-nav';
export const NAV_TOGGLE_ID = 'opal-course-nav-toggle';

/** Items that select something (everything but areas), in sidebar order. */
export function selectableIds(blocks: NavBlock[]): string[] {
    return blocks.flatMap(b => b.items).filter(i => i.kind !== 'area').map(i => i.id);
}

export function findItem(blocks: NavBlock[], id: string): NavItem | undefined {
    for (const b of blocks) for (const i of b.items) if (i.id === id) return i;
    return undefined;
}

/** Node id behind a "sec:" item. */
export const sectionIdOf = (navId: string): string => navId.startsWith('sec:') ? navId.slice(4) : '';

function editTools(item: NavItem): string {
    const id = esc(sectionIdOf(item.id));
    const text = esc(t(item.hidden ? 'showNamed' : 'hideNamed', { title: item.label }));
    return `<span class="opal-course-nav-tools"><button type="button" class="opal-course-nav-tool" data-edit="hide" data-id="${id}" aria-label="${text}" aria-pressed="${!item.hidden}" title="${item.hidden ? t('show') : t('hide')}">${item.hidden ? ICON.eyeOff : ICON.eye}</button></span>`;
}

function renderItem(item: NavItem, selected: string, editing: boolean, pos: { index: number; total: number } | null, inContent = false): string {
    const dot = item.hasNew ? `<span class="opal-course-nav-dot" aria-hidden="true"></span><span class="sr-only">${t('navNew')}</span>` : '';
    const label = `<span class="opal-course-nav-label">${esc(item.label)}</span>${dot}`;
    const cls = `opal-course-nav-li${item.depth ? ' is-nested' : ''}${item.hidden ? ' is-hidden' : ''}`;
    if (item.kind === 'area') {
        return `<li class="${cls}"><a class="opal-course-nav-item" href="${href(item.url)}" data-nav="${esc(item.id)}" tabindex="-1">${label}<span class="opal-course-nav-ext" aria-hidden="true">${ICON.external}</span><span class="sr-only">${t('navOpal')}</span></a></li>`;
    }
    const on = item.id === selected;
    const count = item.count !== undefined && !(editing && pos) ? `<span class="opal-course-nav-count">${formatNumber(item.count)}</span>` : '';
    const hidden = item.hidden ? `<span class="sr-only">${t('navHidden')}</span>` : '';
    const grip = editing && pos ? gripButton(sectionIdOf(item.id), esc(t('moveNamed', { title: item.label }))) : editing && inContent ? '<span class="opal-course-grip is-placeholder" aria-hidden="true"></span>' : '';
    return `<li class="${cls}"${editing && pos ? ` data-section="${esc(sectionIdOf(item.id))}"` : ''}${item.kind === 'group' ? ` data-group-head="${esc(item.id)}"` : ''}>${grip}<button type="button" class="opal-course-nav-item" data-nav="${esc(item.id)}"${on ? ' aria-current="true"' : ''} tabindex="${on ? 0 : -1}">${label}${hidden}${count}</button>${editing && pos ? editTools(item) : ''}</li>`;
}

export function renderSidebar(blocks: NavBlock[], selected: string, editing: boolean): string {
    const sections = blocks.find(b => b.key === 'content')?.items.filter(i => i.kind === 'section') ?? [];
    return blocks.map(block => {
        const head = block.title ? `<h2 class="opal-course-nav-h" id="opal-course-nav-h-${block.key}">${esc(block.title)}</h2>` : '';
        const label = block.title ? `aria-labelledby="opal-course-nav-h-${block.key}"` : `aria-label="${t('navStudy')}"`;
        const items = block.items.map(item => {
            const index = block.key === 'content' && item.kind === 'section' ? sections.indexOf(item) : -1;
            return renderItem(item, selected, editing, index >= 0 ? { index, total: sections.length } : null, block.key === 'content');
        }).join('');
        return `<div class="opal-course-nav-block" role="group" ${label}>${head}<ul class="opal-course-nav-list">${items}</ul></div>`;
    }).join('');
}

/** Placeholder rows while the course menu is not known yet. */
export function renderSidebarSkeleton(): string {
    const row = (w: number, nested = false) => `<li class="opal-course-nav-li${nested ? ' is-nested' : ''}"><span class="opal-course-nav-item is-skeleton"><span class="opal-course-skel" style="width:${w}px"></span></span></li>`;
    return `<div class="opal-course-nav-block" aria-hidden="true"><ul class="opal-course-nav-list">${row(96)}${row(120)}${row(88)}</ul></div>
      <div class="opal-course-nav-block" aria-hidden="true"><ul class="opal-course-nav-list">${row(72)}${row(104, true)}${row(64, true)}${row(112, true)}</ul></div>`;
}

/** The narrow-screen disclosure that opens the sidebar as a popover. */
export function renderNavToggle(): string {
    return `<button type="button" class="opal-course-nav-toggle" id="${NAV_TOGGLE_ID}" aria-expanded="false" aria-controls="${NAV_ID}">
        <span class="opal-course-nav-toggle-k">${t('navShowLabel')}</span> <span class="opal-course-nav-toggle-v" id="opal-course-nav-toggle-v">${t('overview')}</span>${ICON.chevron}
      </button>`;
}
