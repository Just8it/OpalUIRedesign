/* Owns home pane for the course view. */
import { homeBlockTitle } from '../home/config.ts';
import { t } from '../../i18n/messages/course.ts';
import { entriesSignature } from './snapshot';

import type { CourseAnnouncement, CourseLoadState, CourseSection, CourseSnapshot } from '../types';

import { locate, type Located, type OpenedMap } from '../find/index';
import { buildNav, type BrowseLayout, type BrowsePrefs, type NavBlock } from '../browse/index';
import { buildHome, defaultHome, normaliseHome } from '../home/index';
import type { HomeConfig, HomeModel } from '../home/types';
import { renderHome, renderHomeSkeleton } from '../render/home';
import { type HomeRenderState } from '../render/home-shared';
import { ICON } from '../render/format';
import { countLine, metaLine } from '../render/header';
import { findPlaceholder } from '../render/find-field';
import { findItem, renderSidebar } from '../render/sidebar';

import { announcementKey, bannerAnnouncement, renderBanner } from '../render/announcements';

import { enter } from '../../motion';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    frame: number;
    updateProgress: () => ProgressView;
    root: HTMLElement;
    layout: BrowseLayout;
    snapshot: CourseSnapshot | null;
    table: HTMLElement;
    homeBox: HTMLElement;
    paneTitle: HTMLElement;
    homeConfig: HomeConfig | null;
    effectiveSections: (snap: CourseSnapshot) => CourseSection[];
    lastAnnouncements: CourseAnnouncement[];
    load: CourseLoadState | null;
    locatedSig: string;
    located: Located[];
    ensurePrefs: (snap: CourseSnapshot) => void;
    titleEl: HTMLElement;
    findInput: HTMLInputElement;
    metaText: HTMLElement;
    homeReady: boolean;
    rawHome: unknown;
    persistHome: () => void;
    homeModel: HomeModel;
    homeProgress: CourseProgress;
    opened: OpenedMap;
    editing: boolean;
    homeState: HomeRenderState;
    navBlocks: NavBlock[];
    prefs: BrowsePrefs;
    selection: () => string;
    shown: string;
    setBox: (key: string, box: HTMLElement, sig: string, html: () => string) => boolean;
    nav: HTMLElement;
    syncIndicator: () => void;
    syncRoving: () => void;
    navToggleValue: HTMLElement;
    freshBanner: CourseAnnouncement | null;
    bannerSeen: string;
    query: string;
    banner: HTMLElement;
    pane: HTMLElement;
    paneHead: HTMLElement;
    paneSummary: HTMLElement;
    emptyBox: HTMLElement;
    annBox: HTMLElement;
    docBox: HTMLElement;
    globalSearch: HTMLElement;
    hint: boolean;
    homeEntered: boolean;
    renderAnnouncements: (anns: CourseAnnouncement[], previousVisit: number) => void;
    renderList: (view: CourseSnapshot, sel: string) => void;
    savedScroll: number | null;
    lastPhase: string;
    announce: (text: string, delay?: number) => void;
}

export function createHomePane(context: Context) {
    const render = () => {
        context.frame = 0;
        const pv = context.updateProgress();
        context.root.dataset.density = context.layout.density;
        const snap = context.snapshot;
        if (!snap) {
            context.table.hidden = true;
            context.homeBox.hidden = false;
            context.paneTitle.textContent = t('overview');
            context.homeBox.innerHTML = renderHomeSkeleton(context.homeConfig?.blocks.map((b) => b.title));
            return;
        }

        const sections = context.effectiveSections(snap);
        if (snap.announcements.length) context.lastAnnouncements = snap.announcements;
        const loading = context.load?.phase === 'loading' || context.load?.phase === 'cache';
        const anns = snap.announcements.length ? snap.announcements : loading ? context.lastAnnouncements : [];
        const view: CourseSnapshot = { ...snap, sections, announcements: anns };

        const sig = entriesSignature(sections);
        if (sig !== context.locatedSig) {
            context.locatedSig = sig;
            context.located = locate(sections);
        }
        context.ensurePrefs(view);

        if (context.titleEl.textContent !== snap.title) {
            context.titleEl.textContent = snap.title;
            context.findInput.placeholder = findPlaceholder(snap.title);
            context.findInput.setAttribute('aria-label', t('findNamedCourse', { title: snap.title }));
        }
        const counts = countLine(context.located.map((i) => i.entry));
        const meta = metaLine(snap.semester, pv.visible ? pv.text : counts);
        if (context.metaText.textContent !== meta) context.metaText.textContent = meta;

        if (context.homeReady && !context.homeConfig) {
            context.homeConfig = context.rawHome ? normaliseHome(context.rawHome) : defaultHome(view, context.located);
            // Wait for complete data before persisting a first-visit default.
            if (context.load?.phase === 'done') context.persistHome();
            else if (!context.rawHome) context.homeConfig = null;
        }
        const config =
            context.homeConfig ??
            (context.rawHome ? normaliseHome(context.rawHome) : defaultHome(view, context.located));
        context.homeModel = buildHome({
            snapshot: view,
            located: context.located,
            config,
            progress: context.homeProgress,
            opened: context.opened,
            editing: context.editing,
        });
        context.homeState.progress = context.homeProgress;
        context.homeState.editing = context.editing;
        context.homeState.previousVisit = snap.previousVisit;
        context.navBlocks = buildNav(view, context.located, context.opened, context.prefs, context.editing);
        const sel = context.selection();
        context.shown = sel;
        context.setBox('nav', context.nav, JSON.stringify([context.navBlocks, context.editing]), () =>
            renderSidebar(context.navBlocks, sel, context.editing),
        );
        for (const item of context.nav.querySelectorAll<HTMLElement>('[data-nav]')) {
            if (item.dataset.nav === sel) item.setAttribute('aria-current', 'true');
            else item.removeAttribute('aria-current');
        }
        context.syncIndicator();
        context.syncRoving();
        const label = findItem(context.navBlocks, sel)?.label ?? t('overview');
        if (context.navToggleValue.textContent !== label) context.navToggleValue.textContent = label;

        context.freshBanner = bannerAnnouncement(anns, snap.previousVisit, context.bannerSeen);
        const bannerShown =
            sel === 'home' && !context.query.trim() && context.homeModel.blocks.some((b) => b.kind === 'announcements')
                ? null
                : context.freshBanner;
        context.setBox('banner', context.banner, bannerShown ? announcementKey(bannerShown) : '', () =>
            renderBanner(bannerShown),
        );

        const onHome = sel === 'home' && !context.query.trim();
        context.homeBox.hidden = !onHome;
        if (onHome) {
            context.pane.insertBefore(context.paneHead, context.table);
            context.paneTitle.textContent = t('overview');
            context.paneSummary.textContent = '';
            context.table.hidden = true;
            context.emptyBox.hidden = true;
            context.annBox.hidden = true;
            context.docBox.hidden = true;
            context.globalSearch.hidden = true;
            const homeHtml =
                (context.hint && !context.editing
                    ? `<div class="opal-course-home-hint"><span>${t('homeOverviewHint')}</span><button type="button" class="opal-btn opal-btn-sm" data-home="customize">${t('customize')}</button><button type="button" class="opal-course-home-hint-close" data-home="hint" aria-label="${t('closeHint')}">${ICON.close}</button></div>`
                    : '') +
                (context.homeModel.blocks.length || context.homeModel.hidden.length
                    ? renderHome(context.homeModel, context.homeState)
                    : loading
                      ? renderHomeSkeleton(config.blocks.map((b) => homeBlockTitle(b, snap)))
                      : `<p class="opal-course-empty">${t('homeEmpty')}</p>`);
            context.setBox('home', context.homeBox, homeHtml, () => homeHtml);
            if (!context.homeEntered && context.homeModel.blocks.length) {
                context.homeEntered = true;
                void enter(context.homeBox);
            }
            // Match row partners only while the shorter block is at least half as tall.
            const blocks = Array.from(context.homeBox.querySelectorAll<HTMLElement>('.opal-course-home-block'));
            for (const b of blocks) b.style.minHeight = '';
            for (let i = 0; i + 1 < blocks.length; i += 2) {
                const a = blocks[i],
                    b = blocks[i + 1];
                if (a.offsetTop !== b.offsetTop) continue;
                const max = Math.max(a.offsetHeight, b.offsetHeight),
                    min = Math.min(a.offsetHeight, b.offsetHeight);
                if (max <= min * 2) {
                    a.style.minHeight = `${max}px`;
                    b.style.minHeight = `${max}px`;
                }
            }
        } else if (sel === 'ann' && !context.query.trim()) context.renderAnnouncements(anns, snap.previousVisit);
        else context.renderList(view, sel);

        if (context.savedScroll !== null && !context.query.trim()) {
            context.root.scrollTop = context.savedScroll;
            context.savedScroll = null;
        }

        const phase = context.load?.phase ?? '';
        if (phase !== context.lastPhase) {
            if (phase === 'loading' && context.lastPhase !== 'loading') context.announce(t('loadingSections'));
            if (phase === 'done') context.announce(t('courseLoaded', { counts }));
            context.lastPhase = phase;
        }
    };
    return { render };
}

import type { ProgressView } from '../render/header';
import type { CourseProgress } from '../home/types';
