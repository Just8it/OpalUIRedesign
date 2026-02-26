/* ━━ News Widget (Kursnews / InfoMessages) ━━━━━━━━━━━━━━━━━━ */

import type { Widget, NewsData } from '../types';
import { escapeHtml } from '../utils';

export const newsWidget: Widget = {
  id: 'news',
  opalPortletOrder: 'InfoMessages',
  title: 'Kursnews',
  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  defaultW: 4,
  defaultH: 3,
  hasNativeConfig: true,

  scrape(): NewsData {
    const portlet = document.querySelector(
      'div[data-portlet-order="InfoMessages"] section.panel.portlet.infomessages'
    );
    if (!portlet) return { hasNews: false, text: '' };
    const content = portlet.querySelector('.panel-content');
    const text = content?.textContent?.trim() || '';
    const hasNews = !text.includes('keine Neuigkeiten');
    return { hasNews, text };
  },

  render(data: unknown): string {
    const news = data as NewsData;

    if (!news.hasNews) {
      return `
        <div class="text-center py-4">
          <svg class="mx-auto mb-3 text-slate-600" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <p class="text-sm text-slate-500">Keine neuen Nachrichten.</p>
        </div>`;
    }

    return `
      <div class="flex gap-3 p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/10">
        <div class="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 text-indigo-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-xs font-bold text-white mb-0.5">Neue Nachricht</h4>
          <p class="text-[11px] text-slate-400 line-clamp-2">${escapeHtml(news.text)}</p>
        </div>
      </div>`;
  },
};
