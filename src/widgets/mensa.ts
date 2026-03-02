/* ━━ Mensa Widget (Studentenwerk Dresden) ━━━━━━━━━━━━━━━━━━━━
 * Design language: DESIGN.md — Deep Space Glassmorphism.
 * Colors: always via text-opal-* / bg-opal-* tokens.
 * Font: Inter via --font-sans (inherited from #opal-modern-ui).
 * No hardcoded hex in TypeScript. No dynamic Tailwind interpolation.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';
import { escapeHtml } from '../utils';
import {
    getCachedMensaState,
    getMensaSettings,
    getViewState,
    getFavoritesViewData,
    CANTEENS,
    type MensaMeal,
    type FavViewEntry,
} from '../mensa-store';

/* ── Diet badge helpers ────────────────────────────────────── */
/* Static class maps — never interpolate Tailwind class strings dynamically */

interface Badge { label: string; cls: string; }

const BADGE_VG:       Badge = { label: 'VG',      cls: 'bg-opal-success/10 text-opal-success border-opal-success/20' };
const BADGE_V:        Badge = { label: 'V',        cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
const BADGE_REGIONAL: Badge = { label: 'Regional', cls: 'bg-opal-warning/10 text-opal-warning border-opal-warning/20' };
const BADGE_BIO:      Badge = { label: 'Bio',      cls: 'bg-opal-success/10 text-opal-success border-opal-success/20' };

function getBadges(notes: string[]): Badge[] {
    const lower = notes.map(n => n.toLowerCase());
    const badges: Badge[] = [];
    if (lower.some(n => n.includes('vegan') || n === 'vg'))
        badges.push(BADGE_VG);
    else if (lower.some(n => n.includes('vegetarisch') || n === 'v'))
        badges.push(BADGE_V);
    if (lower.some(n => n.includes('regional')))
        badges.push(BADGE_REGIONAL);
    if (lower.some(n => n.includes('bio')))
        badges.push(BADGE_BIO);
    return badges;
}

function formatPrice(price: number | null): string {
    if (!price) return '';
    return price.toFixed(2).replace('.', ',') + '\u202f\u20ac';
}

/* ── Meal card ─────────────────────────────────────────────── */

function renderMeal(meal: MensaMeal, isFav: boolean): string {
    const price = formatPrice(meal.prices.students);
    const badges = getBadges(meal.notes);
    const encodedName = encodeURIComponent(meal.name);
    /* meal names come from API in ALL CAPS; .mensa-meal-name applies text-transform:capitalize via CSS */
    const displayName = meal.name.toLowerCase();

    const badgeHtml = badges.map(b =>
        `<span class="text-[9px] px-1.5 py-0.5 rounded-full ${b.cls} font-bold border">${b.label}</span>`
    ).join('');

    /* Heart icon: currentColor so the parent's text-opal-* class controls the color */
    const heartPath = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';
    const favIcon = isFav
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="${heartPath}"/></svg>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${heartPath}"/></svg>`;

    return `
    <div class="mensa-meal-card p-2.5">
      <div class="flex justify-between items-start gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-start gap-1.5">
            <p class="mensa-meal-name text-xs font-semibold text-opal-text leading-snug flex-1">${escapeHtml(displayName)}</p>
            ${isFav ? '<span class="text-[8px] px-1 py-0.5 rounded-full bg-opal-accent/10 text-opal-accent border border-opal-accent/20 font-bold flex-shrink-0 mt-0.5">\u2605</span>' : ''}
          </div>
          ${badgeHtml ? `<div class="flex gap-1 flex-wrap mt-1">${badgeHtml}</div>` : ''}
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          ${price ? `<span class="text-[10px] font-bold text-opal-accent">${price}</span>` : ''}
          <button class="mensa-fav-btn ${isFav ? 'text-opal-accent' : 'text-opal-text-muted hover:text-opal-accent'} transition-all leading-none p-0.5"
                  data-meal-name="${encodedName}"
                  title="${isFav ? 'Aus Favoriten entfernen' : 'Als Favorit merken'}">
            ${favIcon}
          </button>
        </div>
      </div>
    </div>`;
}

/* ── Date label ────────────────────────────────────────────── */

function dateLabel(offset: number, dateStr: string): string {
    if (offset === 0) return 'Heute';
    if (offset === 1) return 'Morgen';
    if (offset === -1) return 'Gestern';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ── Nav bar ─────────────────────────────────────────────────
 * Icon buttons follow DESIGN.md §4.3 icon-button spec:
 * w-7 h-7 flex items-center justify-center rounded-lg
 * bg-white/5 border border-white/10 text-opal-text-muted
 * hover:bg-white/10 hover:text-opal-text transition-all cursor-pointer
 * ───────────────────────────────────────────────────────── */

function iconBtn(extraCls: string, delta: number, title: string, chevronPoints: string): string {
    return `<button class="cal-nav-btn ${extraCls}" data-delta="${delta}" title="${title}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="${chevronPoints}"/></svg>
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
    const prevDay  = iconBtn('mensa-nav-date',    -1, 'Vorheriger Tag', '15 18 9 12 15 6');
    const nextDay  = iconBtn('mensa-nav-date',     1, 'Nächster Tag',   '9 18 15 12 9 6');
    const prevMens = iconBtn('mensa-nav-canteen', -1, 'Vorherige Mensa','15 18 9 12 15 6');
    const nextMens = iconBtn('mensa-nav-canteen',  1, 'Nächste Mensa',  '9 18 15 12 9 6');

    const heartPath = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';
    const starBtn = `
      <button class="cal-nav-btn mensa-toggle-favview ${showFavorites ? 'mensa-fav-active' : ''}" title="${showFavorites ? 'Alle Gerichte' : 'Meine Favoriten'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${showFavorites ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="${heartPath}"/></svg>
      </button>`;

    const canteenOrFav = showFavorites
        ? `<span class="text-xs font-semibold text-opal-accent">Favoriten</span>`
        : multipleCanteens
            ? `${prevMens}<span class="text-xs text-opal-text-muted font-medium truncate text-center ${compact ? 'flex-1' : 'max-w-[110px]'} px-1">${escapeHtml(canteenName)}</span>${nextMens}`
            : `<span class="text-xs text-opal-text-muted truncate ${compact ? '' : 'max-w-[130px]'} pl-1">${escapeHtml(canteenName)}</span>`;

    if (!compact) {
        /* Wide layout: single row — date | fav heart + canteen switcher */
        return `
        <div class="flex items-center justify-between mb-2 gap-2">
          <div class="flex items-center gap-1">
            ${prevDay}
            <span class="text-xs font-semibold text-opal-text-muted min-w-[48px] text-center">${dateLabel(dateOffset, dateStr)}</span>
            ${nextDay}
          </div>
          <div class="flex items-center gap-1">
            ${starBtn}
            ${canteenOrFav}
          </div>
        </div>`;
    }

    /* Compact layout: two rows */
    return `
    <div class="flex flex-col gap-1.5 mb-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1">
          ${prevDay}
          <span class="text-xs font-semibold text-opal-text-muted min-w-[48px] text-center">${dateLabel(dateOffset, dateStr)}</span>
          ${nextDay}
        </div>
        ${starBtn}
      </div>
      <div class="flex items-center justify-center gap-1">
        ${canteenOrFav}
      </div>
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
        return `<div>${nav}
          <div class="text-center py-6">
            <svg class="mx-auto mb-2 text-opal-text-muted/30" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <p class="text-sm text-opal-text-muted">Keine Favoriten gespeichert.</p>
            <p class="text-xs text-opal-text-muted/60 mt-1">Markiere Gerichte mit ♥ um sie hier zu sehen.</p>
          </div>
        </div>`;
    }

    if (favData.length === 0) {
        const when = dateOffset === 0 ? 'heute' : dateOffset === 1 ? 'morgen' : 'an diesem Tag';
        return `<div>${nav}
          <div class="text-center py-6">
            <p class="text-sm text-opal-text-muted">Keine Favoriten ${when} verfügbar.</p>
            <p class="text-xs text-opal-text-muted/60 mt-1">Keines deiner Lieblingsgerichte steht auf dem Speiseplan.</p>
          </div>
        </div>`;
    }

    const sections = favData.map((entry, i) => `
        <div class="${i > 0 ? 'mt-3' : ''}">
          <p class="text-[9px] text-opal-text-muted/60 font-bold uppercase tracking-wider mb-1.5">${escapeHtml(entry.canteenName)}</p>
          <div class="space-y-1.5">
            ${entry.meals.map(m => renderMeal(m, favSet.has(m.name))).join('')}
          </div>
        </div>`).join('');

    return `<div>${nav}<div>${sections}</div></div>`;
}

/* ── Widget definition ─────────────────────────────────────── */

export const mensaWidget: Widget = {
    id: 'mensa',
    opalPortletOrder: '',
    title: 'Mensa',
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
        const canteen = CANTEENS.find(c => c.id === state.canteenId);
        const canteenName = canteen?.name ?? `Mensa #${state.canteenId}`;
        const multipleCanteens = settings.favoriteCanteenIds.length > 1;
        const dateStr = state.date || new Date().toISOString().split('T')[0];

        const nav = renderNavBar(state.dateOffset, dateStr, canteenName, multipleCanteens, viewState.showFavorites, compact);

        if (viewState.showFavorites) {
            return renderFavoritesView(favData, favSet, settings.favoriteNames.length > 0, nav, state.dateOffset);
        }

        if (state.error) {
            return `<div>${nav}
              <div class="text-center py-6">
                <p class="text-sm text-opal-text-muted">Speiseplan nicht verfügbar.</p>
                <p class="text-xs text-opal-text-muted/60 mt-1">API nicht erreichbar · ${escapeHtml(canteenName)}</p>
              </div>
            </div>`;
        }

        if (state.meals.length === 0) {
            return `<div>${nav}
              <div class="text-center py-6">
                <p class="text-sm text-opal-text-muted">Kein Speiseplan.</p>
                <p class="text-xs text-opal-text-muted/60 mt-1">${escapeHtml(canteenName)} · geschlossen oder kein Angebot.</p>
              </div>
            </div>`;
        }

        /* Favourites float to top */
        const meals = [...state.meals]
            .sort((a, b) => (favSet.has(b.name) ? 1 : 0) - (favSet.has(a.name) ? 1 : 0));

        return `<div>${nav}<div class="space-y-1.5">${meals.map(m => renderMeal(m, favSet.has(m.name))).join('')}</div></div>`;
    },
};
