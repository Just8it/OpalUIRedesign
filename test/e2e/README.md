# Real extension integration tests

Install dependencies with `npm install`, then download the browser once with
`npx playwright install chromium`. Run `npm run test:e2e` from the repository root.
It builds first, then runs eight serial tests with a new temporary browser profile
and empty extension storage per test. Run `npx playwright test -c test/e2e/playwright.config.mjs`
only when deliberately testing an already built checkout.

Uses Playwright's full bundled Chromium (`channel: chromium`) in headless mode,
with `launchPersistentContext` and the unpacked repository extension. Installed
Chrome no longer supports these extension flags. The older `cdp.mjs` and
`smoke.mjs` remain available but are not used by this suite.

Scenarios: restricted first-run dashboard, returning layout, avatar options tab,
course completion without top-level reload (normal and delayed node responses),
German Mensa price keys, and popup module loading. The course includes a folder,
subfolder, document and HTML iframe. No production test hooks are required.

All HTTP requests are intercepted. The recorded OPAL asset resolver is reused;
unknown URLs (including missing OPAL resources) abort and fail the test. Mensa
responses use Studierende/Bedienstete. Extension resources are loaded from the
actual build. Console errors, page exceptions and failed requests are collected
for every page, including popup/options tabs, and asserted in teardown.
Diagnostics attach request URLs and errors to each test result under `results/`.

`fixtures/dashboard.html` is derived from the saved root start-page HTML with
all portlets except Bookmarks and InfoMessages removed. Scripts, event handlers,
images, stylesheets and frames are removed to avoid saved-page third-party
side effects. The fixture still contains the recorded OPAL DOM and identifiers.
Course fixtures are synthetic OPAL-shaped integration pages based on that shell
and the existing parser fixture formats; they are not a live server capture.

Opt-in live contract check (requires network):
`node test/e2e/contract-mensa.mjs`.
It checks the upcoming open days for Alte Mensa, requires actual meals and validates
the German price keys. It is excluded from both npm test and test:e2e.

Firefox: run `npx playwright install firefox` once, then
`npm run test:e2e:firefox`. This builds the Firefox release ZIP and extracts it
into a disposable directory. `playwright-webextext@0.0.5` installs it as a
temporary add-on through Firefox RDP in a fresh persistent profile. Verified
with @playwright/test 1.65.1 and its bundled Firefox 159 (revision 1572) on Windows.
The launcher's documented MV3 permission override uses the manifest's Gecko ID;
no signing, installed Firefox, or web-ext process is needed.

Four Firefox tests cover the dashboard, gateway-loaded course sections and frame,
Ctrl+K command search, and the real safeClick settings bridge. The last test uses
a page-owned click listener on the native configure link, then clicks our widget
settings button; it does not dispatch the bridge event from the test.
`app-fixture.mjs` shares all routing, HTML fixtures and error diagnostics with
Chromium. Both suites use the committed dashboard rather than requiring the
untracked saved start page. Unknown requests still fail.

Playwright cannot reliably navigate/automate moz-extension options pages in this
setup (even navigation with waitUntil: commit timed out). The disposable Firefox
copy therefore adds a background test-seed.js that sets only
opalCourseViewEnabled=true before visiting OPAL. All shipped scripts and the
Firefox manifest's content-script worlds remain intact; production sources and
release ZIP are unchanged. Each test uses a new profile and removes it afterward.
Firefox popup/options automation is outside these four tests. Chromium's solution
search test stubs the background downloads API and verifies the exact solution URL,
avoiding a real OS download or an unrouted extension-created parent tab.

Only a failed plain Firefox launch causes a skip, with the full launch error and
installation command printed. ZIP, add-on installation, permission, application,
and assertion errors fail. A successful command with skipped tests is not evidence
that Firefox flows passed. Firefox diagnostics live under results/firefox.
