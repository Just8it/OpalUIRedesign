import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaims } from '../src/core/claims.ts';
import { takeableRequest } from '../src/customize-requests.ts';

/** Every tab receives the same storage change and asks the background; the background answers one message at a time. */
const tabs = (claim, n, message) => Promise.all(Array.from({ length: n }, async () => { await null; return claim(message); }));

test('a refresh request runs in exactly one of several tabs', async () => {
    const claim = createClaims();
    const granted = (await tabs(claim, 4, { type: 'opal-claim', job: 'refresh', token: 1000 })).filter(Boolean);
    assert.equal(granted.length, 1);
    assert.equal(claim({ type: 'opal-claim', job: 'refresh', token: 1000 }), false, 'a late tab with the same request is turned away');
    assert.equal(claim({ type: 'opal-claim', job: 'refresh', token: 2000 }), true, 'a new request has a new token');
});

test('catalog and preload switches run once per change, not once per tab', async () => {
    let time = 0;
    const claim = createClaims(() => time);
    for (const job of ['catalog', 'preload']) {
        assert.equal((await tabs(claim, 3, { type: 'opal-claim', job })).filter(Boolean).length, 1);
        claim({ type: 'opal-claim', job, release: true });
        time += 2000;
        assert.equal(claim({ type: 'opal-claim', job }), false, 'a tab that reacts a moment later is still turned away after the release');
        time += 20_000;
        assert.equal(claim({ type: 'opal-claim', job }), true, 'a later switch is a new run');
    }
});

test('a lease left by a closed tab expires', () => {
    let time = 0;
    const claim = createClaims(() => time);
    assert.equal(claim({ type: 'opal-claim', job: 'catalog' }), true);
    time += 60_000;
    assert.equal(claim({ type: 'opal-claim', job: 'catalog' }), false, 'still running');
    time += 16 * 60_000;
    assert.equal(claim({ type: 'opal-claim', job: 'catalog' }), true);
});

test('a customize request goes to its tab only and expires', () => {
    const stored = { request: 'appearance', at: 1_000_000, tabId: 7 };
    assert.equal(takeableRequest(stored, 8, 1_001_000), '');
    assert.equal(takeableRequest(stored, 7, 1_001_000), 'appearance');
    assert.equal(takeableRequest(stored, 7, 1_000_000 + 121_000), '');
    assert.equal(takeableRequest(null, 7, 1_000_000), '');
    assert.equal(takeableRequest({ request: 'edit', at: 5 }, 9, 6), 'edit');
});
