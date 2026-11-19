/* ━━ Topbar Renderer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { UserInfo } from './types';
import { escapeAttr, escapeHtml, getInitials } from './utils';
import { localeTag } from './i18n/core.ts';
import { t } from './i18n/messages/shell.ts';

/** Check if the user is a guest (not logged in).
 *  Covers three OPAL states:
 *  1. body.user-role-guest  — standard logged-out class
 *  2. .header-functions-user-name inside an <a title="Login"> — login-page state
 *  3. .header-functions-user-name text is literally "Login" / "Anmelden"
 */
export function isGuest(): boolean {
  if (document.body.classList.contains('user-role-guest')) return true;
  const nameEl = document.querySelector('.header-functions-user-name');
  if (!nameEl) return true;
  if (nameEl.closest('a[title="Login"]') || nameEl.closest('a[title="Anmelden"]')) return true;
  const text = nameEl.textContent?.trim().toLowerCase() ?? '';
  return text === 'login' || text === 'anmelden' || text === '';
}

/** Scrape user info from the hidden OPAL header */
export function scrapeUserInfo(): UserInfo {
  if (isGuest()) return { name: t('topbarGuest') };
  const nameEl = document.querySelector('.header-functions-user-name');
  return { name: nameEl?.textContent?.trim() || t('topbarStudent') };
}

const ICON_REFRESH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;

const icon = (paths: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON_CUSTOMIZE = icon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>');
const ICON_GEAR = icon('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>');
const ICON_USER = icon('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>');
const ICON_SLIDERS = icon('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>');
const ICON_MONITOR = icon('<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>');
const ICON_BELL = icon('<path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>');
const ICON_CALENDAR = icon('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');
const ICON_LOGOUT = icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>');

/** One focusable row of the user menu; the roving focus in main.ts walks the [role="menuitem"] rows. */
function menuItem(iconSvg: string, attributes: string, label: string): string {
  return `<button type="button" role="menuitem" tabindex="-1" class="opal-user-dropdown-item" ${attributes}>${iconSvg}<span>${label}</span></button>`;
}

/** The edit-mode controls of the top bar: the dashboard and the course view use the same three. */
export function editModeButtons(): string {
  return `<div class="flex items-center gap-2" id="opal-edit-actions">
          <button type="button" id="opal-reset-layout" class="opal-btn opal-btn-danger" title="${t('editResetHint')}">
            ${ICON_REFRESH}
            <span>${t('editReset')}</span>
          </button>
          <button type="button" id="opal-theme-btn" class="opal-btn" title="${t('editAppearanceHint')}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-1.5 4-3.5 4c-1 0-1.8-.8-2.2-1.5-.4-.8-1.2-1.5-2.3-1.5-1.8 0-3 1.5-3 3.5s1.5 5 1 5"/></svg>
            <span>${t('appearance')}</span>
          </button>
          <button type="button" id="opal-edit-toggle" class="opal-btn opal-btn-primary" title="${t('editDoneHint')}">
            <span>${t('editDone')}</span>
          </button>
        </div>`;
}

/** Render the top bar */
export function buildTopbar(user: UserInfo, editMode: boolean, options: { customizeLabel?: string } = {}): string {
  const guest = isGuest();
  const initials = getInitials(user.name);

  const userArea = guest
    ? `<button type="button" id="opal-login-btn" class="opal-login-pill">${t('loginButton')}</button>`
    : `<div class="opal-user-menu-anchor relative">
        <button type="button" id="opal-user-btn" class="opal-avatar-btn" aria-label="${escapeAttr(t('topbarUserMenuFor', { name: user.name }))}" aria-haspopup="menu" aria-expanded="false" aria-controls="opal-user-dropdown">
          <span aria-hidden="true">${initials}</span>
        </button>
        <div id="opal-user-dropdown" class="opal-user-dropdown" role="menu" aria-label="${t('topbarUserMenu')}" style="display:none;">
          <div class="opal-user-dropdown-header" role="presentation">
            <div class="opal-user-dropdown-avatar" aria-hidden="true">${initials}</div>
            <div class="opal-user-dropdown-info">
              <p class="opal-user-dropdown-name">${escapeHtml(user.name)}</p>
            </div>
          </div>
          <div class="opal-user-dropdown-divider" role="separator"></div>
          ${menuItem(ICON_CUSTOMIZE, 'data-action="customize"', editMode ? t('topbarEndCustomize') : escapeHtml(options.customizeLabel ?? t('topbarCustomizeHome')))}
          ${menuItem(ICON_GEAR, 'data-action="extension-options"', t('topbarExtensionSettings'))}
          <div class="opal-user-dropdown-divider" role="separator"></div>
          <div role="group" aria-labelledby="opal-menu-account">
            <p class="opal-menu-heading" id="opal-menu-account">${t('topbarOpalAccount')}</p>
            ${menuItem(ICON_USER, `data-opal-action="Profil" data-opal-title="Profileinstellungen öffnen" title="${t('topbarProfileHint')}"`, t('topbarProfile'))}
            ${menuItem(ICON_SLIDERS, `data-opal-action="Einstellungen" data-opal-title="Systemeinstellungen öffnen" title="${t('topbarAccountSettingsHint')}"`, t('topbarAccountSettings'))}
            ${menuItem(ICON_MONITOR, `data-opal-action="Anzeige" data-opal-title="Anzeigeeinstellungen öffnen" title="${t('topbarDisplayHint')}"`, t('topbarDisplay'))}
            ${menuItem(ICON_BELL, `data-opal-action="Neuigkeiten" data-opal-title="Neuigkeiten und Abonnements konfigurieren" title="${t('topbarSubscriptionsHint')}"`, t('topbarSubscriptions'))}
            ${menuItem(ICON_CALENDAR, `data-opal-action="Persönlicher Kalender" data-opal-title="Persönlichen Kalender konfigurieren" title="${t('topbarCalendarHint')}"`, t('topbarCalendar'))}
          </div>
          <div class="opal-user-dropdown-divider" role="separator"></div>
          ${menuItem(ICON_LOGOUT, 'data-opal-action="Abmelden"', t('topbarLogout'))}
        </div>
      </div>`;

  return `
    <header lang="${localeTag()}" class="opal-topbar sticky top-0 z-50 glass-header border-b border-opal-divider px-4 md:px-6 py-2.5">
      <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <span class="opal-wordmark">OPAL</span>
        <div class="opal-search-slot">
          <button type="button" id="opal-cmd-trigger" class="opal-search-trigger" aria-label="${t('topbarSearchHint')}">
            <svg class="flex-shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span class="flex-1">${t('topbarSearch')}</span>
            <span class="flex items-center gap-1 flex-shrink-0" aria-hidden="true">
              <kbd class="opal-kbd">${t('topbarCtrl')}</kbd>
              <kbd class="opal-kbd">K</kbd>
            </span>
          </button>
        </div>
        <div class="flex items-center gap-2" id="opal-topbar-actions">
          ${editMode ? editModeButtons() : ''}
          <div id="opal-tufast" class="relative"></div>${userArea}
        </div>
      </div>
    </header>`;
}
