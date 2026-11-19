import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { START_URL } from './fake-opal.mjs';
const repo = process.cwd();
import { interceptOpal } from './app-fixture.mjs';
const course = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/123';
const suite = test.extend({ app: async ({}, use, info) => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'opal-pw-'));
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${repo}`, `--load-extension=${repo}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    // The suite asserts German copy; the headless browser's UI language is English, so pin it unless a test sets one.
    const storage = values => worker.evaluate(async values => { await chrome.storage.local.clear(); await chrome.storage.local.set({ opalLanguage: 'de', ...values }); }, values);
    await storage({});
    try { await interceptOpal(context, info, shared => use({ context, id, storage, ...shared })); }
    finally { await context.close(); await fs.rm(profile, { recursive: true, force: true }); }
} });
async function dashboard(app) { const p = await app.context.newPage(); await p.goto(START_URL); await expect(p.locator('#opal-modern-ui')).toBeVisible(); return p; }
suite('first run only exposes available portlets', async ({app}) => {
    const p = await dashboard(app);
    await expect(p.locator('.grid-stack-item[gs-id]')).toHaveCount(5);
    expect(await p.locator('.grid-stack-item[gs-id]').evaluateAll(es => es.map(e => e.getAttribute('gs-id')).sort())).toEqual(['calendar','favorites','mensa','neuigkeiten','quickaccess']);
    for(const id of ['courses','performance','groups','recent','institution','stats']) await expect(p.locator(`[data-widget-id="${id}"]`)).toHaveCount(0);
});
suite('returning user keeps saved layout', async ({app}) => {
    const saved = [{widgetId:'favorites', x:0,y:0,w:4,h:6,hidden:false},{widgetId:'mensa',x:4,y:0,w:8,h:4,hidden:true}];
    await app.storage({opalDashboardLayout_v4:saved}); const p = await dashboard(app);
    await expect(p.locator('[gs-id="favorites"]')).toHaveAttribute('gs-w','4'); await expect(p.locator('[gs-id="mensa"]')).toHaveCount(0);
});
suite('avatar opens extension options tab', async ({app}) => {
    const p = await dashboard(app); await p.locator('[data-skip]').click(); await expect(p.locator('#opal-onboarding')).toHaveCount(0); await p.locator('#opal-user-btn').click();
    const opened = app.context.waitForEvent('page'); await p.locator('[data-action="extension-options"]').click();
    const options = await opened; await expect(options).toHaveURL(`chrome-extension://${app.id}/options/options.html`);
    await expect(options.locator('#enabledToggle')).toBeChecked();
    await options.locator('#enabledToggle').uncheck();
    await expect.poll(() => options.evaluate(async () => (await chrome.storage.local.get('opalRedesignEnabled')).opalRedesignEnabled)).toBe(false);
    await options.locator('#enabledToggle').check();
    await expect.poll(() => options.evaluate(async () => (await chrome.storage.local.get('opalRedesignEnabled')).opalRedesignEnabled)).toBe(true);

});
for(const slow of [false,true]) suite(`course finishes without reload${slow?' with slow nodes':''}`, async ({app}) => {
    await app.storage({opalCourseViewEnabled:true}); if(slow) app.slow();
    const p = await app.context.newPage(); let navigations = 0;
    p.on('framenavigated', f => {if(f === p.mainFrame()) navigations++;}); await p.goto(course);
    await expect(p.getByRole('button', {name:'TUfast',exact:true})).toBeVisible();
    await expect(p.locator('#opal-course-progress')).toBeAttached(); await expect(p.locator('#opal-course-progress')).toBeHidden({timeout:30000});
    await expect(p.locator('[data-nav="sec:2"]')).toBeAttached(); await expect(p.locator('[data-nav="sec:3"]')).toBeAttached();
    await p.locator('[data-nav="sec:3"]').click(); await expect(p.locator('#opal-modern-ui')).toContainText('Die Vorlesung beginnt am Montag.');
    await p.waitForTimeout(1500); expect(navigations).toBe(1);
    expect(app.seen.some(u => u.includes('/CourseNode/2?'))).toBe(true); expect(app.seen.some(u => u.includes('/FolderResource/123/start.html'))).toBe(true);
});
suite('Mensa renders current German prices', async ({app}) => {const p = await dashboard(app); const m=p.locator('[gs-id="mensa"]'); await expect(m).toContainText(/test pasta/i); await expect(m).toContainText('2,34');});
suite('English interface: dashboard, search footer and options page follow the language setting', async ({app}) => {
    await app.storage({ opalLanguage: 'en' });
    const p = await dashboard(app);
    await expect(p.locator('[gs-id="mensa"]')).toContainText('€2.34');
    await p.keyboard.press('Control+k');
    await expect(p.locator('.opal-cmd-footer')).toContainText('select');
    await expect(p.locator('.opal-cmd-footer')).not.toContainText('auswählen');
    const options = await app.context.newPage(); await options.goto(`chrome-extension://${app.id}/options/options.html`);
    await expect(options.locator('html')).toHaveAttribute('lang', /^en/);
    await expect(options.locator('h1')).toHaveText('Settings');
});
suite('popup resolves every module without errors', async ({app}) => {const p = await app.context.newPage(); await p.goto(`chrome-extension://${app.id}/popup/popup.html`); await expect(p.locator('body')).not.toBeEmpty(); await p.waitForTimeout(500);});

suite('background course indexing uses HTML only and search opens the exact solution', async ({app}) => {
    const p = await dashboard(app);
    await p.locator('[data-skip]').click();
    const worker=app.context.serviceWorkers()[0];
    await worker.evaluate(async course => {await chrome.storage.local.set({opalFavoriteSnapshot:[{href:course,title:'Mathe'}]});},course);
    await p.evaluate(() => { globalThis.courseFrames=[]; new MutationObserver(records => { for(const r of records) for(const node of r.addedNodes) if(node.nodeName==='IFRAME') globalThis.courseFrames.push(node.src); }).observe(document.body,{childList:true,subtree:true}); });
    await p.keyboard.press('Control+k');
    await p.locator('#opal-cmd-input').fill('> Kursdateien aktualisieren');
    await p.locator('#opal-cmd-results').getByText('Kursdateien aktualisieren',{exact:true}).click();
    await expect.poll(() => worker.evaluate(async () => Boolean((await chrome.storage.local.get('opalCourseSnapshot2_123')).opalCourseSnapshot2_123?.fetchedAt))).toBe(true);
    expect(await p.evaluate(() => globalThis.courseFrames)).toEqual([]);
    const visits=await worker.evaluate(async()=> (await chrome.storage.local.get('opalCourseSnapshotIndex')).opalCourseSnapshotIndex);
    expect(visits?.['123']).toBeUndefined();
    await expect.poll(() => worker.evaluate(async()=> (await chrome.storage.local.get('opalScrapedDeadlines')).opalScrapedDeadlines?.some(d=>d.pageUrl.endsWith('/CourseNode/3')))).toBe(true);
    await p.keyboard.press('Control+k');
    await p.locator('#opal-cmd-input').fill('\u00fcbung 3');
    const hit=p.locator('.opal-cmd-result').filter({hasText:'Aufgabe 3'});
    await expect(hit).toBeVisible();
    // "L\u00f6sung" opens the folder that holds the solution in a new tab and marks the file there.
    // Tabs the extension opens itself bypass context.route, so record them instead of letting them reach the network.
    await worker.evaluate(() => { globalThis.openedTabs = []; chrome.tabs.create = (options, done) => { globalThis.openedTabs.push(options.url); done?.(); }; });
    await hit.getByRole('button',{name:'L\u00f6sung',exact:true}).click();
    await expect.poll(() => worker.evaluate(() => globalThis.openedTabs)).toEqual([`${course}/CourseNode/2`]);
    expect((await worker.evaluate(async () => (await chrome.storage.local.get('opalHighlightFile')).opalHighlightFile))?.url).toMatch(/\/l3\.pdf$/);
    const requests=app.seen.filter(u=>u.startsWith(course) && !u.endsWith('.pdf'));
    expect(requests.length).toBe(4);
});

suite('TUfast actions mirror native listeners, disabled updates and banner ownership', async ({app}) => {
    const p = await dashboard(app);
    await p.locator('[data-skip]').click();
    await p.evaluate(() => {
        document.querySelector('#openAllCoursesButton').addEventListener('click', () => document.body.dataset.tufastClicked = 'yes');
        const banner = document.createElement('div'); banner.id='TUfastBanner';
        banner.innerHTML='<span>Hinweis von TUfast</span><span class="closeLink">Schließen</span>';
        banner.querySelector('.closeLink').onclick=()=>document.body.removeChild(banner);
        document.body.prepend(banner);
    });
    await p.getByRole('button',{name:'TUfast',exact:true}).click();
    await expect(p.locator('#opal-tufast-menu button').last()).toBeDisabled();
    await p.evaluate(() => document.querySelector('#closeAllTabsButton').removeAttribute('style'));
    await expect(p.locator('#opal-tufast-menu button').last()).toBeEnabled();
    await p.locator('#opal-tufast-menu button').first().click();
    await expect(p.locator('body')).toHaveAttribute('data-tufast-clicked','yes');
    await expect(p.locator('#TUfastBanner')).toBeVisible();
    await p.locator('#TUfastBanner .closeLink').click();
    await expect(p.locator('#TUfastBanner')).toHaveCount(0);
    await p.evaluate(() => document.querySelector('.tufast-opal-header').remove());
    await expect(p.getByRole('button',{name:'TUfast',exact:true})).toHaveCount(0);
});

suite('logout fires the native Abmelden anchor listener', async ({app}) => {
    const p = await dashboard(app); await p.locator('[data-skip]').click();
    await p.evaluate(() => document.querySelector('a[title="Abmelden"]').addEventListener('click', e => { e.preventDefault(); document.body.dataset.nativeLogout='yes'; }));
    await p.locator('#opal-user-btn').click();
    await p.locator('#opal-user-dropdown [data-opal-action="Abmelden"]').click();
    await expect(p.locator('body')).toHaveAttribute('data-native-logout','yes');
});

suite('avatar menu is a keyboard menu and the options request key opens edit mode with the Darstellung panel', async ({app}) => {
    const p = await dashboard(app); await p.locator('[data-skip]').click(); await expect(p.locator('#opal-onboarding')).toHaveCount(0);
    await p.locator('#opal-user-btn').focus(); await p.keyboard.press('Enter');
    await expect(p.locator('#opal-user-dropdown [role="menuitem"]').first()).toBeFocused();
    await p.keyboard.press('End'); await expect(p.locator('#opal-user-dropdown [data-opal-action="Abmelden"]')).toBeFocused();
    await p.keyboard.press('Escape');
    await expect(p.locator('#opal-user-btn')).toBeFocused();
    await app.storage({opalCustomizeRequested:{request:'appearance',at:Date.now()}, opalOnboarding:{version:1,skippedAt:1,choices:{course:false,preload:false,news:false,deadlines:false}}});
    await expect(p.locator('#opal-edit-toggle')).toBeVisible();
    await expect(p.locator('#opal-theme-editor')).toBeVisible();
    await expect.poll(() => app.context.serviceWorkers()[0].evaluate(async () => (await chrome.storage.local.get('opalCustomizeRequested')).opalCustomizeRequested)).toBeFalsy();
});

suite('the options page puts exactly one of several open dashboards into edit mode', async ({app}) => {
    await app.storage({opalOnboarding:{version:1,skippedAt:1,choices:{course:false,preload:false,news:false,deadlines:false}}});
    const first = await dashboard(app), second = await dashboard(app);
    const options = await app.context.newPage(); await options.goto(`chrome-extension://${app.id}/options/options.html`);
    await options.locator('#customizeBtn').click();
    await expect.poll(async () => (await first.locator('#opal-edit-toggle').count()) + (await second.locator('#opal-edit-toggle').count())).toBe(1);
    await first.waitForTimeout(1000);
    expect((await first.locator('#opal-edit-toggle').count()) + (await second.locator('#opal-edit-toggle').count())).toBe(1);
    await expect.poll(() => app.context.serviceWorkers()[0].evaluate(async () => (await chrome.storage.local.get('opalCustomizeRequested')).opalCustomizeRequested)).toBeFalsy();
});
