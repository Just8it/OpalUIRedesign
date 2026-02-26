/* ━━ Topbar Renderer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { UserInfo } from './types';
import { escapeHtml, getInitials } from './utils';

/** Scrape user info from the hidden OPAL header */
export function scrapeUserInfo(): UserInfo {
  const nameEl = document.querySelector('.header-functions-user-name');
  return { name: nameEl?.textContent?.trim() ?? 'Student' };
}

/** Render the glassmorphism topbar */
export function buildTopbar(user: UserInfo, editMode: boolean): string {
  return `
    <header class="opal-topbar sticky top-0 z-50 glass-header border-b border-white/5 px-4 md:px-6 py-3">
      <div class="max-w-7xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-2xl font-black tracking-tighter text-white opal-glow">OPAL</span>
          <div class="w-1.5 h-1.5 rounded-full bg-[#6264f4] animate-pulse"></div>
        </div>
        <div class="hidden md:flex flex-1 justify-center max-w-md px-4">
          <div class="relative w-full group">
            <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <div class="flex items-center w-full bg-white/5 border border-white/10 rounded-full py-2 px-4 pl-10 text-sm text-slate-400 cursor-text hover:bg-white/10 transition-colors">
              <span>Command Center</span>
              <div class="ml-auto flex items-center gap-1">
                <kbd class="bg-white/10 px-1.5 py-0.5 rounded text-[10px] font-mono border border-white/5">Cmd</kbd>
                <kbd class="bg-white/10 px-1.5 py-0.5 rounded text-[10px] font-mono border border-white/5">K</kbd>
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          ${editMode ? `
          <button id="opal-reset-layout" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-all cursor-pointer" title="Reset Layout">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Reset
          </button>
          ` : ''}
          <button id="opal-edit-toggle" class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${editMode ? 'bg-[#6264f4] text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}" title="Customize Dashboard">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            ${editMode ? 'Done' : 'Customize'}
          </button>
          <div class="w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 border border-white/10 overflow-hidden ring-2 ring-[#6264f4]/20 text-white font-bold text-xs" title="${escapeHtml(user.name)}">
            ${getInitials(user.name)}
          </div>
        </div>
      </div>
    </header>`;
}
