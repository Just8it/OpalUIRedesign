import { test, expect, firefox } from '@playwright/test';
import { withExtension } from 'playwright-webextext';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { interceptOpal } from './app-fixture.mjs';
import { START_URL } from './fake-opal.mjs';

const suite = test.extend({ app: async ({}, use, info) => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'opal-firefox-'));
    let context;
    try {
        const extension = path.join(temp, 'extension');
        const zip = await JSZip.loadAsync(await fs.readFile('opal-redesign-firefox.zip'));
        for (const entry of Object.values(zip.files)) {
            if (entry.dir) continue;
            const file = path.join(extension, entry.name);
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, await entry.async('nodebuffer'));
        }
        // Firefox extension pages cannot be automated reliably by Playwright.
        // Seed only the opt-in setting in this disposable test copy.
        const manifestPath = path.join(extension, 'manifest.json');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        manifest.background.scripts.push('test-seed.js');
        await fs.writeFile(path.join(extension, 'test-seed.js'), 'browser.storage.local.set({opalCourseViewEnabled:true,opalLanguage:"de"});');
        await fs.writeFile(manifestPath, JSON.stringify(manifest));
        // Probe only browser availability. Add-on installation and test failures must fail.
        try { const probe = await firefox.launch({ headless: true }); await probe.close(); }
        catch (error) {
            const reason = `Firefox unavailable; run npx playwright install firefox. ${error.message}`;
            console.warn(reason);
            test.skip(true, reason);
        }
        context = await withExtension(firefox, extension).launchPersistentContext(path.join(temp, 'profile'), {
            headless: true,
        });
        await interceptOpal(context, info, async shared => {
            await use({ context, ...shared });
        });
    } finally {
        await context?.close();
        await fs.rm(temp, { recursive: true, force: true });
    }
} });

async function dashboard(app) {
    const page = await app.context.newPage();
    await page.goto(START_URL);
    await expect(page.locator('#opal-modern-ui')).toBeVisible();
    // First run opens on the terms; "Später" closes the setup without storing anything.
    await page.locator('#opal-onboarding [data-choice="no"]').click();
    return page;
}
suite('Firefox dashboard replaces native UI', async ({ app }) => {
    const page = await dashboard(app);
    await expect(page.locator('.grid-stack-item[gs-id]')).toHaveCount(4);
});
suite('Firefox course loads gateway sections through Xray wrappers', async ({ app }) => {
    const page = await app.context.newPage();
    await page.goto('https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/123');
    await expect(page.locator('#opal-modern-ui')).toBeVisible();
    await expect(page.locator('#opal-course-progress')).toBeAttached();
    await expect(page.locator('#opal-course-progress')).toBeHidden({ timeout: 30000 });
    await page.locator('[data-nav="sec:3"]').click();
    await expect(page.locator('#opal-modern-ui')).toContainText('Die Vorlesung beginnt am Montag.');
    expect(app.seen.some(url => url.includes('/CourseNode/2?'))).toBe(true);
    expect(app.seen.some(url => url.includes('/FolderResource/123/start.html'))).toBe(true);
});
suite('Firefox Ctrl+K searches', async ({ app }) => {
    const page = await dashboard(app);
    await page.keyboard.press('Control+k');
    await expect(page.locator('#opal-cmd-input')).toBeVisible();
    await page.locator('#opal-cmd-input').fill('> Kursdateien aktualisieren');
    await expect(page.locator('#opal-cmd-results').getByText('Kursdateien aktualisieren', { exact: true })).toBeVisible();
});
suite('Firefox native settings click crosses into MAIN world', async ({ app }) => {
    const page = await dashboard(app);
    await page.evaluate(() => {
        const target = document.querySelector('[data-portlet-order="Bookmarks"] .dropdown-menu li:last-child a');
        // A page-owned handler observes the real click from the isolated content script.
        target.addEventListener('click', () => document.documentElement.setAttribute('data-test-native-click', 'yes'));
    });
    await page.locator('#opal-user-btn').click();
    await page.locator('[data-action="customize"]').click();
    await page.locator('.widget-config-btn[data-widget-id="favorites"]').evaluate(button => button.click());
    await expect(page.locator('html')).toHaveAttribute('data-test-native-click', 'yes');
});
