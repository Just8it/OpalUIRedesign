/* ━━ Course view: a lecturer's page ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Pages such as "Ablaufplan" or the course start page carry what a file
 * list cannot: who teaches, rooms, the week-by-week schedule, notices.
 * The html is already reduced to a safe subset by parsers.sanitizePage;
 * here it only gets a frame. The reading styles (type, tables, notices)
 * live under .opal-course-doc so OPAL's own colours never reach it.
 *
 * Progressive disclosure, so text never buries the files:
 *   - a page that is only text is shown whole (it is the content);
 *   - a page that also links files shows a few lines that fade out,
 *     with "Mehr anzeigen"; view.ts drops the toggle when it all fits;
 *   - in lists (Übungen, Alle Dateien) it is one line, see list.ts;
 *   - on the overview, a clipped preview with "Ganze Seite".
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
import { sectionTitle } from '../tree.ts';
import { t } from '../../i18n/messages/course.ts';
import type { CourseSection } from '../types.ts';
import type { PageBlock } from '../home/types.ts';
import { withoutTitleLine } from '../parsers.ts';
import { esc, href, ICON, NEW_TAB } from './format.ts';
import { homeButton as button } from './home-shared.ts';

export interface PageDocOptions {
    /** Repeated course name in the first line is dropped. */
    courseTitle: string;
    /** Show a few lines with "Mehr anzeigen" (the page also has files). */
    clamp: boolean;
    open: boolean;
}

export function renderPageDoc(section: Pick<CourseSection, 'nodeId' | 'title' | 'html' | 'htmlTruncated' | 'url'> & Partial<Pick<CourseSection, 'kind' | 'rawType'>>, o: PageDocOptions): string {
    const html = withoutTitleLine(section.html ?? '', o.courseTitle);
    const clamped = o.clamp && !o.open;
    const id = esc(section.nodeId);
    const toggle = o.clamp
        ? `<button type="button" class="opal-course-intro-toggle" data-doc-toggle="${id}" data-fk="doc:${id}" aria-expanded="${o.open}" aria-controls="opal-course-doc-${id}">${o.open ? t('showLess') : t('showMore')}</button>`
        : '';
    const cut = section.htmlTruncated && (!clamped)
        ? `<p class="opal-course-doc-cut">${t('pageTruncated')} <a href="${href(section.url)}" ${NEW_TAB}>${t('fullPageOpalOpen')}${ICON.external}</a></p>`
        : '';
    return `<article class="opal-course-doc${clamped ? ' is-clamped' : ''}" id="opal-course-doc-${id}" aria-label="${esc(sectionTitle(section))}">${html}</article>${toggle}${cut}`;
}

export function renderHomePage(block: PageBlock): string {
    return `<div class="opal-course-doc is-preview">${block.html}</div>${button('browse', t('fullPage'), block.config.id, `aria-label="${esc(t('fullPageNamed', { title: block.config.title }))}"`)}`;
}
