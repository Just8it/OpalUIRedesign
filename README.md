# OPAL Redesign

A Chrome extension that replaces the dated OPAL learning platform UI with a modern, widget-based dashboard. Built for students and staff at TU Dresden and other Saxon universities using OPAL (Online-Plattform fuer Akademisches Lehren und Lernen).

OPAL is a Moodle-like learning management system built on Apache Wicket. Its interface has not meaningfully changed in over a decade. This extension injects a completely redesigned frontend on top of it -- no backend changes, no server access, purely client-side.

## What It Does

The extension hides the native OPAL layout and replaces it with a modular dashboard. On the home page, it renders a grid of configurable widgets. On course and file pages, it applies modern styling while preserving all native functionality.

### Dashboard Widgets

The home page dashboard uses GridStack for drag-and-drop layout with persistent positions stored in `chrome.storage.local`:

- **Favorites** -- Bookmarked courses with direct links
- **My Courses** -- Enrolled courses scraped from the native portlet
- **Calendar** -- Upcoming events from the OPAL calendar portlet
- **Deadlines** -- Due dates extracted from course content
- **Groups** -- Group memberships
- **Recent** -- Recently visited courses and pages
- **Quick Access** -- Frequently used links
- **Mensa** -- Daily canteen menus fetched from the Studentenwerk Dresden OpenMensa API, with per-meal favorites and canteen switching
- **News / Announcements / Aktuelles** -- Various notification feeds from OPAL portlets
- **Performance** -- Grade overview
- **Stats** -- Usage statistics
- **Institution** -- Institutional information
- **Toolbox** -- Utility links and actions

Each widget scrapes its data from the corresponding native OPAL portlet that is hidden underneath. Widget visibility and grid position are fully configurable. Native OPAL per-portlet settings (e.g., calendar display count) are proxied through a settings modal that writes back to Wicket's own forms.

### Command Center (Search)

Pressing `Ctrl+K` opens a command palette with full-text search across three scopes:

- **Default mode** -- Searches user-visited courses, pages, and files. Favorites are always shown first with substring matching. A synthetic "Suche" action links to OPAL's native search for broader results.
- **`/c` prefix** -- Course search, including the full catalog index (~1900 courses). Searches across title, description, author, institution, and semester.
- **`/f` prefix** -- File search across all indexed documents (PDF, DOCX, XLSX, etc.) found on course pages.

The search engine uses Orama for in-memory full-text search with fuzzy matching (tolerance 1) and Dexie.js (IndexedDB) for persistent storage. Results are ranked with weighted boosts (title > author > description > institution > semester).

### Course Catalog Indexer

A background indexer populates the `/c` search scope by loading OPAL's course search in a hidden iframe, searching for "TU Dresden", expanding all results via "alle anzeigen", and scraping the full table including metadata (description, author, institution, semester, course type). Deprecated courses are automatically skipped. The process runs with a 1-hour cooldown and can be toggled from the user dropdown.

### Theming

Three base themes (Dark, Light, OLED) with a custom accent color picker. The theme editor uses a canvas-based HSV color picker. All colors are applied via CSS custom properties -- no hardcoded values anywhere in the stylesheet.

### Passive Indexing

Every page visit silently indexes the current course, folder, or file into the local database. Breadcrumbs are parsed to build a hierarchy. The home page bootstraps the index from Favorites and My Courses portlets so search works on day one. File links on course pages are scraped and indexed in the background.

## Architecture

```
src/
  main.ts              Entry point -- dashboard injection, Command Center, widget orchestration
  main-world.ts        Tiny MAIN-world script for Wicket-safe click delegation
  indexer.ts           Passive page indexer + background catalog indexer
  grid.ts              GridStack widget card renderer
  layout.ts            Layout persistence (chrome.storage.local)
  topbar.ts            Top navigation bar with user dropdown
  theme.ts             Theme engine (dark/light/OLED + accent color)
  theme-editor.ts      Visual theme editor panel
  settings.ts          Native OPAL config proxy (reads/writes Wicket forms)
  course-matcher.ts    Fuzzy course title matching
  calendar-store.ts    Calendar settings persistence
  mensa-store.ts       OpenMensa API client + meal caching
  portlet-manager.ts   Ensure/remove native portlets for widget data
  types.ts             Shared TypeScript interfaces
  utils.ts             Escaping, initials, helpers
  core/
    index-db.ts        Dexie schema + IndexNode type
    search-engine.ts   Orama wrapper, upsert, search with reranking
  widgets/
    *.ts               One file per widget (scrape + render)
styles/
  modern.css           Tailwind-generated stylesheet
  gridstack.css        GridStack layout styles
  hider.css            Hides native OPAL elements
popup/
  popup.html           Extension popup (enable/disable toggle)
  popup.js             Popup logic
```

The extension runs as a Chrome MV3 content script in the ISOLATED world. A second tiny script (`main-world.ts`) runs in the MAIN world with `all_frames: true` to handle click delegation for `javascript:` hrefs that Wicket generates.

All data is client-side. The only external network request is to the Studentenwerk Dresden OpenMensa API for canteen menus.

## Limitations

**German locale only** -- The extension relies on German-language text to locate UI elements, buttons, and labels within OPAL (e.g., "alle anzeigen", "Suchen", "Seiten"). It will not work correctly on OPAL instances set to English or other languages.

OPAL is built on Apache Wicket, a stateful server-side Java framework. This creates several constraints:

- **Session-bound URLs** -- Wicket appends numeric page version counters (`?5`, `?32`) to URLs that are only valid for the current session. The indexer strips these to create stable IDs but cannot generate working deep links to arbitrary pages.
- **jQuery/AJAX dependency** -- Many OPAL interactions use Wicket's built-in AJAX via jQuery event handlers. Standard `dispatchEvent` calls from the ISOLATED content script world do not trigger these handlers. The MAIN-world helper script works around this for the top-level page, but dynamically created iframes require direct `.click()` calls.
- **Portlet data coupling** -- Widgets scrape their data from hidden native OPAL portlets. If OPAL changes its HTML structure, individual widgets will break. Each widget is isolated, so breakage does not cascade.
- **No offline support** -- All course content comes from OPAL's live pages. The local index stores metadata (titles, URLs, descriptions) but not course content itself.
- **Catalog coverage** -- The background catalog indexer searches "TU Dresden" which captures most but not all courses. Courses from other institutions may be missing from `/c` search results.
- **Single-page scraping** -- The extension only sees what the current page renders. It cannot follow links or load additional pages in the background (except for the dedicated catalog indexer).

## Installation

### From Source

Prerequisites: Node.js 18+

```bash
git clone https://github.com/Just8it/OpalUIRedesign.git
cd OpalUIRedesign
npm install
npm run build
```

Then load the extension in Chrome:

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the repository root folder

The build produces `dist/content.js` and `dist/main-world.js`. The CSS is generated via Tailwind into `styles/modern.css`.

### Development

```bash
npm run dev
```

This starts esbuild and Tailwind in watch mode. After making changes, reload the extension from `chrome://extensions/` to pick up the new build.

## Tech Stack

- **TypeScript** -- All source code
- **esbuild** -- Bundler (IIFE format for content script injection)
- **Tailwind CSS v4** -- Utility-first styling compiled to a single CSS file
- **GridStack** -- Drag-and-drop dashboard layout
- **Orama** -- In-memory full-text search engine with fuzzy matching
- **Dexie.js** -- IndexedDB wrapper for persistent index storage
- **Chrome Extensions MV3** -- Content scripts + storage API

## License

MIT -- see [LICENSE](LICENSE).
