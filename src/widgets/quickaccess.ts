/* ━━ Quick Access Widget (Erste Schritte) ━━━━━━━━━━━━━━━━━━━
 * Static shortcut tiles with neo-brutalist hover effect.
 * Icon colors use static class maps — never interpolate
 * Tailwind class strings dynamically (DESIGN.md §5 rule 3).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { Widget } from '../types';

/** Static class map — Tailwind v4 needs full class strings at build time */
const ACTION_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  blue:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-400'    },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  violet:  { bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  text: 'text-violet-400'  },
};

export const quickaccessWidget: Widget = {
  id: 'quickaccess',
  opalPortletOrder: 'FirstStepsPortlet',
  title: 'Schnellzugriff',
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  defaultW: 4,
  defaultH: 3,
  hasNativeConfig: false,

  scrape() {
    return null;
  },

  render(): string {
    const actions = [
      { label: 'Suche', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', color: 'blue' },
      { label: 'Gruppen', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', color: 'emerald' },
      { label: 'ePortfolio', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', color: 'violet' },
    ];

    return `
      <div class="space-y-3">
        <div class="grid grid-cols-3 gap-2">
          ${actions.map(a => {
            const s = ACTION_STYLES[a.color];
            return `
            <button class="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover-brutal-accent cursor-pointer group">
              <div class="w-9 h-9 rounded-lg ${s.bg} border ${s.border} flex items-center justify-center ${s.text} group-hover:scale-110 transition-transform">
                ${a.icon}
              </div>
              <span class="text-[10px] font-medium text-opal-text-muted group-hover:text-opal-text transition-colors">${a.label}</span>
            </button>`;
          }).join('')}
        </div>

        <div class="border-t border-white/5 pt-3">
          <p class="text-[10px] text-opal-text-muted leading-relaxed mb-2">
            <span class="text-opal-text font-semibold">OPAL Redesign</span> ersetzt OPALs Standard-UI durch ein modernes Dark-Mode-Dashboard. Widgets lassen sich per Drag &amp; Drop verschieben, skalieren und ein- oder ausblenden.
          </p>
          <a href="https://github.com/jugridev/opal-redesign" target="_blank" rel="noopener noreferrer"
             class="inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-opal-text-muted hover:text-opal-text hover:border-opal-accent/50 hover:bg-opal-accent/10 transition-all">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </div>`;
  },
};
