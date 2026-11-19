import { localeTag } from '../i18n/core.ts';
import { t, type PageMessageKey } from '../i18n/messages/pages.ts';

/** Apply the translations for the static text and attributes shared by the extension pages. */
export function localizePage(): void {
    document.documentElement.lang = localeTag();
    for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
        element.textContent = t(element.dataset.i18n as PageMessageKey);
    }
    for (const attribute of ['aria-label', 'placeholder']) {
        const marker = `data-i18n-${attribute}`;
        for (const element of document.querySelectorAll(`[${marker}]`)) {
            element.setAttribute(attribute, t(element.getAttribute(marker) as PageMessageKey));
        }
    }
}
