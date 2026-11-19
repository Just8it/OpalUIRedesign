import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout, normaliseLayout, normalisePrefs, moveSection } from '../src/course/browse/prefs.ts';
test('legacy card layout migrates to the file browser columns', () => {
    assert.deepEqual(normaliseLayout({ columns: 3, blocks: { recent: false } }), defaultLayout());
    assert.deepEqual(normalisePrefs({ wide: ['a'], hidden: ['a', 'removed'], collapsed: ['b'], selected: 'sec:a' }, ['a', 'b']), { order: [], hidden: ['a'], collapsed: ['b'], selected: 'sec:a' });
});
test('section movement preserves hidden sections and ignores stale ids', () => {
    const prefs = { order: ['removed', 'b'], hidden: ['a'], collapsed: [] };
    const moved = moveSection(prefs, ['a', 'b', 'c'], 'a', 1);
    assert.deepEqual(moved.order, ['b', 'c', 'a']);
    assert.deepEqual(moved.hidden, ['a']);
    assert.deepEqual(prefs.order, ['removed', 'b']);
});
