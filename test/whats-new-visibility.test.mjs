import test from 'node:test';
import assert from 'node:assert/strict';
import { revealWhatsNew, migrateWhatsNewVisibility } from '../src/layout.ts';
import { getDefaultLayout } from '../src/storage/layout.ts';
test('only eligible layouts reveal once data exists, below visible cards', () => {
 const layout = getDefaultLayout();
 assert.equal(revealWhatsNew(layout, false, false), layout);
 assert.equal(revealWhatsNew(layout, true, true), layout);
 const revealed = revealWhatsNew(layout, false, true);
 const widget = revealed.find(e => e.widgetId === 'whats-new');
 assert.equal(widget.hidden, false);
 assert.ok(layout.filter(e => !e.hidden).every(e => e.y + e.h <= widget.y));
 assert.equal(layout.find(e => e.widgetId === 'whats-new').hidden, true);
});
test('legacy layouts: a default-hidden widget is revealed once, visible or removed ones are left alone', () => {
 const entry = hidden => ({ widgetId: 'whats-new', hidden, x: 0, y: 0, w: 4, h: 4 });
 const other = { widgetId: 'mensa', hidden: false, x: 0, y: 0, w: 4, h: 4 };
 assert.equal(migrateWhatsNewVisibility([]), false, 'no saved layout: eligible');
 assert.equal(migrateWhatsNewVisibility([other, entry(true)]), false, 'hidden by default: eligible');
 assert.equal(migrateWhatsNewVisibility([other, entry(false)]), true, 'already visible: nothing to reveal');
 assert.equal(migrateWhatsNewVisibility([other]), true, 'removed: the user decided');
});
