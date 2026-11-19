import { openSurface, closeSurface } from './motion';
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Mensa Settings Modal
   Settings UI for the Mensa widget + global mensa click delegation.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import {
    initMensa, saveMensaSettings,
    toggleMensaFavorite, getMensaSettings,
    setViewDate, setViewCanteen, toggleFavoritesView, initFavoritesView,
    CANTEENS,
} from './mensa-store';
import { t } from './i18n/messages/widgets.ts';
import { escapeAttr, escapeHtml } from './utils';
import { bindDialogKeyboard, dialogHeader, dialogFooter, switchRow, CLOSE_ICON } from './settings';

/* ── Helpers ──────────────────────────────────────────────────── */

function buildFavMealList(names: string[]): string {
    return names.length > 0
        ? names.map(name => `
            <div class="opal-row mensa-settings-fav-row">
              <span class="opal-row-title mensa-meal-name">${escapeHtml(name.toLowerCase())}</span>
              <button type="button" class="cal-nav-btn mensa-settings-unfav"
                      data-meal-name="${escapeAttr(encodeURIComponent(name))}"
                      aria-label="${escapeAttr(t('mensaRemoveMeal', { meal: name.toLowerCase() }))}"
                      title="${t('mensaRemoveFavourite')}">${CLOSE_ICON}</button>
            </div>`).join('')
        : `<p class="opal-caption">${t('mensaNoSavedMeals')}</p>`;
}

/* ── Settings Modal ───────────────────────────────────────────── */

/**
 * Open the Mensa settings modal.
 * @param onUpdate Called after a save so the caller can refresh widget content.
 */
export function openMensaSettings(onUpdate: () => void): void {
    document.getElementById('opal-settings-modal')?.remove();

    const current = getMensaSettings();
    const favIds = new Set(current.favoriteCanteenIds);

    const canteenChecks = CANTEENS.map(c => switchRow({
        id: `mensa-canteen-${c.id}`, label: c.name, description: c.location, checked: favIds.has(c.id),
        inputAttrs: `class="mensa-canteen-check" value="${c.id}"`,
    })).join('');

    const overlay = document.createElement('div');
    overlay.id = 'opal-settings-modal';
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="widget-settings-modal" role="dialog" aria-modal="true" aria-labelledby="mensa-settings-title">
        ${dialogHeader('mensa-settings-title', t('mensaTitle'))}
        <div class="settings-modal-body">
          <fieldset class="settings-field">
            <legend class="settings-field-label">${t('mensaPreferredCanteens')}</legend>
            <p class="opal-caption mb-2">${t('mensaPreferredCanteensHint')}</p>
            <div id="mensa-canteen-list" class="settings-switch-list">
              ${canteenChecks}
            </div>
          </fieldset>
          <div class="settings-field">
            <p class="settings-field-label">${t('mensaSavedMeals')}</p>
            <div id="mensa-fav-list" class="mensa-fav-list">${buildFavMealList(current.favoriteNames)}</div>
          </div>
        </div>
        ${dialogFooter()}
      </div>`;

    document.body.appendChild(overlay);
    openSurface(overlay);

    let releaseFocus: ReturnType<typeof bindDialogKeyboard> | null = null;
    const close = () => {
        void closeSurface(overlay, () => releaseFocus?.());
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('.widget-settings-close').forEach(btn => btn.addEventListener('click', close));
    releaseFocus = bindDialogKeyboard(overlay, close);

    // Unfav meal buttons — refresh list in-place
    overlay.querySelector('#mensa-fav-list')?.addEventListener('click', async (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.mensa-settings-unfav');
        if (!btn) return;
        const name = decodeURIComponent(btn.dataset.mealName ?? '');
        if (!name) return;
        await toggleMensaFavorite(name);
        const list = overlay.querySelector('#mensa-fav-list');
        if (list) list.innerHTML = buildFavMealList(getMensaSettings().favoriteNames);
        // The button that had focus is gone; keep focus inside the dialog.
        (list?.querySelector<HTMLElement>('.mensa-settings-unfav') ?? overlay.querySelector<HTMLElement>('.widget-settings-save'))?.focus();
    });

    // Save: collect checked canteens → save → re-fetch → re-render
    overlay.querySelector('.widget-settings-save')?.addEventListener('click', async () => {
        const checks = overlay.querySelectorAll<HTMLInputElement>('.mensa-canteen-check:checked');
        const newIds = Array.from(checks).map(cb => parseInt(cb.value, 10));
        // Require at least one canteen
        const ids = newIds.length > 0 ? newIds : [4];
        await saveMensaSettings({ ...getMensaSettings(), favoriteCanteenIds: ids });
        await initMensa(true);
        onUpdate();
        close();
    });
}

/* ── Mensa Nav + Favourite Event Delegation ───────────────────── */

/**
 * Register the global document click handler for mensa widget interactions.
 * Call once from init() — not from render(), to avoid stacking listeners.
 * @param onUpdate Called after any state change so the caller can refresh widget content.
 */
export function registerMensaClickHandlers(onUpdate: () => void): void {
    document.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;

        // Retry after a failed request
        const retryBtn = target.closest<HTMLButtonElement>('.mensa-retry');
        if (retryBtn) {
            retryBtn.disabled = true;
            await initMensa(true);
            onUpdate();
            return;
        }

        // Date navigation
        const dateBtn = target.closest<HTMLButtonElement>('.mensa-nav-date');
        if (dateBtn) {
            setViewDate(parseInt(dateBtn.dataset.delta ?? '0', 10));
            await initMensa(true);
            onUpdate();
            return;
        }

        // Canteen navigation
        const canteenBtn = target.closest<HTMLButtonElement>('.mensa-nav-canteen');
        if (canteenBtn) {
            setViewCanteen(parseInt(canteenBtn.dataset.delta ?? '0', 10));
            await initMensa(true);
            onUpdate();
            return;
        }

        // Favorites view toggle (star button)
        const favViewBtn = target.closest<HTMLButtonElement>('.mensa-toggle-favview');
        if (favViewBtn) {
            toggleFavoritesView();
            await initFavoritesView();
            onUpdate();
            return;
        }

        // Meal favouriting
        const favBtn = target.closest<HTMLButtonElement>('.mensa-fav-btn');
        if (favBtn) {
            const name = decodeURIComponent(favBtn.dataset.mealName ?? '');
            if (name) {
                await toggleMensaFavorite(name);
                // If in favorites view, refresh the cross-canteen cache too
                await initFavoritesView();
                onUpdate();
            }
        }
    });
}
