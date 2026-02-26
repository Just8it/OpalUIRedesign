/**
 * content.js — OPAL Redesign Extension
 * 
 * Supports: Startseite (Dashboard) ONLY
 * Styling: Tailwind CSS v4 utility classes
 * Flow: detect page → scrape → render → observe → re-scrape → re-render
 * 
 * All other OPAL pages (catalog, course, etc.) are left completely untouched.
 */

(function OpalRedesign() {
  'use strict';

  /* ━━ State ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  let lastDataHash = null;
  let isFirstRender = true;

  /* ━━ Utils ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 60%)`;
  }

  function getInitials(title) {
    const words = title.split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function truncate(title, maxLen = 60) {
    if (title.length <= maxLen) return title;
    return title.substring(0, maxLen - 1).trim() + '\u2026';
  }

  function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
  }


  /* ━━ Router ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function detectPageType() {
    const wrap = document.getElementById('wrap');
    if (!wrap) return 'unknown';
    if (wrap.classList.contains('home')) return 'home';
    if (location.href.includes('/home')) return 'home';
    return 'other';
  }


  /* ━━ Scrapers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function scrapeUserInfo() {
    const nameEl = document.querySelector('.header-functions-user-name');
    return { name: nameEl?.textContent.trim() ?? 'Student' };
  }

  function scrapeFavorites() {
    const portlet = document.querySelector(
      'div[data-portlet-order="Bookmarks"] section.panel.portlet.bookmarks'
    );
    if (!portlet) return [];
    return [...portlet.querySelectorAll('li.list-group-item')]
      .map(li => {
        const link = li.querySelector('a.list-group-item-link');
        if (!link) return null;
        const fullTitle = link.getAttribute('title') || link.textContent.trim();
        const moduleMatch = fullTitle.match(/\(([A-Z]{2,}-[A-Z0-9-]+(?:,\s*[A-Z]{2,}-[A-Z0-9-]+)*)\)/);
        return {
          title: fullTitle,
          href: link.getAttribute('href'),
          type: 'course',
          moduleCode: moduleMatch ? moduleMatch[1] : null,
        };
      })
      .filter(Boolean);
  }

  function scrapeCourses() {
    const portlet = document.querySelector(
      'div[data-portlet-order="RepositoryPortletStudent"] section.panel.portlet.repositoryportletstudent'
    );
    if (!portlet) return [];
    return [...portlet.querySelectorAll('li.list-group-item')]
      .map(li => {
        const link = li.querySelector('a.list-group-item-link');
        if (!link) return null;
        return {
          title: link.getAttribute('title') || link.textContent.trim(),
          href: link.getAttribute('href'),
          type: 'enrolled',
        };
      })
      .filter(Boolean);
  }

  function scrapeCalendar() {
    const portlet = document.querySelector(
      'div[data-portlet-order="Calendar"] section.panel.portlet.calendar'
    );
    if (!portlet) return { hasEvents: false, text: '' };
    const content = portlet.querySelector('.panel-content');
    const text = content?.textContent.trim() || '';
    const hasEvents = !text.includes('keine Termine');
    return { hasEvents, text };
  }

  function scrapeNews() {
    const portlet = document.querySelector(
      'div[data-portlet-order="InfoMessages"] section.panel.portlet.infomessages'
    );
    if (!portlet) return { hasNews: false, text: '' };
    const content = portlet.querySelector('.panel-content');
    const text = content?.textContent.trim() || '';
    const hasNews = !text.includes('keine Neuigkeiten');
    return { hasNews, text };
  }

  function scrapeEfficiency() {
    const portlet = document.querySelector(
      'div[data-portlet-order="EfficiencyStatements"] section.panel.portlet.efficiencystatements'
    );
    if (!portlet) return { hasData: false, text: '' };
    const content = portlet.querySelector('.panel-content');
    const text = content?.textContent.trim() || '';
    const hasData = !text.includes('Keine Inhalte');
    return { hasData, text };
  }


  /* ━━ Renderer — Core ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function renderModernUI(data) {
    const currentHash = JSON.stringify(data);
    if (currentHash === lastDataHash) return;
    lastDataHash = currentHash;

    document.getElementById('opal-modern-ui')?.remove();

    const shell = document.createElement('div');
    shell.id = 'opal-modern-ui';
    if (!isFirstRender) shell.classList.add('opal-no-anim');

    shell.innerHTML = `
      ${buildTopbar(data.user)}
      <div class="flex min-h-[calc(100vh-56px)]">
        ${buildStartseiteMain(data)}
      </div>
    `;
    document.body.prepend(shell);

    ghostOriginals();
    attachListeners();
    isFirstRender = false;
  }


  /* ━━ Renderer — Topbar ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function buildTopbar(user) {
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
          <div class="flex items-center gap-4">
            <div class="w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 border border-white/10 overflow-hidden ring-2 ring-[#6264f4]/20 text-white font-bold text-xs" title="${escapeHtml(user.name)}">
              ${getInitials(user.name)}
            </div>
          </div>
        </div>
      </header>`;
  }


  /* ━━ Renderer — Dashboard Main (Bento Grid) ━━━━━━━━━ */

  function buildStartseiteMain(data) {
    const courses = data.courses || [];
    const favorites = data.favorites || [];
    const courseMap = new Map();
    [...favorites, ...courses].forEach(c => courseMap.set(c.href, c));
    const allLectures = Array.from(courseMap.values()).slice(0, 6);

    return `
      <main class="w-full flex-1 p-6 md:p-8 overflow-y-auto max-w-7xl mx-auto">
        <div class="grid grid-cols-12 gap-6">
          
          <!-- Prominent Lectures -->
          <section class="col-span-12 xl:col-span-8 space-y-4">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-sm font-bold uppercase tracking-widest text-slate-500">Active Lectures</h2>
              <span class="flex items-center gap-2 text-xs text-emerald-500 font-medium">
                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Live Now
              </span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              ${allLectures.length ? allLectures.map((l, i) => buildBentoCourse(l, i)).join('') : '<p class="text-slate-500 text-sm">Keine Kurse gefunden.</p>'}
            </div>
          </section>

          <!-- Calendar Widget -->
          <aside class="col-span-12 xl:col-span-4 bento-card p-6 flex flex-col">
            ${buildBentoCalendar(data.calendar)}
          </aside>

          <!-- Announcements Widget -->
          <section class="col-span-12 lg:col-span-6 space-y-4">
            ${buildBentoNews(data.news)}
          </section>

          <!-- Stats/Glance Widget -->
          <section class="col-span-12 lg:col-span-6 grid grid-cols-2 gap-4">
            ${buildBentoStats(data)}
          </section>
        </div>
        
        <footer class="mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">\u00A9 OPAL System Redesigned.</p>
        </footer>
      </main>`;
  }

  function buildBentoCourse(item, index) {
    const gradients = [
      'from-indigo-600 to-violet-700 shadow-[0_0_15px_rgba(99,102,241,0.15)]',
      'from-emerald-500 to-teal-700 shadow-[0_0_15px_rgba(16,185,129,0.15)]',
      'from-rose-500 to-orange-600 shadow-[0_0_15px_rgba(244,63,94,0.15)]',
      'from-blue-500 to-cyan-600 shadow-[0_0_15px_rgba(59,130,246,0.15)]',
      'from-fuchsia-500 to-pink-600 shadow-[0_0_15px_rgba(217,70,239,0.15)]',
      'from-amber-500 to-orange-500 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
    ];
    const gradTheme = gradients[index % gradients.length];
    const delay = index < 8 ? `opal-delay-${index + 1}` : '';
    const displayTitle = truncate(item.title, 50);

    return `
      <a href="${item.href}" class="opal-anim-in ${delay} group relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br ${gradTheme} h-[13.5rem] flex flex-col justify-between border border-white/10 shadow-xl transition-transform hover:-translate-y-1 no-underline">
        <div class="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-40 transition-opacity text-white">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        </div>
        <div>
          <span class="px-2.5 py-1 bg-white/20 backdrop-blur-md rounded-full text-[9px] font-bold text-white uppercase tracking-wider">${item.moduleCode || 'KURS'}</span>
          <h3 class="text-xl font-black text-white mt-3 leading-tight">${escapeHtml(displayTitle)}</h3>
        </div>
        <div class="flex items-end justify-between">
          <div><p class="text-white/80 text-xs font-medium">Modul details \u2192</p></div>
          <button class="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity translate-x-4 group-hover:translate-x-0 cursor-pointer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </a>`;
  }

  function buildBentoCalendar(cal) {
    return `
      <div class="flex items-center justify-between mb-6">
        <h3 class="font-bold text-white flex items-center gap-2">
          <svg class="text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Calendar
        </h3>
        <button class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 text-white transition-colors cursor-pointer" title="Add Event (Coming Soon)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      <div class="flex-1 flex flex-col justify-center">
        ${cal && cal.hasEvents ? `
          <div class="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 mb-4">
            <div class="flex justify-between items-start mb-2">
              <span class="px-2 py-0.5 bg-rose-500 text-white text-[10px] font-bold rounded uppercase">Event</span>
            </div>
            <h4 class="text-white font-bold text-sm leading-tight">${escapeHtml(cal.text)}</h4>
          </div>
        ` : `<p class="text-sm text-slate-500 mb-6">Keine Termine in OPAL.</p>`}
        
        <div class="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500 font-bold mb-2">
          <div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div><div>S</div>
        </div>
        <div class="grid grid-cols-7 gap-1 text-center">
          <div class="text-xs p-1.5 text-slate-600">...</div>
          <div class="text-xs p-1.5 text-white font-bold bg-[#6264f4]/20 rounded-lg ring-1 ring-[#6264f4]/40">H</div>
          <div class="text-xs p-1.5 text-slate-300">...</div>
        </div>
      </div>`;
  }

  function buildBentoNews(news) {
    return `
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-bold uppercase tracking-widest text-slate-500">Announcements</h2>
      </div>
      <div class="space-y-3">
        ${news && news.hasNews ? `
          <div class="bento-card p-4 flex gap-4">
            <div class="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 text-indigo-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-bold text-white mb-1">Neue Nachricht</h4>
              <p class="text-xs text-slate-400 line-clamp-2">${escapeHtml(news.text)}</p>
            </div>
          </div>
        ` : `<div class="bento-card p-6 text-center text-sm text-slate-500">Alles gelesen. Keine neuen Nachrichten.</div>`}
      </div>`;
  }

  function buildBentoStats(data) {
    const favCount = data.favorites?.length || 0;
    const crsCount = data.courses?.length || 0;
    return `
      <div class="bento-card p-5 flex flex-col justify-between">
        <svg class="text-rose-500 mb-4" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <div>
          <p class="text-2xl font-black text-white">${crsCount}</p>
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Erfasste Kurse</p>
        </div>
      </div>
      <div class="bento-card p-5 flex flex-col justify-between">
        <svg class="text-[#6264f4] mb-4" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <div>
          <p class="text-2xl font-black text-white">${favCount}</p>
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Favoriten</p>
        </div>
      </div>
      <div class="col-span-2 bento-card p-5 bg-[#6264f4]/5 border border-[#6264f4]/10">
        <div class="flex items-center gap-3">
          <div class="flex-1">
             <h4 class="text-sm font-bold text-white">OPAL Redesigned</h4>
             <p class="text-xs text-slate-400">Modulares Dashboard v2</p>
          </div>
          <span class="px-2 py-1 bg-[#6264f4] text-white text-[10px] font-bold rounded-lg uppercase">Aktiv</span>
        </div>
      </div>`;
  }


  /* ━━ Ghost Originals ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function ghostOriginals() {
    const ghost = 'opacity:0 !important;height:0 !important;overflow:hidden !important;position:absolute !important;pointer-events:none !important;';
    const wrap = document.getElementById('wrap');
    if (wrap) wrap.setAttribute('style', ghost);
  }


  /* ━━ Event Listeners ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function attachListeners() {
    const searchInput = document.querySelector('.opal-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.opal-card').forEach(card => {
          const title = (card.getAttribute('title') || '').toLowerCase();
          card.style.display = title.includes(q) ? '' : 'none';
        });
      });
    }
  }


  /* ━━ Observer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function initObserver(onChangeCallback) {
    let debounceTimer = null;

    const observer = new MutationObserver((mutations) => {
      // Ignore mutations inside our own UI
      const isOwnMutation = mutations.every(m =>
        m.target.closest?.('#opal-modern-ui')
      );
      if (isOwnMutation) return;

      // Only re-render if major structural nodes appear
      const needsRender = mutations.some(m => {
        if (!m.addedNodes) return false;
        return Array.from(m.addedNodes).some(n => {
          if (n.nodeType !== Node.ELEMENT_NODE) return false;
          if (n.id === 'ws-page' || n.id === 'wrap') return true;
          if (n.querySelector?.('#ws-page, #wrap')) return true;
          return false;
        });
      });

      if (!needsRender) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(onChangeCallback, 150);
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: false });
    console.log('[OPAL Redesign] MutationObserver active on document.body');
  }


  /* ━━ Main Entry Point ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function run() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['opalRedesignEnabled'], (result) => {
        if (result.opalRedesignEnabled === false) {
          console.log('[OPAL Redesign] Extension is disabled.');
          return;
        }
        executeRedesign();
      });
    } else {
      executeRedesign();
    }
  }

  function executeRedesign() {
    const isGuest = document.body.classList.contains('user-role-guest');
    const isLoginPage = document.getElementById('wrap')?.classList.contains('login');
    const hasNoUser = !document.querySelector('.header-functions-user-name');

    if (isGuest || isLoginPage || hasNoUser) {
      console.log('[OPAL Redesign] Login/guest page \u2014 skipping.');
      return;
    }

    const pageType = detectPageType();
    console.log('[OPAL Redesign] Page type:', pageType);

    // Only redesign the Startseite
    if (pageType !== 'home') {
      console.log('[OPAL Redesign] Not home page \u2014 no UI modifications.');
      return;
    }

    document.body.classList.add('opal-mod-active');

    const data = {
      user: scrapeUserInfo(),
      favorites: scrapeFavorites(),
      courses: scrapeCourses(),
      calendar: scrapeCalendar(),
      news: scrapeNews(),
      efficiency: scrapeEfficiency(),
    };

    console.log('[OPAL Redesign] Scraped:', data);
    renderModernUI(data);

    if (!window.opalObserverInitialized) {
      initObserver(executeRedesign);
      window.opalObserverInitialized = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

})();
