/**
 * scraper.js — Data extraction layer
 * 
 * Reads structured data from the live OPAL DOM using stable,
 * class-based selectors (never Wicket-generated IDs).
 */

/**
 * Extracts all bookmarked/favorited courses.
 * Selector chain: div[data-portlet-order="Bookmarks"] > section.panel.portlet.bookmarks
 * @returns {{ title: string, href: string, type: string, moduleCode: string|null }[]}
 */
export function scrapeFavorites() {
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

/**
 * Extracts courses the user is enrolled in.
 * Selector: div[data-portlet-order="RepositoryPortletStudent"] section.panel.portlet.repositoryportletstudent
 * @returns {{ title: string, href: string, type: string }[]}
 */
export function scrapeCourses() {
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

/**
 * Extracts logged-in user info from the header.
 * @returns {{ name: string }}
 */
export function scrapeUserInfo() {
  const nameEl = document.querySelector('.header-functions-user-name');
  return {
    name: nameEl?.textContent.trim() ?? 'Student',
  };
}

/**
 * Extracts main navigation items.
 * @returns {{ label: string, href: string, active: boolean }[]}
 */
export function scrapeMainNav() {
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

/**
 * Extracts currently open tab items from the sidebar.
 * @returns {{ label: string, href: string }[]}
 */
export function scrapeOpenTabs() {
  return [...document.querySelectorAll('nav#main-nav ul.subnav li.dynamic-tab')]
    .map(li => {
      const a = li.querySelector('a');
      if (!a) return null;
      return {
        label: a.textContent.trim(),
        href: a.getAttribute('href'),
      };
    })
    .filter(Boolean);
}
