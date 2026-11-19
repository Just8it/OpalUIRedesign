import { t } from '../../i18n/messages/course.ts';
import { store } from '../../storage/store.ts';
import { families } from '../../storage/registry.ts';
/* Owns sidebar for the course view. */
import type { CourseAnnouncement } from '../types.ts';

import { type BrowsePrefs } from '../browse/index';

import { announcementKey } from '../render/announcements';

import { swap } from '../../motion';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    nav: HTMLElement;
    navFocus: string;
    navOpen: boolean;
    navToggle: HTMLElement;
    freshBanner: CourseAnnouncement | null;
    bannerSeen: string;
    shown: string;
    prefs: BrowsePrefs;
    selected: string;
    persistPrefs: () => void;
    root: HTMLElement;
    activeUrl: string;
    pane: HTMLElement;
    render: () => void;
    announce: (text: string, delay?: number) => void;
    paneTitle: HTMLElement;
    paneSummary: HTMLElement;
    bannerKey: (id: string) => string;
    courseId: string;
}

export function createSidebar(context: Context) {
    const navItems = () => Array.from(context.nav.querySelectorAll<HTMLElement>('[data-nav]'));

    function syncRoving() {
        const items = navItems();
        if (!items.length) return;
        const target =
            items.find((i) => i.dataset.nav === context.navFocus) ??
            items.find((i) => i.getAttribute('aria-current') === 'true') ??
            items[0];
        for (const i of items) i.tabIndex = i === target ? 0 : -1;
    }

    const setNavOpen = (open: boolean, focusToggle = false) => {
        context.navOpen = open;
        context.nav.classList.toggle('is-open', open);
        context.navToggle.setAttribute('aria-expanded', String(open));
        if (open)
            (context.nav.querySelector<HTMLElement>('[data-nav][tabindex="0"]') ?? navItems()[0])?.focus({
                preventScroll: true,
            });
        else if (focusToggle) context.navToggle.focus({ preventScroll: true });
    };

    const dismissBanner = () => {
        if (!context.freshBanner) return;
        context.bannerSeen = announcementKey(context.freshBanner);
        try {
            void store.set(families.announcementSeen(context.courseId), context.bannerSeen)
                .catch(() => {});
        } catch {
            /* context gone */
        }
    };

    const select = (id: string) => {
        const wasOpen = context.navOpen;
        if (id !== context.shown || id !== (context.prefs.selected ?? 'all')) {
            context.selected = id;
            context.prefs = { ...context.prefs, selected: id };
            context.persistPrefs();
            context.root.scrollTop = 0;
            context.activeUrl = '';
            void swap(context.pane, context.render);
        }
        if (wasOpen) setNavOpen(false, true);
        context.announce(
            context.paneSummary.textContent
                ? t('navSelectionWithSummary', { title: context.paneTitle.textContent ?? '', summary: context.paneSummary.textContent })
                : context.paneTitle.textContent ?? '',
            150,
        );
    };
    return { navItems, syncRoving, setNavOpen, dismissBanner, select };
}
