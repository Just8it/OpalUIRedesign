/* ━━ Course view: customising bar ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Opened from the avatar menu ("Kursansicht anpassen"). The top bar
 * then carries Zurücksetzen, Darstellung and Fertig, as on the
 * dashboard; this slim bar above both panes only holds the file
 * list's own settings, which apply to the list in every course:
 * density (one choice of two) and columns (three independent toggles).
 * Blocks are arranged in the overview pane, sections in the sidebar,
 * both by dragging their grip.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../../i18n/messages/course.ts';
import type { BrowseLayout } from '../browse/types.ts';

export const EDIT_BAR_ID = 'opal-course-editbar';

export function renderEditBar(layout: BrowseLayout): string {
    // Density is one choice: a radiogroup with roving focus (arrow keys, see the controller).
    const density = (value: BrowseLayout['density'], label: string) =>
        `<button type="button" role="radio" data-density="${value}" aria-checked="${layout.density === value}" tabindex="${layout.density === value ? 0 : -1}">${label}</button>`;
    // Columns are independent: each is its own toggle with a checkmark.
    const column = (key: keyof BrowseLayout['columns'], label: string) =>
        `<button type="button" data-column="${key}" aria-pressed="${layout.columns[key]}">${label}</button>`;
    return `<h2 class="opal-course-editbar-title" id="opal-course-editbar-h">${t('editFileList')}</h2>
      <div class="opal-course-editbar-field"><span class="opal-course-editbar-label" id="opal-course-editbar-d">${t('editDensity')}</span><span class="opal-seg" role="radiogroup" aria-labelledby="opal-course-editbar-d">${density('compact', t('densityCompact'))}${density('normal', t('densityNormal'))}</span></div>
      <div class="opal-course-editbar-field" role="group" aria-labelledby="opal-course-editbar-c"><span class="opal-course-editbar-label" id="opal-course-editbar-c">${t('editColumns')}</span><span class="opal-seg opal-seg-multi">${column('type', t('columnType'))}${column('size', t('columnSize'))}${column('modified', t('columnModified'))}</span></div>`;
}
