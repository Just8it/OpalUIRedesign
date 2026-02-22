/**
 * content.js — OPAL Redesign Extension (Phase 2.1)
 * 
 * Supports: Startseite · Kursangebote · Course Pages
 * Styling: Tailwind CSS v4 utility classes
 * Flow: detect page → scrape → render → observe → re-scrape → re-render
 * 
 * INJECTION: We inject into document.body (not #main-content) and
 * use position:fixed to create a full-viewport overlay. This avoids
 * OPAL's constrained grid layout breaking our flex topbar.
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

  function detectPageType() {
    const wrap = document.getElementById('wrap');
    if (!wrap) return 'unknown';
    if (wrap.classList.contains('home')) return 'home';
    if (wrap.classList.contains('courses')) return 'catalog';
    if (wrap.classList.contains('course') && wrap.classList.contains('page')) return 'course';
    // Fallback: check URL
    if (location.href.includes('/repository/catalog')) return 'catalog';
    if (location.href.includes('/RepositoryEntry/')) return 'course';
    if (location.href.includes('/home')) return 'home';
    return 'generic';
  }


  /* ━━ Scrapers — Shared ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function scrapeUserInfo() {
    const nameEl = document.querySelector('.header-functions-user-name');
    return { name: nameEl?.textContent.trim() ?? 'Student' };
  }

  function scrapeMainNav() {
    return [...document.querySelectorAll('nav#main-nav ul.mainnav li')]
      .map(li => {
        const a = li.querySelector('a');
        if (!a) return null;
        return {
          label: a.textContent.trim(),
          href: a.getAttribute('href'),
          active: li.classList.contains('active'),
        };
      })
      .filter(Boolean);
  }

  function scrapeOpenTabs() {
    return [...document.querySelectorAll('nav#main-nav ul.subnav li.dynamic-tab')]
      .map(li => {
        const a = li.querySelector('a');
        if (!a) return null;
        return {
          label: a.textContent.trim(),
          href: a.getAttribute('href'),
          active: li.classList.contains('active'),
        };
      })
      .filter(Boolean);
  }


  /* ━━ Scrapers — Startseite Portlets ━━━━━━━━━━━━━━━━━━ */

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


  /* ━━ Scrapers — Kursangebote ━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function scrapeCatalogItems() {
    const list = document.querySelector('div.fluid-container ul.list-group');
    if (!list) return [];
    return [...list.querySelectorAll('li.list-group-item')]
      .map(li => {
        const link = li.querySelector('a.list-group-item-link');
        if (!link) return null;
        const heading = li.querySelector('strong.list-group-item-heading');
        const desc = li.querySelector('span.list-group-item-text');
        const btn = li.querySelector('button.list-group-fav');
        const isFolder = btn?.querySelector('.icon-folder') !== null;
        return {
          title: heading?.textContent.trim() || link.getAttribute('title') || '',
          href: link.getAttribute('href') || '#',
          description: desc?.textContent.trim() || '',
          type: isFolder ? 'folder' : 'course',
        };
      })
      .filter(Boolean);
  }

  function scrapeCatalogTitle() {
    const h1 = document.querySelector('header.main-header h1');
    return h1?.textContent.trim() || 'Kursangebote';
  }


  /* ━━ Scrapers — Course Page ━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function scrapeCourseInfo() {
    const title = document.querySelector('header.main-header h1')?.textContent.trim() || 'Kurs';
    const preview = document.querySelector('.content-preview.resource-details');
    const subtitle = preview?.querySelector('small')?.textContent.trim() || '';
    const fullTitle = preview?.querySelector('.content-preview-title')?.textContent.trim() || title;
    const descEl = preview?.querySelector('.content-preview-desc');
    // Get only the first paragraph of the description for the hero
    const firstParagraph = descEl?.querySelector('p')?.textContent.trim() || '';

    return { title: fullTitle, subtitle, description: firstParagraph };
  }

  function scrapeCourseTree() {
    // Scrape the rendered jsTree DOM for course navigation
    const treeNav = document.querySelector('nav.menu-course');
    if (!treeNav) return [];

    function parseNode(liEl) {
      const anchor = liEl.querySelector(':scope > a.jstree-anchor');
      if (!anchor) return null;

      const titleSpan = anchor.querySelector('.jstree-title');
      const title = titleSpan?.textContent.trim() || anchor.getAttribute('title') || '';
      const href = anchor.getAttribute('href') || '#';

      // Detect icon type from fonticon class
      const icon = anchor.querySelector('i.jstree-themeicon');
      let nodeType = 'default';
      if (icon) {
        const cls = icon.className;
        if (cls.includes('icon-root')) nodeType = 'root';
        else if (cls.includes('icon-en')) nodeType = 'enrollment';
        else if (cls.includes('icon-info')) nodeType = 'info';
        else if (cls.includes('icon-bc')) nodeType = 'content';
        else if (cls.includes('icon-fo')) nodeType = 'forum';
        else if (cls.includes('icon-bib')) nodeType = 'library';
        else if (cls.includes('icon-co')) nodeType = 'contact';
        else if (cls.includes('icon-group')) nodeType = 'group';
      }

      const isSelected = liEl.classList.contains('jstree-clicked') || anchor.classList.contains('jstree-clicked');

      // Parse children if present
      const childUl = liEl.querySelector(':scope > ul.jstree-children');
      const children = childUl
        ? [...childUl.querySelectorAll(':scope > li')].map(parseNode).filter(Boolean)
        : [];

      return { title, href, nodeType, isSelected, children };
    }

    const rootNodes = treeNav.querySelectorAll('.jstree-container-ul > li');
    return [...rootNodes].map(parseNode).filter(Boolean);
  }

  function scrapeCourseGroups() {
    const groupNav = document.querySelector('nav.menu-groups');
    if (!groupNav) return [];

    return [...groupNav.querySelectorAll('.jstree-anchor')].map(a => ({
      title: a.querySelector('.jstree-title')?.textContent.trim() || '',
      href: a.getAttribute('href') || '#',
    }));
  }

  function getContentContainerElement() {
    // Return the LIVE DOM element — we'll reparent it, not copy its HTML.
    // This preserves Wicket event handlers and AJAX-loaded content.
    return document.querySelector('.content-container');
  }


  /* ━━ Renderer — Core ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function renderModernUI(data, pageType) {
    const currentHash = JSON.stringify(data);

    // Determine if rendering is actually needed
    let needsRender = currentHash !== lastDataHash;

    // On course pages, Wicket's AJAX might wipe our DOM changes without altering
    // scraped data. Only bypass cache if our UI is actually missing!
    if (pageType === 'course' && !needsRender) {
      const uiMissing = !document.getElementById('opal-modern-ui') ||
        !document.querySelector('.opal-stitch-hero');
      if (uiMissing) needsRender = true;
    }

    if (!needsRender) return;

    lastDataHash = currentHash;

    document.getElementById('opal-modern-ui')?.remove();
    document.querySelectorAll('.opal-stitch-sidebar, .opal-stitch-hero').forEach(el => el.remove());

    const shell = document.createElement('div');
    shell.id = 'opal-modern-ui';
    if (!isFirstRender) shell.classList.add('opal-no-anim');

    if (pageType === 'course') {
      // Course pages: inject ONLY a topbar, restyle OPAL in place
      shell.classList.add('opal-topbar-only');
      shell.innerHTML = buildTopbar(data.user);
      document.body.prepend(shell);

      const wrap = document.getElementById('wrap');
      if (wrap) {
        // Our 500ms heartbeat flattener interval handles Floats/Flexbox dynamically now.
        // We only need to clean up the legacy UI pieces here.

        // Let the native menu-container remain visible so Wicket AJAX clicks work
        document.querySelector('.opal-stitch-sidebar')?.remove();
      }

      const menuEl = document.querySelector('.menu-container');
      if (menuEl) {
        // We do NOT hide the native menu, and we don't treat it as course content
        menuEl.classList.remove('opal-course-content');
        menuEl.style.removeProperty('display');
      }

      const gutter = document.getElementById('gutter');
      if (gutter) gutter.style.setProperty('display', 'none', 'important');

      const contentEl = document.querySelector('.content-container');
      if (contentEl) {
        contentEl.classList.add('opal-course-content');
        document.querySelector('.opal-stitch-hero')?.remove();

        const oldPreview = contentEl.querySelector('.content-preview');
        if (oldPreview) oldPreview.style.setProperty('display', 'none', 'important');

        const stitchHero = document.createElement('div');
        stitchHero.className = "space-y-4 mb-8 opal-stitch-hero";
        stitchHero.innerHTML = buildStitchCourseHero(data.courseInfo);
        contentEl.prepend(stitchHero);
      }
    } else {
      // All other pages: full fixed overlay
      let mainContent;
      if (pageType === 'home') mainContent = buildStartseiteMain(data);
      else if (pageType === 'catalog') mainContent = buildCatalogMain(data);
      else mainContent = buildStartseiteMain(data);

      shell.innerHTML = `
                ${buildTopbar(data.user)}
                <div class="flex min-h-[calc(100vh-56px)]">
                    ${buildSidebar(data.nav, data.openTabs, pageType)}
                    ${mainContent}
                </div>
            `;
      document.body.prepend(shell);
    }

    ghostOriginals(pageType);
    attachListeners(pageType);
    isFirstRender = false;
  }


  /* ━━ Renderer — Topbar ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function buildTopbar(user) {
    return `
      <header class="opal-topbar sticky top-0 z-50 glass-header border-b border-white/5 px-4 md:px-6 py-3">
        <div class="max-w-7xl mx-auto flex items-center justify-between">
          <div class="flex items-center gap-3">
            <button class="opal-sidebar-toggle p-1.5 rounded-md text-slate-400 hover:text-white transition-colors md:hidden" aria-label="Toggle sidebar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div class="flex items-center gap-2">
              <span class="text-2xl font-black tracking-tighter text-white opal-glow">OPAL</span>
              <div class="w-1.5 h-1.5 rounded-full bg-[#6264f4] animate-pulse"></div>
            </div>
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


  /* ━━ Renderer — Sidebar ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function buildSidebar(nav, openTabs, pageType) {
    if (pageType === 'home') return '';

    const navItems = (nav || []).map(item => `
      <a href="${item.href}" class="opal-sidebar-link flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] ${item.active ? 'active font-semibold' : 'text-opal-text-muted hover:text-opal-text hover:bg-opal-surface-2'} transition-all duration-150 no-underline" title="${escapeHtml(item.label)}">
        <span class="shrink-0 w-4 opacity-70">${getSidebarIcon(item.label)}</span>
        <span>${escapeHtml(item.label)}</span>
      </a>`).join('');

    const tabItems = (openTabs || []).map(tab => `
      <a href="${tab.href}" class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] ${tab.active ? 'bg-opal-accent/10 text-opal-accent font-medium' : 'text-opal-text-muted hover:text-opal-text hover:bg-opal-surface-2'} transition-all duration-150 no-underline" title="${escapeHtml(tab.label)}">
        <span class="shrink-0 w-4 opacity-50"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
        <span class="truncate">${truncate(escapeHtml(tab.label), 24)}</span>
      </a>`).join('');

    return `
      <aside class="opal-sidebar w-52 shrink-0 bg-opal-surface border-r border-opal-border overflow-y-auto transition-all duration-300 hidden md:flex flex-col">
        <nav class="p-3 flex flex-col gap-0.5 flex-1">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-opal-text-muted/60 px-3 pt-1 pb-2">Navigation</span>
          ${navItems}
          ${tabItems.length ? `
            <div class="mt-4 pt-3 border-t border-opal-border/50">
              <span class="text-[10px] font-semibold uppercase tracking-widest text-opal-text-muted/60 px-3 pt-1 pb-2 block">Ge\u00F6ffnete Kurse</span>
              ${tabItems}
            </div>
          ` : ''}
        </nav>
      </aside>`;
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
          <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">© OPAL System Redesigned.</p>
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
          <div><p class="text-white/80 text-xs font-medium">Modul details →</p></div>
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


  /* ━━ Renderer — Kursangebote Main ━━━━━━━━━━━━━━━━━━━━ */

  function buildCatalogMain(data) {
    const items = data.catalogItems || [];
    const title = data.catalogTitle || 'Kursangebote';

    const cards = items.map((item, i) => {
      const color = stringToColor(item.title);
      const isFolder = item.type === 'folder';
      const icon = isFolder
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
      const delay = i < 8 ? `opal-delay-${i + 1}` : '';

      return `
        <a href="${item.href}" class="opal-card opal-anim-in ${delay} group flex items-start gap-3.5 p-4 rounded-xl bg-opal-surface border border-opal-border hover:border-opal-surface-3 transition-all duration-200 no-underline" title="${escapeHtml(item.title)}">
          <div class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style="background:${color}12">
            ${icon}
          </div>
          <div class="flex flex-col min-w-0 flex-1">
            <span class="text-[13px] font-medium text-opal-text leading-snug">${escapeHtml(item.title)}</span>
            ${item.description ? `<span class="text-[12px] text-opal-text-muted mt-1 line-clamp-2">${escapeHtml(item.description)}</span>` : ''}
            <span class="text-[10px] uppercase tracking-wider font-semibold mt-2 ${isFolder ? 'text-amber-400/70' : 'text-opal-accent/70'}">${isFolder ? 'Ordner' : 'Kurs'}</span>
          </div>
          <svg class="shrink-0 mt-1 text-opal-text-muted opacity-0 group-hover:opacity-60 transition-opacity" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </a>`;
    }).join('');

    return `
      <main class="flex-1 p-5 md:p-8 overflow-y-auto max-w-6xl">
        <section class="opal-anim-in mb-6">
          <div class="flex items-center justify-between">
            <div>
              <h1 class="text-xl md:text-2xl font-bold tracking-tight text-opal-text">${escapeHtml(title)}</h1>
              <p class="text-sm text-opal-text-muted mt-0.5">Lernangebote der s\u00E4chsischen Hochschulen</p>
            </div>
            <span class="text-[11px] font-semibold bg-opal-accent/10 text-opal-accent px-2.5 py-1 rounded-full">${items.length} Eintr\u00E4ge</span>
          </div>
        </section>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">${cards}</div>
      </main>`;
  }


  /* ━━ Renderer — Course Page Main ━━━━━━━━━━━━━━━━━━━━━ */

  function buildCourseMain(data) {
    const info = data.courseInfo || {};
    const tree = data.courseTree || [];
    const color = stringToColor(info.title || 'Kurs');
    const initials = getInitials(info.title || 'Kurs');

    return `
      <main class="flex-1 overflow-y-auto">
        <!-- Course Hero -->
        <div class="opal-anim-in relative overflow-hidden border-b border-opal-border">
          <div class="absolute inset-0 opacity-10" style="background: linear-gradient(135deg, ${color}33, transparent 60%)"></div>
          <div class="relative p-5 md:p-8 flex items-start gap-5">
            <div class="shrink-0 w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold" style="background:${color}22;color:${color}">${initials}</div>
            <div class="min-w-0 flex-1">
              <h1 class="text-lg md:text-xl font-bold text-opal-text tracking-tight leading-snug">${escapeHtml(info.title)}</h1>
              ${info.subtitle ? `<p class="text-xs text-opal-text-muted mt-1">${escapeHtml(info.subtitle)}</p>` : ''}
            </div>
          </div>
        </div>

        <!-- Course Content: Tree + Embedded Content -->
        <div class="flex min-h-0">
          <!-- Course Tree Sidebar -->
          <div class="opal-anim-in w-64 shrink-0 border-r border-opal-border bg-opal-surface overflow-y-auto p-3 hidden lg:block">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-opal-text-muted/60 px-2 pt-1 pb-2 block">Kursbausteine</span>
            ${buildTreeNodes(tree, 0)}
            ${data.courseGroups?.length ? `
              <div class="mt-4 pt-3 border-t border-opal-border/50">
                <span class="text-[10px] font-semibold uppercase tracking-widest text-opal-text-muted/60 px-2 pt-1 pb-2 block">Gruppen</span>
                ${data.courseGroups.map(g => `
                  <a href="${g.href}" class="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-opal-text-muted hover:text-opal-text hover:bg-opal-surface-2 transition-all no-underline">
                    <svg class="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <span>${escapeHtml(g.title)}</span>
                  </a>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <!-- Embedded Content Area — live DOM gets moved here -->
          <div class="opal-anim-in flex-1 p-5 md:p-8 overflow-y-auto">
            <div id="opal-course-content-slot" class="rounded-xl"></div>
          </div>
        </div>
      </main>`;
  }

  function buildTreeNodes(nodes, depth) {
    return nodes.map(node => {
      const icon = getCourseNodeIcon(node.nodeType);
      const indent = depth > 0 ? `pl-${Math.min(depth * 3, 9)}` : '';
      const active = node.isSelected ? 'bg-opal-accent/10 text-opal-accent font-medium' : 'text-opal-text-muted hover:text-opal-text hover:bg-opal-surface-2';
      const childrenHtml = node.children?.length ? buildTreeNodes(node.children, depth + 1) : '';

      // Skip the root node's wrapper — show its children directly
      if (node.nodeType === 'root') {
        return childrenHtml;
      }

      return `
        <a href="${node.href}" class="opal-course-tree-link flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] ${active} ${indent} transition-all no-underline" title="${escapeHtml(node.title)}">
          <span class="shrink-0 w-4 flex items-center justify-center opacity-70">${icon}</span>
          <span class="truncate">${escapeHtml(node.title)}</span>
        </a>
        ${childrenHtml}`;
    }).join('');
  }

  function getCourseNodeIcon(type) {
    const icons = {
      enrollment: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
      info: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      content: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      forum: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      library: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
      contact: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
      group: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    };
    return icons[type] || '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg>';
  }

  function buildStitchSidebar(data) {
    const info = data.courseInfo || {};
    const tree = data.courseTree || [];

    return `
    <div class="mb-8 pl-3">
      <h2 class="text-xl font-bold text-white tracking-tight leading-snug">${escapeHtml(info.title)}</h2>
      ${info.subtitle ? `<p class="text-slate-500 text-xs mt-1">${escapeHtml(info.subtitle)}</p>` : ''}
    </div>
    <nav class="flex flex-col gap-1">
      ${buildStitchTreeNodes(tree, 0)}
    </nav>
    `;
  }

  function buildStitchTreeNodes(nodes, depth) {
    return nodes.map(node => {
      const icon = getCourseNodeIcon(node.nodeType);
      const indent = depth > 0 ? `pl-${Math.min((depth + 1) * 3, 9)}` : 'px-3';

      if (node.nodeType === 'root') {
        return node.children?.length ? buildStitchTreeNodes(node.children, depth) : '';
      }

      const activeClass = node.isSelected
        ? 'text-primary relative bg-primary/10 font-semibold'
        : 'text-slate-400 hover:text-white hover:bg-white/5 font-medium';

      const activeLine = node.isSelected
        ? '<div class="absolute left-0 top-1.5 bottom-1.5 w-1 bg-primary rounded-full active-nav-line"></div>'
        : '';

      const childrenHtml = node.children?.length ? buildStitchTreeNodes(node.children, depth + 1) : '';

      return `
      <a href="${node.href}" class="group flex items-center gap-3 py-2 rounded-lg transition-all no-underline ${indent} ${activeClass}" title="${escapeHtml(node.title)}">
        ${activeLine}
        <span class="shrink-0 w-5 flex items-center justify-center ${node.isSelected ? 'text-primary' : 'opacity-70'}">${icon}</span>
        <span class="text-sm truncate">${escapeHtml(node.title)}</span>
      </a>
      ${childrenHtml}`;
    }).join('');
  }

  function buildStitchCourseHero(info) {
    return `
    <nav class="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">
      <span>Curriculum</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      <span class="truncate max-w-[200px]">${escapeHtml(info.title)}</span>
    </nav>
    <h1 class="text-3xl md:text-5xl font-extrabold text-white tracking-tighter leading-tight">${escapeHtml(info.title)}</h1>
    ${info.description ? `
    <p class="text-lg text-slate-400 leading-relaxed max-w-3xl mt-4">
      ${escapeHtml(info.description)}
    </p>` : ''}
    `;
  }


  /* ━━ Sidebar Icons ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function getSidebarIcon(label) {
    const icons = {
      'Startseite': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
      'Lehren & Lernen': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
      'Kursangebote': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    };
    return icons[label] || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg>';
  }


  /* ━━ Ghost Originals ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function ghostOriginals(pageType) {
    const ghost = 'opacity:0 !important;height:0 !important;overflow:hidden !important;position:absolute !important;pointer-events:none !important;';

    if (pageType === 'course') {
      // Course pages: hide OPAL header/nav, push content down below our topbar
      document.querySelector('header.page-header-container')?.setAttribute('style', ghost);
      const mainHeader = document.querySelector('#main-content > div > header.main-header');
      if (mainHeader) mainHeader.setAttribute('style', ghost);

      // Push the original content below our fixed topbar
      const wrap = document.getElementById('wrap');
      if (wrap) wrap.style.paddingTop = '56px';
    } else {
      // Ghost the entire #wrap — we fully replace the viewport
      const wrap = document.getElementById('wrap');
      if (wrap) wrap.setAttribute('style', ghost);
    }
  }


  /* ━━ Event Listeners ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  function attachListeners(pageType) {
    const toggle = document.querySelector('.opal-sidebar-toggle');
    const sidebar = document.querySelector('.opal-sidebar');
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    }

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
    let fallbackLoop = null;

    // Aggressively strip native OPAL scrollbars that Wicket JS might inject dynamically
    const stripScrollbars = () => {
      if (document.body.classList.contains('opal-mod-course')) {

        const panels = document.querySelectorAll('.opal-course-content .panel, .opal-course-content .box, .opal-course-content .well, .opal-course-content .table-responsive, .opal-course-content .o_table_wrapper, .opal-course-content table, .panel-group');
        panels.forEach(p => {
          // Force all these containers to grow naturally
          p.setAttribute('style', (p.getAttribute('style') || '') + '; max-height: none !important; height: auto !important; overflow-y: visible !important; overflow: visible !important;');

          // Also target all children and nuke their inline heights recursively
          const childrenWithStyles = p.querySelectorAll('[style*="height"], [style*="overflow"]');
          childrenWithStyles.forEach(child => {
            child.setAttribute('style', (child.getAttribute('style') || '') + '; max-height: none !important; height: auto !important; overflow-y: visible !important; overflow: visible !important;');
          });
        });

        // Ensure OPAL's main wrapper divs don't constrain our width
        const layoutContainers = document.querySelectorAll('.container-fluid, #main-content, #page-content, #page-content > div, #main-content > div');
        layoutContainers.forEach(container => {
          container.classList.add('opal-flattened');
        });

        // --- DYNAMIC FLATTENER ---
        // Dynamically walk up the tree and flatten any secret divs Wicket injected
        // CRITICAL: We start at `el.parentElement` and never flatten `el` itself,
        // because `el` (the sidebar or content panel) MUST remain a Float item!
        const flattenPath = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return;

          let p = el.parentElement;
          while (p && p.id !== 'wrap' && p !== document.body) {
            p.classList.add('opal-flattened');
            p = p.parentElement;
          }
        };
        flattenPath('.menu-container');
        flattenPath('.content-container');
      }
    };
    stripScrollbars();

    // Start a continuous heartbeat to fight Wicket's quiet DOM updates
    if (fallbackLoop) clearInterval(fallbackLoop);
    fallbackLoop = setInterval(stripScrollbars, 500);

    const observer = new MutationObserver((mutations) => {
      let shouldTrigger = false;
      let hasHeroMutation = false; // Track if the hero element was affected

      const checkNode = (node) => {
        if (node.nodeType === 1) { // ELEMENT_NODE
          if (node.id !== 'opal-modern-ui' &&
            !node.classList.contains('opal-stitch-sidebar') &&
            !node.classList.contains('opal-stitch-hero')) {
            return true;
          }
        } else if (node.nodeType === 3 && node.textContent.trim() !== '') { // TEXT_NODE
          return true;
        }
        return false;
      };

      for (const m of mutations) {
        // 1. If the target itself is inside our UI, ignore
        if (m.target.closest && (
          m.target.closest('#opal-modern-ui') ||
          m.target.closest('.opal-stitch-sidebar') ||
          m.target.closest('.opal-stitch-hero') ||
          m.target.closest('#colorbox')
        )) {
          continue;
        }

        // Track hero mutations specifically
        if (m.target.classList && m.target.classList.contains('opal-stitch-hero')) {
          hasHeroMutation = true;
        }
      }

      // 2. See if Wicket injected a new main UI payload without a full page reload.
      // We ONLY want to trigger a full re-scrape if a major structural element drops in.
      // CRITICAL: We must check both the added node itself AND its children!
      const needsRender = mutations.some(m => {
        if (!m.addedNodes) return false;
        return Array.from(m.addedNodes).some(n => {
          if (n.nodeType !== Node.ELEMENT_NODE) return false;

          if (n.id === 'ws-page' || n.id === 'wrap' ||
            (n.classList && (n.classList.contains('content-container') || n.classList.contains('menu-container')))) {
            return true;
          }

          // Wicket often injects a parent div that CONTAINS the content
          if (n.querySelector && n.querySelector('#ws-page, .content-container, .menu-container, #wrap')) {
            return true;
          }

          return false;
        });
      });

      // If no MAJOR structural changes occurred, ignore the mutation.
      // Small tweaks (like text updates or minor node insertions) will be handled 
      // by the 500ms heartbeat layout flattener.
      if (!needsRender && !hasHeroMutation) {
        return;
      }

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(onChangeCallback, 150);
    });

    // Bind to document.body, not #wrap, because Wicket sometimes destroys #wrap itself!
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

    // Course pages need body scroll; overlay pages need overflow:hidden
    if (pageType === 'course') {
      document.body.classList.remove('opal-mod-active');
      document.body.classList.add('opal-mod-course');
    } else {
      document.body.classList.remove('opal-mod-course');
      document.body.classList.add('opal-mod-active');
    }

    // Base data for all pages
    const data = {
      user: scrapeUserInfo(),
      nav: scrapeMainNav(),
      openTabs: scrapeOpenTabs(),
    };

    // Page-specific scrapers
    if (pageType === 'home') {
      data.favorites = scrapeFavorites();
      data.courses = scrapeCourses();
      data.calendar = scrapeCalendar();
      data.news = scrapeNews();
      data.efficiency = scrapeEfficiency();
    } else if (pageType === 'catalog') {
      data.catalogItems = scrapeCatalogItems();
      data.catalogTitle = scrapeCatalogTitle();
    } else if (pageType === 'course') {
      data.courseInfo = scrapeCourseInfo();
      data.courseTree = scrapeCourseTree();
      data.courseGroups = scrapeCourseGroups();
      // courseContent is handled by DOM reparenting in renderModernUI
    } else {
      // Generic fallback
      data.favorites = scrapeFavorites();
      data.courses = scrapeCourses();
      data.calendar = scrapeCalendar();
      data.news = scrapeNews();
    }

    console.log('[OPAL Redesign] Scraped:', data);
    renderModernUI(data, pageType);

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
