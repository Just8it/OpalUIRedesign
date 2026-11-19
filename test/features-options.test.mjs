import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { URL } from 'node:url';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
const options = readFileSync(new URL('../src/options/main.ts',import.meta.url),'utf8');
test('options reads and writes through the storage registry only',()=>{
    assert.match(options, /from '[.][.]\/storage\/registry[.]ts'/);
    assert.doesNotMatch(options, /getDefaultLayout|chrome[.]storage/);
});

test('popup list keyboard handling only runs while search has focus',()=>{
    const source = readFileSync(new URL('../src/popup/main.ts',import.meta.url),'utf8');
    const start = source.indexOf("document.addEventListener('keydown'");
    const handler = source.slice(start, source.indexOf('\n});', start) + 4);
    let opened=0;
    const searchInput = {}, other = {};
    const context = {document:{activeElement:other,addEventListener:(_,fn)=>context.handler=fn},searchInput,window:{close(){}},openResult:()=>opened++};
    vm.runInNewContext(handler,context);
    const event = {key:'Enter',preventDefault(){this.prevented=true}};
    context.handler(event); assert.equal(opened,0); assert.equal(event.prevented,undefined);
    context.document.activeElement=searchInput;
    context.handler(event); assert.equal(opened,1); assert.equal(event.prevented,true);
});

test('popup translates search results when the language changes without losing the query', async () => {
    const { outputFiles: [{ text: bundle }] } = buildSync({
        entryPoints: ['src/popup/main.ts'], bundle: true, write: false, format: 'iife',
    });
    const root = { lang: 'de', dataset: {}, style: { setProperty() {} } };
    const body = { hidden: true };
    const elements = new Map();
    const createElement = () => ({
        dataset: {}, value: '', textContent: '', setAttribute(key, value) { this[key] = value; },
        addEventListener(key, listener) { this[key] = listener; }, focus() {},
        replaceChildren(...children) { this.children = children; },
    });
    const getElementById = id => {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
    };
    const search = getElementById('search');
    search['data-i18n-placeholder'] = 'popupPlaceholder';
    search.getAttribute = key => search[key];
    const storageListeners = [];
    vm.runInNewContext(bundle, {
        document: {
            body, documentElement: root, createElement, getElementById, addEventListener() {},
            querySelectorAll: selector => selector === '[data-i18n-placeholder]' ? [search] : [],
        },
        chrome: {
            storage: { local: { get: async () => ({ opalLanguage: 'en' }) }, onChanged: { addListener(fn) { storageListeners.push(fn); } } },
            runtime: { getManifest: () => ({ version: '0.2.6' }), sendMessage(_request, respond) { respond({ ok: true, data: [] }); } },
        },
    });
    assert.equal(body.hidden, true);
    await setImmediate();
    assert.equal(body.hidden, false);
    assert.equal(root.lang, 'en-GB');
    assert.equal(search.placeholder, 'e.g. Exercise 3');
    search.value = 'Analysis';
    await search.input();
    assert.equal(getElementById('results').children[0].textContent, 'No results for “Analysis”.');
    for (const listener of storageListeners) listener({ opalLanguage: { newValue: 'de' } }, 'local');
    assert.equal(root.lang, 'de-DE');
    assert.equal(search.placeholder, 'z. B. Übung 3');
    assert.equal(search.value, 'Analysis');
    assert.equal(getElementById('results').children[0].textContent, 'Keine Treffer für „Analysis“.');
});

