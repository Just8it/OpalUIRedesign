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

/* ── Helpers ──────────────────────────────────────────────────── */

function buildFavMealList(names: string[]): string {
    return names.length > 0
        ? names.map(name => `
            <div class="flex items-center justify-between gap-2 py-1">
              <span class="text-xs text-opal-text truncate">${name}</span>
              <button class="mensa-settings-unfav text-opal-text-muted hover:text-opal-danger transition-colors text-[10px]"
                      data-meal-name="${encodeURIComponent(name)}">✕</button>
            </div>`).join('')
        : '<p class="text-xs text-opal-text-muted">Keine Favoriten gespeichert.</p>';
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

    const canteenChecks = CANTEENS.map(c => `
        <label class="flex items-center gap-2.5 py-1 cursor-pointer group">
          <input type="checkbox" class="mensa-canteen-check accent-opal-accent w-3.5 h-3.5 cursor-pointer"
                 value="${c.id}" ${favIds.has(c.id) ? 'checked' : ''}>
          <span class="text-xs text-opal-text group-hover:text-opal-text transition-colors">
            ${c.name}
            <span class="text-opal-text-muted ml-1">${c.location}</span>
          </span>
        </label>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'opal-settings-modal';
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
    <div class="settings-modal-container">
      <div class="widget-settings-modal" style="max-width:420px;width:calc(100vw - 2rem)">
      <div class="settings-modal-header">
        <div class="settings-modal-title-row">
          <h2 class="settings-modal-title">Mensa Einstellungen</h2>
        </div>
        <button class="widget-settings-close settings-modal-close-btn" title="Schließen">✕</button>
      </div>
      <div class="settings-modal-body" style="padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:1.25rem;">
        <div>
          <label class="text-xs font-bold text-opal-text-muted uppercase tracking-wider block mb-2">Favorite Mensen</label>
          <p class="text-[10px] text-opal-text-muted/60 mb-2">Markierte Mensen können im Widget mit den Pfeilen durchgewechselt werden.</p>
          <div id="mensa-canteen-list" class="space-y-0.5" style="max-height:220px;overflow-y:auto;">
            ${canteenChecks}
          </div>
        </div>
        <div>
          <label class="text-xs font-bold text-opal-text-muted uppercase tracking-wider block mb-2">Gemerkte Gerichte</label>
          <div id="mensa-fav-list" style="max-height:120px;overflow-y:auto;">${buildFavMealList(current.favoriteNames)}</div>
        </div>
      </div>
      <div class="settings-modal-footer">
        <button class="settings-save-btn widget-settings-save">Speichern</button>
      </div>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.widget-settings-close')?.addEventListener('click', close);

    // Unfav meal buttons — refresh list in-place
    overlay.querySelector('#mensa-fav-list')?.addEventListener('click', async (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.mensa-settings-unfav');
        if (!btn) return;
        const name = decodeURIComponent(btn.dataset.mealName ?? '');
        if (!name) return;
        await toggleMensaFavorite(name);
        const list = overlay.querySelector('#mensa-fav-list');
        if (list) list.innerHTML = buildFavMealList(getMensaSettings().favoriteNames);
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
