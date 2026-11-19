import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFakeOpal } from './fake-opal.mjs';
const repo = process.cwd();
const fixture = n => fs.readFile(path.join(repo, 'test/e2e/fixtures', n), 'utf8');
const course = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/123';
const meals = [{ id: 1, name: 'TEST PASTA', category: 'Pasta', notes: [], prices: { Studierende: 2.34, Bedienstete: 4.56 } }];
export async function interceptOpal(context, info, use) {
    const errors = [], requests = [], seen = [];
    const watch = page => { page.on('console', m => { if(m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(e.message)); };
    context.pages().forEach(watch); context.on('page', watch);
    context.on('requestfailed', r => requests.push(`${r.url()} ${r.failure()?.errorText}`));
    const fake = createFakeOpal({ repoRoot: repo, startPagePath: path.join(repo, 'test/e2e/fixtures/dashboard.html') });
    let slow = false;
    await context.route('**/*', async route => {
        const r = route.request(), u = new URL(r.url()); seen.push(r.url());
        if (['chrome-extension:', 'moz-extension:'].includes(u.protocol)) return route.continue();
        let response;
        if (u.hostname === 'api.studentenwerk-dresden.de' && /\/meals\/?$/.test(u.pathname)) response = { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(meals) };
        else if (u.hostname === 'bildungsportal.sachsen.de' && u.pathname.startsWith('/opal/auth/RepositoryEntry/123')) {
            if (/\.pdf$/.test(u.pathname)) return route.fulfill({status:200,contentType:'text/html',body:'<html>Downloaded solution</html>'});
            if(slow && u.pathname.includes('CourseNode')) await new Promise(r => setTimeout(r, 900));
            const file = u.pathname.includes('/CourseNode/2/') ? 'subfolder.html' : u.pathname.endsWith('/2') ? (u.search ? 'subfolder.html' : 'folder.html') : u.pathname.endsWith('/3') ? 'page.html' : 'course.html';
            response = { status: 200, contentType: 'text/html', body: (await fixture(file)) + (file === 'page.html' ? '<main>Abgabe bis 24.11.2026</main>' : '') + (file === 'subfolder.html' ? '<table><tr><td><a data-file-name="Aufgabe_3.pdf" href="/opal/auth/RepositoryEntry/123/CourseNode/2/a3.pdf">Aufgabe 3</a></td></tr><tr><td><a data-file-name="Loesung_3.pdf" href="/opal/auth/RepositoryEntry/123/CourseNode/2/l3.pdf">Loesung 3</a></td></tr></table>' : '') };
        } else if (u.hostname === 'bildungsportal.sachsen.de' && u.pathname === '/opal/FolderResource/123/start.html') response = { status: 200, contentType: 'text/html', body: await fixture('frame.html') };
        else if (u.hostname === 'bildungsportal.sachsen.de' && /^\/opal\/(home)?\/?$/.test(u.pathname)) response = { status: 200, contentType: 'text/html', body: await fixture('dashboard.html') };
        else response = fake.resolve(r.url(), r.method());
        if(response.block || response.status === 404) { errors.push(`Unrouted request: ${r.url()}`); return route.abort(); }
        await route.fulfill(response);
    });
    try { await use({ seen, slow: () => { slow = true; } }); }
    finally {
        await info.attach('browser-diagnostics', { body: JSON.stringify({errors, requests, seen}, null, 2), contentType: 'application/json' });
        await fs.writeFile(info.outputPath('diagnostics.json'), JSON.stringify({errors,requests,seen},null,2));
        expect(errors, 'console errors and unrouted requests').toEqual([]);
        expect(requests, 'failed requests').toEqual([]);
    }
}
