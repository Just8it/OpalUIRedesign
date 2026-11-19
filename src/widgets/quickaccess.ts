/* ━━ Quick Access Widget (Erste Schritte) ━━━━━━━━━━━━━━━━━━━
 * OPAL's own "Erste Schritte" buttons are Wicket controls this
 * widget cannot trigger. It links the two sections of OPAL's main
 * navigation that work from here. Search is not repeated: the top
 * bar already has it.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../i18n/messages/widgets.ts';
import type { Widget } from '../types.ts';

export const quickaccessWidget: Widget = {
  id: 'quickaccess',
  opalPortletOrder: 'FirstStepsPortlet',
  requires: null,
  get title() { return t('quickaccessTitle'); },
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  defaultW: 4,
  defaultH: 3,
  hasNativeConfig: false,

  scrape() {
    return null;
  },

  render(): string {
    const book = '<svg class="opal-row-icon" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
    const list = '<svg class="opal-row-icon" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
    return `
      <div>
        <a class="opal-row" href="/opal/auth/resource/resources">
          ${book}
          <span class="opal-row-title">${t('quickaccessResources')}</span>
        </a>
        <a class="opal-row" href="/opal/auth/repository/catalog">
          ${list}
          <span class="opal-row-title">${t('quickaccessCatalog')}</span>
        </a>
      </div>`;
  },
};
