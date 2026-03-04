/* ━━ Topbar Renderer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { UserInfo } from './types';
import { escapeHtml, getInitials } from './utils';

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
  if (isGuest()) return { name: 'Gast' };
  const nameEl = document.querySelector('.header-functions-user-name');
  return { name: nameEl?.textContent?.trim() || 'Student' };
}

/** Render the glassmorphism topbar */
export function buildTopbar(user: UserInfo, editMode: boolean): string {
  const guest = isGuest();
  const initials = getInitials(user.name);

  // When logged out: pill that extends around the avatar with a running glow
  const userArea = guest
    ? `<button type="button" id="opal-login-btn" class="opal-login-pill" title="Erneut anmelden">
        <span class="opal-login-pill-glow"></span>
        <span class="opal-login-pill-inner">
          <svg class="opal-login-pill-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
            <polyline points="10 17 15 12 10 7"/>
            <line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
          <span class="opal-login-pill-label">Login</span>
          <div class="opal-login-pill-avatar">
            ${initials}
          </div>
        </span>
      </button>`
    : `<div class="opal-user-menu-anchor" style="position:relative;">
        <button type="button" id="opal-user-btn" class="w-9 h-9 inline-flex items-center justify-center rounded-full bg-opal-surface-2 border border-opal-glass-border overflow-hidden ring-2 ring-opal-accent/20 text-opal-text font-bold text-xs leading-none cursor-pointer hover:ring-opal-accent/40 transition-all" title="${escapeHtml(user.name)}">
          <span>${initials}</span>
        </button>
        <div id="opal-user-dropdown" class="opal-user-dropdown" style="display:none;">
          <div class="opal-user-dropdown-header">
            <div class="opal-user-dropdown-avatar">${initials}</div>
            <div class="opal-user-dropdown-info">
              <p class="opal-user-dropdown-name">${escapeHtml(user.name)}</p>
              <p class="opal-user-dropdown-role">Student</p>
            </div>
          </div>
          <div class="opal-user-dropdown-divider"></div>
          <button class="opal-user-dropdown-item" data-action="customize">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>${editMode ? 'Bearbeitung beenden' : 'Dashboard anpassen'}</span>
          </button>
          <div class="opal-user-dropdown-divider"></div>
          <button class="opal-user-dropdown-item" data-opal-action="Profil" title="Profileinstellungen öffnen">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Profil</span>
          </button>
          <button class="opal-user-dropdown-item" data-opal-action="Einstellungen" title="Systemeinstellungen öffnen">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>Einstellungen</span>
          </button>
          <button class="opal-user-dropdown-item" data-opal-action="Anzeige" title="Anzeigeeinstellungen öffnen">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            <span>Anzeige</span>
          </button>
          <div class="opal-user-dropdown-divider"></div>
          <button class="opal-user-dropdown-item" data-opal-action="Neuigkeiten" title="Neuigkeiten und Abonnements konfigurieren">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span>Neuigkeiten</span>
          </button>
          <button class="opal-user-dropdown-item" data-opal-action="Persönlicher Kalender" title="Persönlichen Kalender konfigurieren">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>Persönlicher Kalender</span>
          </button>
          <div class="opal-user-dropdown-divider"></div>
          <div style="padding:6px 10px 2px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;flex-shrink:0;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span style="font-size:13px;color:var(--color-opal-text-muted);">Kurskatalog</span>
              </div>
              <label style="position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;cursor:pointer;">
                <input type="checkbox" id="opal-catalog-toggle" style="opacity:0;width:0;height:0;">
                <span style="position:absolute;inset:0;background:var(--color-opal-divider);border-radius:9px;transition:background 0.2s;"></span>
                <span style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:var(--color-opal-surface);border-radius:50%;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);"></span>
              </label>
            </div>
            <p id="opal-catalog-status" style="font-size:10px;color:var(--color-opal-text-muted);margin:4px 0 0 23px;">Lädt…</p>
          </div>
          <button class="opal-user-dropdown-item" id="opal-catalog-refresh" style="margin-top:2px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            <span>Katalog aktualisieren</span>
          </button>
        </div>
      </div>`;

  return `
    <header class="opal-topbar sticky top-0 z-50 glass-header border-b border-opal-divider px-4 md:px-6 py-3">
      <div class="max-w-7xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-2xl font-black tracking-tighter text-opal-text opal-glow">OPAL</span>
          <div class="w-1.5 h-1.5 rounded-full ${guest ? 'bg-opal-warning' : 'bg-opal-accent'} animate-pulse"></div>
        </div>
        <div class="hidden md:flex flex-1 justify-center max-w-lg px-4">
          <button type="button" id="opal-cmd-trigger"
                  class="opal-search-trigger inline-flex items-center gap-3 w-full bg-opal-surface border border-opal-divider rounded-full py-2 px-5 text-left cursor-text leading-none transition-all hover:border-opal-glass-highlight hover:bg-opal-surface-2 group">
            <svg class="text-opal-text-muted flex-shrink-0 transition-colors group-hover:text-opal-accent" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span class="text-sm text-opal-text-muted leading-none flex-1">Suchen…</span>
            <div class="flex items-center gap-0.5 flex-shrink-0">
              <kbd class="text-[10px] font-semibold text-opal-text-muted/60 bg-opal-surface-2 border border-opal-divider rounded-md px-1.5 py-0.5 leading-none font-sans">Ctrl</kbd>
              <kbd class="text-[10px] font-semibold text-opal-text-muted/60 bg-opal-surface-2 border border-opal-divider rounded-md px-1.5 py-0.5 leading-none font-sans">K</kbd>
            </div>
          </button>
        </div>
        <div class="flex items-center gap-3">
          ${editMode ? `
          <button id="opal-reset-layout" class="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium leading-none bg-opal-surface-2 text-opal-text-muted hover:bg-opal-danger/20 hover:text-opal-danger transition-all cursor-pointer" title="Reset Layout">
            <svg class="flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            <span>Reset</span>
          </button>
          <button id="opal-theme-btn" class="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium leading-none bg-opal-surface-2 text-opal-text-muted hover:bg-opal-accent/20 hover:text-opal-accent transition-all cursor-pointer" title="Theme anpassen">
            <svg class="flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10-1.5 4-3.5 4c-1 0-1.8-.8-2.2-1.5-.4-.8-1.2-1.5-2.3-1.5-1.8 0-3 1.5-3 3.5s1.5 5 1 5"/></svg>
            <span>Theme</span>
          </button>
          <button id="opal-edit-toggle" class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-xs font-medium leading-none bg-opal-accent text-opal-on-accent transition-all cursor-pointer" title="Bearbeitung beenden">
            <svg class="flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Done</span>
          </button>
          ` : ''}
          ${userArea}
        </div>
      </div>
    </header>`;
}
