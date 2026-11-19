import assert from 'node:assert/strict';
import test from 'node:test';
import { openExtensionOptions } from '../src/extension-options.ts';

test('options handles Chrome lastError and falls back to background', async () => {
    const previous = globalThis.chrome;
    let fallback = false;
    const runtime = { id: 'extension', openOptionsPage(cb) {
        runtime.lastError = { message: 'Unavailable in content script' }; cb(); delete runtime.lastError;
    }, sendMessage(message, cb) { fallback = message.type === 'opal-open-options'; cb({ ok: true }); } };
    globalThis.chrome = { runtime };
    try { await openExtensionOptions(); assert.equal(fallback, true); }
    finally { globalThis.chrome = previous; }
});

test('options handles Firefox promise rejection and uses browser namespace', async () => {
    const previous = globalThis.browser;
    let fallback = false;
    globalThis.browser = { runtime: { id: 'extension', openOptionsPage: () => Promise.reject(new Error('unavailable')),
        sendMessage: async () => { fallback = true; return { ok: true }; } } };
    try { await openExtensionOptions(); assert.equal(fallback, true); }
    finally { globalThis.browser = previous; }
});
