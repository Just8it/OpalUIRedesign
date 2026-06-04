# OPAL Redesign

I am a mechanical engineering student, and this tool has been built in part with AI assistance. The goal is practical: make OPAL faster to navigate, easier to read, and less frustrating for daily university work.

OPAL Redesign is a browser extension for Firefox and Chrome/Chromium-based browsers. It modernizes the OPAL learning platform used by TU Dresden and other Saxon universities with a dashboard, command center, local search index, theme system, and utility widgets.

The extension is fully client-side. It does not need a backend, does not modify OPAL servers, and stores its own data locally in the browser.

## Current Version

Current extension version: `0.2.5`

Current Firefox release artifacts:

- `opal-redesign-firefox.zip` - Firefox add-on upload package
- `opal-redesign-source-firefox.zip` - source package for Mozilla reviewers

Chrome/Chromium is supported as a development and target browser as well. The Firefox package is currently documented in more detail because Mozilla requires a separate reproducible source upload.

## What It Does

### Modern Dashboard

On the OPAL home page, the extension hides the native layout and renders a widget-based dashboard. Widgets scrape their data from the original OPAL portlets that remain available in the page underneath.

Included widgets:

- Favorites and enrolled courses
- Recent courses/pages
- Calendar and deadlines
- Groups
- Quick access links
- Mensa menus from the Studentenwerk Dresden OpenMensa API
- News, announcements, and OPAL updates
- Performance/grades overview
- Stats, institution info, and toolbox actions

Widget order, visibility, and layout are persisted in extension local storage.

### Command Center

Press `Ctrl+K` to open the command center.

Search scopes:

- Default search: favorite courses, visited pages, folders, and indexed files
- `/c`: course search
- `/f`: file search
- File type filters: `pdf`, `ext:pdf`, `type:pptx`, `zip`, etc.

The search system uses Orama for in-memory ranking and Dexie/IndexedDB for persistent local storage. A Dexie fallback catches substring matches that full-text search can miss.

### Local Indexing

The extension builds a local search index from OPAL pages the user sees.

Indexing sources:

- Current page title and breadcrumbs
- Favorites and enrolled course portlets
- Visible file tables
- File links in tables, cards, and lists
- CourseNode/material links from `href`, `onclick`, and OPAL `data-*` payloads
- Background course catalog indexing through a hidden OPAL iframe
- Optional course-file preloading for upcoming/favorite courses

Indexed nodes store title, URL, type, course ID, parent ID, file extension, visit count, last visit time, index time, and extra search context.

### Options And Diagnostics

The extension has an options page for:

- Enabling/disabling the modern UI
- Exporting/importing local settings
- Deleting only the search index
- Deleting all local extension data
- Inspecting index health: total nodes, courses, folders, files, and last indexed time

### Themes

Theme modes:

- Dark
- Light
- OLED

The theme editor supports accent customization. Theme values are applied with CSS custom properties.

## Architecture

```text
src/
  main.ts                    Entry point: dashboard injection, topbar, command center binding
  main-world.ts              MAIN-world click helper for Wicket/javascript links
  indexer.ts                 Passive page indexer, catalog indexer, course-file preloader
  grid.ts                    GridStack widget card renderer
  layout.ts                  Dashboard layout persistence
  topbar.ts                  Modern topbar and user dropdown
  theme.ts                   Theme loading, saving, and CSS variable application
  theme-editor.ts            Visual theme editor
  settings.ts                Native OPAL settings proxy and safe click bridge
  course-matcher.ts          Fuzzy matching between calendar entries and courses
  calendar-store.ts          Calendar event storage and ICS handling
  mensa-store.ts             Mensa API client and meal cache
  portlet-manager.ts         Native OPAL portlet management
  types.ts                   Shared interfaces
  utils.ts                   Escaping, safe hrefs, and UI helpers
  core/
    index-db.ts              Dexie schema and IndexNode type
    search-engine.ts         Orama wrapper, upsert, reranking, fallback search
    opal-link-parser.ts      Testable OPAL URL, file, and CourseNode parsing helpers
  widgets/
    *.ts                     One widget per file: scrape + render
options/
  options.html/css/js        Options page and local data diagnostics
popup/
  popup.html/js              Extension popup toggle and options shortcut
test/
  fixtures/                  HTML fixtures for scraper/parser tests
  scraper-fixtures.test.mjs  Node test suite for parser behavior
```

## Build

Prerequisites:

- Node.js 18 or newer
- npm

Install dependencies:

```bash
npm ci
```

Build the Firefox release and source packages:

```bash
npm run release:firefox
```

This runs:

- TypeScript typecheck
- ESLint
- scraper/parser tests
- Firefox extension packaging
- Firefox source packaging

Build only the development assets:

```bash
npm run build
```

Watch mode:

```bash
npm run dev
```

## Browser Targets

### Firefox

Upload these files to Mozilla Add-on Developer Hub:

- Add-on file: `opal-redesign-firefox.zip`
- Source code file: `opal-redesign-source-firefox.zip`

Mozilla reviewers can reproduce the add-on from source with:

```bash
npm ci
npm run build:firefox
```

Detailed reviewer instructions are in [REVIEWER_BUILD.md](REVIEWER_BUILD.md).

### Chrome/Chromium

Chrome/Chromium support is part of the project scope. For local Chrome/Chromium development:

```bash
npm run build
```

Then open `chrome://extensions/`, enable developer mode, and load the repository folder as an unpacked extension.

Chrome packaging is available through:

```bash
npm run build:chrome
```

## Testing

Run parser/scraper tests:

```bash
npm run test:scrapers
```

Run the full Firefox release check:

```bash
npm run release:firefox
```

Known lint state: ESLint currently reports warnings for older non-null assertions and `any` usage, but no lint errors.

## Privacy

The extension stores data locally in the browser. It does not send OPAL course data to a custom backend.

Local storage includes:

- Dashboard layout
- Theme settings
- Calendar imports/settings
- Mensa preferences
- Local search index metadata

External network usage:

- OPAL pages already loaded by the user
- Hidden OPAL iframe loads for catalog/course indexing
- Studentenwerk Dresden OpenMensa API for mensa data

Additional legal/privacy documents:

- [Endnutzervereinbarung](ENDNUTZERVEREINBARUNG.md)
- [Datenschutzerklaerung](DATENSCHUTZERKLAERUNG.md)

## Limitations

- OPAL is Apache Wicket-based and changes page state through session-bound URLs. The indexer strips Wicket counters where possible, but arbitrary deep links can still be fragile.
- German OPAL UI text is assumed in several places.
- Widgets depend on OPAL's current DOM structure. The code isolates widgets so one broken widget should not break the whole dashboard.
- The local index stores metadata and links, not file contents.
- The catalog indexer is best-effort and may not cover every institution or hidden course.

## License

MIT - see [LICENSE](LICENSE).
