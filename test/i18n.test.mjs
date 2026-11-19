import test from 'node:test';
import assert from 'node:assert/strict';
import { defineMessages, setLocale, resolveLocale, detectLocale, onLocaleChange, locale } from '../src/i18n/core.ts';

test('messages follow the locale, fill placeholders and pick plural forms', () => {
    const t = defineMessages(
        { save: 'Speichern', files: { one: '{count} Datei', other: '{count} Dateien' }, hello: 'Hallo {name}' },
        { save: 'Save', files: { one: '{count} file', other: '{count} files' }, hello: 'Hello {name}' },
    );
    setLocale('de');
    assert.equal(t('save'), 'Speichern');
    assert.equal(t('files', { count: 1 }), '1 Datei');
    assert.equal(t('files', { count: 1200 }), '1.200 Dateien');
    assert.equal(t('hello', { name: 'Ada' }), 'Hallo Ada');
    setLocale('en');
    assert.equal(t('save'), 'Save');
    assert.equal(t('files', { count: 1 }), '1 file');
    assert.equal(t('files', { count: 1200 }), '1,200 files');
    assert.equal(t('hello'), 'Hello {name}');
    setLocale('de');
});

test('auto follows the browser UI language and falls back to German outside the extension', () => {
    assert.equal(detectLocale(), 'de');
    globalThis.chrome = { i18n: { getUILanguage: () => 'en-US' } };
    try {
        assert.equal(resolveLocale('auto'), 'en');
        assert.equal(resolveLocale('de'), 'de');
        globalThis.chrome.i18n.getUILanguage = () => 'de-AT';
        assert.equal(resolveLocale(undefined), 'de');
    } finally { delete globalThis.chrome; }
});

test('listeners hear a language change once', () => {
    setLocale('de');
    const heard = [];
    const off = onLocaleChange(next => heard.push(next));
    setLocale('en'); setLocale('en'); off(); setLocale('de');
    assert.deepEqual(heard, ['en']);
    assert.equal(locale(), 'de');
});
