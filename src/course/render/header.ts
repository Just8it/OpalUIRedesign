/* ━━ Course view: page header and loading strip ━━━━━━━━━━━━━━━━
 * One 48px row: the course title, a muted meta line (semester and
 * count, or the loading progress), and on the right "Aktualisieren"
 * (icon) and "Originalansicht" (the way back, so it keeps its word).
 * A 2px progress strip lies on the header's bottom rule while
 * sections load. Rendered once at mount; view.ts patches text only.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../../i18n/messages/course.ts';
import type { CourseLoadState } from '../types.ts';
import { ICON, esc } from './format.ts';

export function renderHeader(title: string): string {
    return `<header class="opal-course-header">
      <div class="opal-course-heading">
        <h1 class="opal-course-h1" id="opal-course-title">${esc(title)}</h1>
        <p class="opal-course-meta" id="opal-course-meta-text">${t('loadingEllipsis')}</p>
      </div>
      <div class="opal-course-tools">
        <button type="button" class="opal-course-icon-btn" id="opal-course-refresh" aria-label="${t('refresh')}" title="${t('refresh')}">${ICON.refresh}</button>
        <button type="button" class="opal-course-tool" id="opal-course-original" title="${t('originalHint')}">${t('originalView')}</button>
      </div>
      <div class="opal-course-progress" id="opal-course-progress" role="progressbar" aria-label="${t('loadingAria')}" aria-valuemin="0">
        <div class="opal-cmd-progress-fill is-indeterminate" id="opal-course-progress-fill"></div>
      </div>
    </header>`;
}

/** "Wintersemester 2026 / 2027 · 41 Dateien"; while loading the
 *  progress text takes the place of the (still partial) count. */
export function metaLine(semester: string | undefined, counts: string): string {
    return [semester, counts].filter(Boolean).join(' · ');
}

/** "41 Dateien", "17 Dateien und 8 Links". */
export function countLine(entries: readonly { kind: string }[]): string {
    const files = entries.filter(e => e.kind === 'file').length;
    const links = entries.length - files;
    if (files && links) return t('fileAndLinkCount', { files: t('fileCount', { count: files }), links: t('linkCount', { count: links }) });
    return links ? t('linkCount', { count: links }) : t('fileCount', { count: files });
}

export interface ProgressView {
    visible: boolean;
    determinate: boolean;
    /** 0..100 */
    percent: number;
    text: string;
}

export function progressView(state: CourseLoadState | null): ProgressView {
    if (!state) return { visible: true, determinate: false, percent: 0, text: t('loadingCourse') };
    if (state.phase === 'cache') return { visible: true, determinate: false, percent: 0, text: t('checkingChanges') };
    if (state.phase !== 'loading') return { visible: false, determinate: false, percent: 0, text: '' };
    if (state.total <= 0) return { visible: true, determinate: false, percent: 0, text: t('loadingCourse') };
    const loaded = Math.min(state.loaded, state.total);
    return { visible: true, determinate: true, percent: Math.round((loaded / state.total) * 100), text: t('loadingProgress', { loaded, total: state.total }) };
}
