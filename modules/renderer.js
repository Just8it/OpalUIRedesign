/**
 * renderer.js — Modern UI injection layer
 * 
 * Takes the structured data from scraper.js and renders
 * a completely new UI inside #main-content, hiding the original.
 */

import { stringToColor, getInitials, truncate } from './utils.js';

/**
 * Main render function. Called on initial load and after every
 * MutationObserver callback.
 * 
 * @param {{ user: object, nav: object[], favorites: object[], courses: object[], openTabs: object[] }} data
 */
export function renderModernUI(data) {
  // 1. Remove previous injection (if re-rendering after AJAX)
  document.getElementById('opal-modern-ui')?.remove();

  // 2. Build the modern shell
  const shell = document.createElement('div');
  shell.id = 'opal-modern-ui';
  shell.innerHTML = buildShell(data);

  // 3. Inject into the page
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.prepend(shell);
  } else {
    document.body.prepend(shell);
  }

  // 4. Check if course page and inject scrollytelling class
  const isCourse = document.querySelector('.menu-course') !== null;
  if (isCourse) {
    const wrapEl = document.getElementById('wrap');
    if (wrapEl) wrapEl.classList.add('opal-course-scrollytelling');
  }

  // 5. Ghost the original portlets (keep alive for Wicket)
  ghostOriginals();

  // 6. Attach event listeners
  attachListeners();
}

/* ── HTML Builders ─────────────────────────────────────── */

function buildShell(data) {
  return `
    ${buildTopbar(data.user)}
    <div class="opal-mod-layout">
      ${buildSidebar(data.nav, data.openTabs)}
      <main class="opal-mod-main">
        ${buildWelcome(data.user)}
        ${buildFavoritesGrid(data.favorites)}
        ${buildCoursesSection(data.courses)}
      </main>
    </div>
  `;
}

function buildTopbar(user) {
  return `
    <header class="opal-mod-topbar">
      <div class="opal-mod-topbar-left">
        <button class="opal-mod-sidebar-toggle" aria-label="Toggle sidebar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <div class="opal-mod-logo">
          <span class="opal-mod-logo-icon">◆</span>
          <span class="opal-mod-logo-text">OPAL</span>
          <span class="opal-mod-logo-badge">redesigned</span>
        </div>
      </div>
      <div class="opal-mod-topbar-right">
        <div class="opal-mod-search">
          <svg class="opal-mod-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" class="opal-mod-search-input" placeholder="Kurse durchsuchen…" />
        </div>
        <div class="opal-mod-user">
          <div class="opal-mod-avatar">${getInitials(user.name)}</div>
          <span class="opal-mod-user-name">${user.name}</span>
        </div>
      </div>
    </header>
  `;
}

function buildSidebar(nav, openTabs) {
  const navItems = (nav || []).map(item => `
    <a href="${item.href}" class="opal-mod-sidebar-link ${item.active ? 'active' : ''}" title="${item.label}">
      <span class="opal-mod-sidebar-icon">${getSidebarIcon(item.label)}</span>
      <span class="opal-mod-sidebar-label">${item.label}</span>
    </a>
  `).join('');

  const tabItems = (openTabs || []).map(tab => `
    <a href="${tab.href}" class="opal-mod-sidebar-link opal-mod-sidebar-tab" title="${tab.label}">
      <span class="opal-mod-sidebar-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </span>
      <span class="opal-mod-sidebar-label">${truncate(tab.label, 28)}</span>
    </a>
  `).join('');

  return `
    <aside class="opal-mod-sidebar">
      <nav class="opal-mod-sidebar-nav">
        <div class="opal-mod-sidebar-section">
          <span class="opal-mod-sidebar-heading">Navigation</span>
          ${navItems}
        </div>
        ${tabItems.length ? `
          <div class="opal-mod-sidebar-section">
            <span class="opal-mod-sidebar-heading">Geöffnete Kurse</span>
            ${tabItems}
          </div>
        ` : ''}
      </nav>
    </aside>
  `;
}

function buildWelcome(user) {
  const firstName = user.name.split(' ')[0];
  const hour = new Date().getHours();
  let greeting;
  if (hour < 12) greeting = 'Guten Morgen';
  else if (hour < 17) greeting = 'Guten Tag';
  else greeting = 'Guten Abend';

  return `
    <section class="opal-mod-welcome">
      <h1 class="opal-mod-welcome-title">${greeting}, ${firstName} 👋</h1>
      <p class="opal-mod-welcome-sub">Hier sind deine Kurse und Favoriten auf einen Blick.</p>
    </section>
  `;
}

function buildFavoritesGrid(favorites) {
  if (!favorites || favorites.length === 0) {
    return `
      <section class="opal-mod-section">
        <h2 class="opal-mod-section-title">
          <span class="opal-mod-section-icon">⭐</span> Favoriten
        </h2>
        <p class="opal-mod-empty">Keine Favoriten gefunden.</p>
      </section>
    `;
  }

  const cards = favorites.map(fav => buildCourseCard(fav)).join('');

  return `
    <section class="opal-mod-section">
      <div class="opal-mod-section-header">
        <h2 class="opal-mod-section-title">
          <span class="opal-mod-section-icon">⭐</span> Favoriten
        </h2>
        <span class="opal-mod-badge">${favorites.length}</span>
      </div>
      <div class="opal-mod-card-grid">
        ${cards}
      </div>
    </section>
  `;
}

function buildCourseCard(item) {
  const color = stringToColor(item.title);
  const initials = getInitials(item.title);
  const displayTitle = truncate(item.title, 65);
  const moduleCode = item.moduleCode || '';

  return `
    <a href="${item.href}" class="opal-mod-card" style="--card-accent: ${color}" title="${item.title}">
      <div class="opal-mod-card-accent" style="background: linear-gradient(135deg, ${color}, ${color}88)"></div>
      <div class="opal-mod-card-body">
        <div class="opal-mod-card-initials" style="background: ${color}22; color: ${color}">${initials}</div>
        <div class="opal-mod-card-info">
          <span class="opal-mod-card-title">${displayTitle}</span>
          ${moduleCode ? `<span class="opal-mod-card-module">${moduleCode}</span>` : ''}
        </div>
      </div>
      <div class="opal-mod-card-arrow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </div>
    </a>
  `;
}

function buildCoursesSection(courses) {
  if (!courses || courses.length === 0) return '';

  const rows = courses.map(c => {
    const color = stringToColor(c.title);
    const initials = getInitials(c.title);
    return `
      <a href="${c.href}" class="opal-mod-course-row" title="${c.title}">
        <div class="opal-mod-course-dot" style="background: ${color}"></div>
        <div class="opal-mod-course-initials" style="background: ${color}22; color: ${color}">${initials}</div>
        <span class="opal-mod-course-name">${truncate(c.title, 75)}</span>
        <svg class="opal-mod-course-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </a>
    `;
  }).join('');

  return `
    <section class="opal-mod-section">
      <div class="opal-mod-section-header">
        <h2 class="opal-mod-section-title">
          <span class="opal-mod-section-icon">📚</span> Meine Kurse
        </h2>
        <span class="opal-mod-badge">${courses.length}</span>
      </div>
      <div class="opal-mod-course-list">
        ${rows}
      </div>
    </section>
  `;
}

/* ── Helpers ────────────────────────────────────────────── */

function getSidebarIcon(label) {
  const icons = {
    'Startseite': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    'Lehren & Lernen': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    'Kursangebote': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  };
  return icons[label] || `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/></svg>`;
}

function ghostOriginals() {
  // Ghost the original portlet container
  const portletContainer = document.querySelector('.portlet-container');
  if (portletContainer) {
    portletContainer.style.cssText = 'opacity:0; height:0; overflow:hidden; position:absolute; pointer-events:none;';
  }

  // Ghost the original main header
  const mainHeader = document.querySelector('#main-content > header.main-header');
  if (mainHeader) {
    mainHeader.style.cssText = 'opacity:0; height:0; overflow:hidden; position:absolute; pointer-events:none;';
  }
}

function attachListeners() {
  // Sidebar toggle
  const toggle = document.querySelector('.opal-mod-sidebar-toggle');
  const sidebar = document.querySelector('.opal-mod-sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });
  }

  // Search filter (client-side filtering of cards)
  const searchInput = document.querySelector('.opal-mod-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      document.querySelectorAll('.opal-mod-card').forEach(card => {
        const title = card.getAttribute('title')?.toLowerCase() || '';
        card.style.display = title.includes(query) ? '' : 'none';
      });
      document.querySelectorAll('.opal-mod-course-row').forEach(row => {
        const title = row.getAttribute('title')?.toLowerCase() || '';
        row.style.display = title.includes(query) ? '' : 'none';
      });
    });
  }
}
