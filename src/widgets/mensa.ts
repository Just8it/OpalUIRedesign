import { dateForOffset } from '../mensa-store';
/* ━━ Mensa Widget (Studentenwerk Dresden) ━━━━━━━━━━━━━━━━━━━━
 * Meals are plain rows separated by a hairline: name, then price,
 * category and diet notes as muted text, and a favourite toggle.
 * Colors: always via text-opal-* / bg-opal-* tokens.
 * No hardcoded hex in TypeScript. No dynamic Tailwind interpolation.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { formatDate, formatNumber } from '../i18n/core.ts';
import { t } from '../i18n/messages/widgets.ts';
import type { Widget } from '../types.ts';
import { escapeAttr, escapeHtml } from '../utils';
import {
    getCachedMensaState,
    getMensaSettings,
    getViewState,
    getFavoritesViewData,
    CANTEENS,
    type MensaMeal,
    type FavViewEntry,
    type MensaWidgetData,
} from '../mensa-store';

/* ── Diet notes ────────────────────────────────────────────── */

function getDietNotes(notes: string[]): string[] {
    const lower = notes.map(n => n.toLowerCase());
    const out: string[] = [];
    if (lower.some(n => n.includes('vegan') || n === 'vg'))
        out.push(t('mensaVegan'));
    else if (lower.some(n => n.includes('vegetarisch') || n === 'v'))
        out.push(t('mensaVegetarian'));
    if (lower.some(n => n.includes('regional')))
        out.push(t('mensaRegional'));
    if (lower.some(n => n.includes('bio')))
        out.push(t('mensaOrganic'));
    return out;
}

function formatPrice(price: number | null): string {
    if (!price) return '';
    return t('mensaPrice', { price: formatNumber(price, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) });
}

const HEART_PATH = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';

function heartIcon(filled: boolean): string {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${HEART_PATH}"/></svg>`;
}

/* ── Meal row ──────────────────────────────────────────────── */

function renderMeal(meal: MensaMeal, isFav: boolean): string {
    const price = formatPrice(meal.prices.students);
    const encodedName = encodeURIComponent(meal.name);
    /* meal names come from API in ALL CAPS; .mensa-meal-name applies text-transform:capitalize via CSS */
    const displayName = meal.name.toLowerCase();
    const meta = [price, meal.category, ...getDietNotes(meal.notes)].filter(Boolean).join(' · ');
    const favLabel = isFav ? t('mensaRemoveFavourite') : t('mensaAddFavourite');

    return `
    <div class="mensa-meal-card flex items-start gap-2 py-2">
      <div class="flex-1 min-w-0">
        <p class="mensa-meal-name text-[13px] text-opal-text leading-snug">${escapeHtml(displayName)}</p>
        ${meta ? `<p class="text-xs text-opal-text-muted mt-0.5">${escapeHtml(meta)}</p>` : ''}
      </div>
      <button type="button" class="cal-nav-btn mensa-fav-btn ${isFav ? 'mensa-fav-on' : ''}"
              data-meal-name="${escapeAttr(encodedName)}"
              aria-pressed="${isFav}"
              aria-label="${escapeAttr(t(isFav ? 'mensaRemoveMeal' : 'mensaAddMeal', { meal: displayName }))}"
              title="${favLabel}">
        ${heartIcon(isFav)}
      </button>
    </div>`;
}

function canteenLabel(id: number): string {
    return CANTEENS.find(c => c.id === id)?.name ?? t('mensaUnknownCanteen', { id: String(id) });
}

/* ── Date label ────────────────────────────────────────────── */

function dateLabel(offset: number, dateStr: string): string {
    if (offset === 0) return t('sharedToday');
    if (offset === 1) return t('sharedTomorrow');
    if (offset === -1) return t('sharedYesterday');
    const d = new Date(dateStr + 'T12:00:00');
    return formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ── Nav bar ─────────────────────────────────────────────── */

function iconBtn(extraCls: string, delta: number, label: string, chevronPoints: string): string {
    return `<button type="button" class="cal-nav-btn ${extraCls}" data-delta="${delta}" aria-label="${label}" title="${label}">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${chevronPoints}"/></svg>
    </button>`;
}

function renderNavBar(
    dateOffset: number,
    dateStr: string,
    canteenName: string,
    multipleCanteens: boolean,
    showFavorites: boolean,
    compact: boolean,
): string {
    const prevDay  = iconBtn('mensa-nav-date',    -1, t('mensaPreviousDay'), '15 18 9 12 15 6');
    const nextDay  = iconBtn('mensa-nav-date',     1, t('mensaNextDay'),   '9 18 15 12 9 6');
    const prevMens = iconBtn('mensa-nav-canteen', -1, t('mensaPreviousCanteen'),'15 18 9 12 15 6');
    const nextMens = iconBtn('mensa-nav-canteen',  1, t('mensaNextCanteen'),  '9 18 15 12 9 6');

    const starBtn = `
      <button type="button" class="cal-nav-btn mensa-toggle-favview ${showFavorites ? 'mensa-fav-active' : ''}"
              aria-pressed="${showFavorites}" aria-label="${t('mensaOnlyFavourites')}" title="${t(showFavorites ? 'mensaAllMeals' : 'mensaOnlyFavourites')}">
        ${heartIcon(showFavorites)}
      </button>`;

    const canteenOrFav = showFavorites
        ? `<span class="text-[13px] text-opal-text px-1">${t('mensaCanteenFavourites')}</span>`
        : multipleCanteens
            ? `${prevMens}<span class="text-xs text-opal-text-muted truncate text-center ${compact ? 'flex-1' : 'max-w-[140px]'} px-1">${escapeHtml(canteenName)}</span>${nextMens}`
            : `<span class="text-xs text-opal-text-muted truncate ${compact ? '' : 'max-w-[160px]'} px-1">${escapeHtml(canteenName)}</span>`;

    const dayNav = `
        <div class="flex items-center gap-0.5">
          ${prevDay}
          <span class="text-[13px] text-opal-text min-w-[56px] text-center" aria-live="polite">${dateLabel(dateOffset, dateStr)}</span>
          ${nextDay}
        </div>`;

    if (!compact) {
        /* Wide layout: single row — date | fav heart + canteen switcher */
        return `
        <div class="flex items-center justify-between mb-1 gap-2">
          ${dayNav}
          <div class="flex items-center gap-0.5 min-w-0">
            ${canteenOrFav}
            ${starBtn}
          </div>
        </div>`;
    }

    /* Compact layout: two rows */
    return `
    <div class="flex flex-col gap-1 mb-1">
      <div class="flex items-center justify-between gap-2">
        ${dayNav}
        ${starBtn}
      </div>
      <div class="flex items-center gap-0.5 min-w-0">
        ${canteenOrFav}
      </div>
    </div>`;
}

function emptyState(title: string, hint: string, extra = ''): string {
    return `
      <div class="opal-empty">
        <p class="opal-empty-title">${title}</p>
        ${hint ? `<p class="opal-empty-hint">${hint}</p>` : ''}
        ${extra}
      </div>`;
}

/* ── Favorites cross-canteen view ──────────────────────────── */

function renderFavoritesView(
    favData: FavViewEntry[],
    favSet: Set<string>,
    hasSavedFavorites: boolean,
    nav: string,
    dateOffset: number,
): string {
    if (!hasSavedFavorites) {
        return `<div>${nav}${emptyState(
            t('mensaNoFavourites'),
            t('mensaNoFavouritesHint'),
        )}</div>`;
    }

    if (favData.length === 0) {
        const emptyKey = dateOffset === 0 ? 'mensaNoFavouritesToday'
            : dateOffset === 1 ? 'mensaNoFavouritesTomorrow' : 'mensaNoFavouritesThatDay';
        return `<div>${nav}${emptyState(
            t(emptyKey),
            t('mensaUnavailableFavourites'),
        )}</div>`;
    }

    const sections = favData.map((entry, i) => `
        <div class="${i > 0 ? 'mt-3' : ''}">
          <p class="text-xs font-medium text-opal-text-muted pt-1">${escapeHtml(canteenLabel(entry.canteenId))}</p>
          <div>
            ${entry.meals.map(m => renderMeal(m, favSet.has(m.name))).join('')}
          </div>
        </div>`).join('');

    return `<div>${nav}<div>${sections}</div></div>`;
}

/* ── Widget definition ─────────────────────────────────────── */

export const mensaWidget: Widget<MensaWidgetData> = {
    id: 'mensa',
    opalPortletOrder: '',
    get title() { return t('mensaTitle'); },
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    defaultW: 4,
    defaultH: 4,
    minW: 3,
    hasNativeConfig: false,
    hasSettings: true,

    scrape() {
        return {
            state:     getCachedMensaState(),
            settings:  getMensaSettings(),
            viewState: getViewState(),
            favData:   getFavoritesViewData(),
        };
    },

    render(data, _widgetH?: number, widgetW?: number): string {
        const { state, settings, viewState, favData } = data as {
            state:     ReturnType<typeof getCachedMensaState>;
            settings:  ReturnType<typeof getMensaSettings>;
            viewState: ReturnType<typeof getViewState>;
            favData:   FavViewEntry[];
        };

        const compact = (widgetW ?? this.defaultW) < 5;
        const favSet = new Set(settings.favoriteNames);
        const canteenName = canteenLabel(state.canteenId);
        const multipleCanteens = settings.favoriteCanteenIds.length > 1;
        const dateStr = state.date || dateForOffset(0);

        const nav = renderNavBar(state.dateOffset, dateStr, canteenName, multipleCanteens, viewState.showFavorites, compact);

        if (viewState.showFavorites) {
            return renderFavoritesView(favData, favSet, settings.favoriteNames.length > 0, nav, state.dateOffset);
        }

        if (state.error) {
            return `<div>${nav}${emptyState(
                t('mensaLoadError'),
                escapeHtml(t('mensaLoadErrorHint', { canteen: canteenName })),
                `<button type="button" class="opal-btn mensa-retry mt-2">${t('sharedRetry')}</button>`,
            )}</div>`;
        }

        /* No date yet means the first request has not finished. */
        if (!state.date) {
            return `<div>${nav}${emptyState(t('mensaLoading'), '')}</div>`;
        }

        if (state.meals.length === 0) {
            return `<div>${nav}${emptyState(
                t('mensaNoMenu'),
                escapeHtml(t('mensaNoMenuHint', { canteen: canteenName })),
            )}</div>`;
        }

        /* Favourites float to top */
        const meals = [...state.meals]
            .sort((a, b) => (favSet.has(b.name) ? 1 : 0) - (favSet.has(a.name) ? 1 : 0));

        return `<div>${nav}<div>${meals.map(m => renderMeal(m, favSet.has(m.name))).join('')}</div></div>`;
    },
};
