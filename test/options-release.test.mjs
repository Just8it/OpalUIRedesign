
import test from 'node:test';
import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import { clearTimeout, setImmediate, setTimeout } from 'node:timers';
import vm from 'node:vm';

const { buildSync } = await import('esbuild');
const source = buildSync({ entryPoints: ['src/options/main.ts'], bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
function setup({ nodes = [], exportError, settings = {}, browserLanguage = 'de' } = {}) {
    const elements = new Map();
    const writes = [];
    const calls = [];
    const downloads = [];
    const blobs = [];
    const revoked = [];
    const listeners = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            textContent: '', style: {}, dataset: {}, addEventListener(event, fn) { this[event] = fn; },
            replaceChildren(...children) { this.children = children; },
        });
        return elements.get(id);
    };
    const heading = element('h-general');
    heading.dataset.i18n = 'optionsGeneral';
    const root = { lang: 'de', dataset: {}, style: { setProperty() {} } };
    const body = { hidden: true, append() {} };
    const notify = changes => listeners.slice().forEach(fn => fn(changes, 'local'));
    const chrome = {
        i18n: { getUILanguage: () => browserLanguage },
        storage: {
            local: {
                get: async () => ({ ...settings }),
                set: async value => {
                    writes.push(value);
                    Object.assign(settings, value);
                    notify(Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { newValue }])));
                },
                clear: async () => calls.push('storage'),
            },
            onChanged: { addListener(fn) { listeners.push(fn); }, removeListener(fn) { listeners.splice(listeners.indexOf(fn), 1); } },
        },
        runtime: { getManifest: () => ({version:'0.2.6'}), sendMessage(message, callback) {
            calls.push(message.op);
            callback(message.op === 'exportNodes'
                ? exportError ? { ok: false, error: exportError } : { ok: true, data: nodes }
                : { ok: true, data: { total: 0 } });
        } },
    };
    vm.runInNewContext(source, { document: {
        getElementById: element, querySelectorAll: selector => selector === '[data-i18n]' ? [heading] : [],
        documentElement: root, body,
        createElement: () => {
            const node = { children: [], handlers: {}, className: '', setAttribute() {}, append(...nodes) { this.children.push(...nodes); }, remove() {}, focus() {},
                addEventListener(event, fn) { this.handlers[event] = fn; },
                click() { if (this.handlers.click) this.handlers.click({ target: this }); else downloads.push({ href: this.href, filename: this.download }); },
                // The styled confirm dialog: confirm the danger button as a user would.
                showModal() { const find = n => n.className.includes('opal-btn-danger') ? n : n.children.map(find).find(Boolean); globalThis.queueMicrotask(() => find(this)?.click()); },
                close() { this.handlers.close?.(); } };
            return node;
        },
    }, chrome, clearTimeout, setTimeout, Intl, Date, Blob,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:search-export'; }, revokeObjectURL(url) { revoked.push(url); } } });
    return { element, writes, calls, downloads, blobs, revoked, listeners, root, body };
}

test('search export downloads the complete index as JSON, including empty indexes', async () => {
    for (const nodes of [[], Array.from({length: 650}, (_, id) => ({ id: String(id), title: `Übung ${id}`, courseId: 'course', parentId: 'folder', visitCount: 2 }))]) {
        const { element, writes, calls, downloads, blobs, revoked } = setup({ nodes });
        const exporting = element('exportIndexBtn').click();
        assert.equal(element('exportIndexBtn').disabled, true);
        await exporting;
        assert.ok(calls.includes('exportNodes'));
        assert.equal(downloads.length, 1);
        assert.match(downloads[0].filename, /^opal-redesign-search-index-\d{4}-\d{2}-\d{2}\.json$/);
        assert.equal(blobs[0].type, 'application/json');
        assert.deepEqual(JSON.parse(await blobs[0].text()), nodes);
        assert.deepEqual(revoked, ['blob:search-export']);
        assert.equal(element('exportIndexBtn').disabled, false);
        assert.match(element('statusText').textContent, new RegExp(`exportiert: ${nodes.length}`));
        assert.equal(writes.length, 0);
    }
});

test('failed search export shows an error and allows another attempt without downloading', async () => {
    const { element, downloads } = setup({ exportError: 'Unavailable' });
    await element('exportIndexBtn').click();
    assert.equal(downloads.length, 0);
    assert.equal(element('exportIndexBtn').disabled, false);
    assert.match(element('statusText').textContent, /nicht exportiert/);
});
test('import rejects invalid JSON, roots, oversized files and nested pollution', async () => {
    for (const [text, size] of [['{', 1], ['[]', 2], ['null', 4], ['{}', 6 * 1024 * 1024], ['{"opalTheme_v1":{"constructor":{}}}', 40]]) {
        const { element, writes } = setup();
        element('importFile').files = [{ size, text: async () => text }];
        await element('importFile').change();
        assert.equal(writes.length, 0);
        assert.match(element('statusText').textContent, /Import fehlgeschlagen/);
    }
});
test('only known correctly typed settings import; markup remains text', async () => {
    const { element, writes } = setup();
    element('importFile').files = [{ size: 100, text: async () => JSON.stringify({ opalRedesignEnabled: false, opalCmdHistory: ['<img src=x>'], opalMensaSettings: 'bad', '<script>': 1 }) }];
    await element('importFile').change();
    assert.equal(writes.length, 1);
    assert.deepEqual(Object.keys(writes[0]), ['opalRedesignEnabled', 'opalCmdHistory']);
    assert.match(element('statusText').textContent, /<script>/);
    assert.match(element('statusText').textContent, /opalMensaSettings/);
});
test('clear all reaches background and local storage', async () => {
    const { element, calls } = setup();
    await element('clearAllBtn').click();
    assert.ok(calls.includes('storage'));
    assert.ok(calls.includes('clear'));
});

test('refresh writes the request key; an open tab claims it, otherwise it stays pending', async () => {
    for (const claimed of [true, false]) {
        const { element, writes, listeners } = setup();
        const clicking = element('refreshIndexBtn').click();
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.deepEqual(Object.keys(writes[0]), ['opalIndexRefreshRequested']);
        assert.equal(typeof writes[0].opalIndexRefreshRequested, 'number');
        if (claimed) listeners.slice().forEach(fn => fn({ opalIndexRefreshRequested: { oldValue: writes[0].opalIndexRefreshRequested, newValue: 0 } }, 'local'));
        await clicking;
        assert.equal(element('searchStatus').textContent, claimed ? 'Wird aktualisiert…' : 'Wird aktualisiert, sobald du OPAL öffnest.');
    }
});

test('course home and progress data export and import through their normalisers', async () => {
    const { element, writes } = setup();
    element('importFile').files = [{ size: 100, text: async () => JSON.stringify({ opalCourseHome_1: { version: 1, blocks: [] }, opalCourseProgress_1: { done: { a: 1, b: 'x' } }, opalCourseHome_2: 'bad', opalCustomizeRequested: 'edit' }) }];
    await element('importFile').change();
    assert.deepEqual(Object.keys(writes[0]), ['opalCourseHome_1', 'opalCourseProgress_1']);
    assert.equal(JSON.stringify(writes[0].opalCourseProgress_1.done), '{"a":1}');
    assert.match(element('statusText').textContent, /opalCourseHome_2/);
    assert.match(element('statusText').textContent, /opalCustomizeRequested/);
});

test('direct download toggle persists a boolean that settings import accepts', async () => {
    const {element, writes} = setup();
    element('downloadFilesToggle').checked = true;
    await element('downloadFilesToggle').change();
    assert.equal(writes[0].opalDownloadFiles, true);
    element('importFile').files = [{size:30, text:async()=>'{"opalDownloadFiles":false}'}];
    await element('importFile').change();
    assert.equal(writes[1].opalDownloadFiles, false);
});

test('language preference initializes before display, updates the page, and round-trips through backups', async () => {
    const { element, writes, blobs, root, body } = setup({ settings: { opalLanguage: 'en' } });
    assert.equal(body.hidden, true);
    await new Promise(resolve => setImmediate(resolve));
    const select = element('languageSelect');
    const heading = element('h-general');
    assert.equal(body.hidden, false);
    assert.equal(select.value, 'en');
    assert.equal(root.lang, 'en-GB');
    assert.equal(heading.textContent, 'General');
    await element('exportBtn').click();
    assert.deepEqual(JSON.parse(await blobs[0].text()), { opalLanguage: 'en' });
    assert.equal(element('statusText').textContent, 'Settings exported.');

    select.value = 'auto';
    await select.change();
    assert.equal(writes[0].opalLanguage, 'auto');
    assert.equal(root.lang, 'de-DE');
    assert.equal(heading.textContent, 'Allgemein');
    assert.equal(element('statusText').textContent, 'Einstellungen exportiert.');

    const importLanguage = async value => {
        element('importFile').files = [{ size: 100, text: async () => JSON.stringify({ opalLanguage: value }) }];
        await element('importFile').change();
    };
    await importLanguage('fr');
    assert.equal(Object.hasOwn(writes[1], 'opalLanguage'), false);
    assert.equal(select.value, 'auto');
    await importLanguage('en');
    assert.equal(writes[2].opalLanguage, 'en');
    assert.equal(select.value, 'en');
    assert.equal(root.lang, 'en-GB');
    assert.match(element('statusText').textContent, /Imported: opalLanguage/);
});
