/* ━━ University Toolbox Widget ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * External university services as a plain list of link rows.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../i18n/messages/widgets.ts';
import type { Widget } from '../types.ts';

interface ToolboxLink {
    label: string;
    href: string;
    icon: string;
}

const LINKS: ToolboxLink[] = [
    {
        label: 'SELMA',
        href: 'https://selma.tu-dresden.de/',
        icon: '<svg width="15" height="15" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
    },
    {
        label: 'SLUB',
        href: 'https://www.slub-dresden.de/',
        icon: '<svg width="15" height="15" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    },
    {
        label: 'Webmail',
        href: 'https://msx.tu-dresden.de/',
        icon: '<svg width="15" height="15" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    },
    {
        get label() { return t('toolboxMensa'); },
        href: 'https://www.studentenwerk-dresden.de/mensen/speiseplan/',
        icon: '<svg width="15" height="15" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    },
];

/** Quick-access grid of common OPAL tools and external links. */
export const toolboxWidget: Widget = {
    id: 'toolbox',
    opalPortletOrder: '', // Synthetic — no native OPAL portlet
    get title() { return t('toolboxTitle'); },
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
    defaultW: 4,
    defaultH: 3,
    hasNativeConfig: false,

    scrape() {
        return null;
    },

    render(): string {
        const rows = LINKS.map(link => `
      <a href="${link.href}" target="_blank" rel="noopener noreferrer" class="toolbox-tile">
        ${link.icon}
        <span class="text-[13px] text-opal-text">${link.label}</span>
      </a>`).join('');

        return `<div class="flex flex-col">${rows}</div>`;
    },
};
