/* Owns shell rendering and helpers. */

import { t } from '../../i18n/messages/course.ts';
import { ICON } from '../render/format';
import { renderHeader } from '../render/header';
import { LIST_ID, renderFindField } from '../render/find-field';
import { NAV_ID, renderNavToggle, renderSidebarSkeleton } from '../render/sidebar';

import { EDIT_BAR_ID } from '../render/edit-bar';

import { GRIP_HINT_ID } from '../render/home-edit';

/** The shared top bar, adjusted for a course: the wordmark leads home and
 *  the search trigger becomes the course find field, so the page has one
 *  search control. Ctrl+K keeps opening the palette over all of OPAL. */
export function adaptTopbar(root: HTMLElement, courseTitle: string): void {
    const trigger = root.querySelector('#opal-cmd-trigger');
    const slot = document.createElement('div');
    slot.className = 'opal-course-find-slot';
    slot.innerHTML = renderFindField(courseTitle);
    if (trigger?.parentElement) trigger.parentElement.replaceWith(slot);
    else root.querySelector('.opal-course-page')?.prepend(slot);
    const mark = root.querySelector('.opal-wordmark');
    if (mark) {
        const link = document.createElement('a');
        link.className = 'opal-wordmark opal-course-home';
        link.href = '/opal/home';
        link.textContent = mark.textContent;
        link.setAttribute('aria-label', t('opalHome'));
        mark.replaceWith(link);
    }
}

export function shellHtml(title: string): string {
    return `<main class="opal-course-page" aria-labelledby="opal-course-title">
      ${renderHeader(title)}
      <p class="sr-only" id="opal-course-status" role="status" aria-live="polite"></p>
      <p class="opal-course-empty" id="opal-course-load-error" role="status" hidden></p>
      <p class="sr-only" id="${GRIP_HINT_ID}">${t('gripHint')}</p>
      <div class="opal-course-editbar" id="${EDIT_BAR_ID}" role="region" aria-labelledby="opal-course-editbar-h" hidden></div>
      <div class="opal-course-panes">
        ${renderNavToggle()}
        <nav class="opal-course-sidebar" id="${NAV_ID}" aria-label="${t('navShow')}">${renderSidebarSkeleton()}</nav>
        <section class="opal-course-pane" aria-labelledby="opal-course-pane-title">
          <div id="opal-course-banner"></div>
          <div class="opal-course-pane-head">
            <h2 class="opal-course-pane-title" id="opal-course-pane-title" tabindex="-1">${t('overview')}</h2>
            <span class="opal-course-pane-summary" id="opal-course-pane-summary"></span>
            <button type="button" class="opal-course-global" id="opal-course-search-global" aria-label="${t('searchGlobal')}" title="${t('searchGlobalShortcut')}" hidden>${ICON.search}</button>
          </div>
          <div class="opal-course-doc-box" id="opal-course-doc" hidden></div>
          <div class="opal-course-table" id="${LIST_ID}" role="table" aria-labelledby="opal-course-pane-title">
            <div role="rowgroup" class="opal-course-thead" id="opal-course-thead"></div>
          </div>
          <div id="opal-course-home-view" hidden></div>
          <div class="opal-course-empty-box" id="opal-course-empty" hidden></div>
          <div class="opal-course-ann-box" id="opal-course-anns" hidden></div>
        </section>
      </div>
    </main>`;
}
