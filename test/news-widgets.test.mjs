import assert from 'node:assert/strict';
import test from 'node:test';
import { setLocale } from '../src/i18n/core.ts';
import { quickaccessWidget } from '../src/widgets/quickaccess.ts';
import { mergeNews, splitNewsTitle } from '../src/widgets/news-model.ts';
import { migrateNewsLayout, getDefaultLayout } from '../src/layout.ts';
import { groupNewFiles, relativeTime } from '../src/widgets/whats-new-helpers.ts';
const entry = (widgetId, hidden = false) => ({ widgetId, hidden, x: 2, y: 4, w: 5, h: 6 });
test('news merges links and normalized titles transitively and sorts newest first', () => {
    const result = mergeNews([
        { title: ' Hallo  Welt ', link: '/a', tag: 'news', dateMs: 10 },
        { title: 'hallo welt', link: '/b', tag: 'info', dateMs: 20 },
        { title: 'Other', link: '/a', tag: 'announcements' },
        { title: 'Newest', tag: 'news', dateMs: 30 },
    ]);
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Newest');
    assert.equal(result[1].sources.length, 3);
});
test('OPAL feed boilerplate becomes subject and author, other titles stay as they are', () => {
    assert.deepEqual(splitNewsTitle('Mitteilung "AERO V 3.1-3.2" wurde von Jörg Stiller erstellt'), { subject: 'AERO V 3.1-3.2', author: 'Jörg Stiller' });
    assert.deepEqual(splitNewsTitle('Mitteilung „Raumänderung" wurde von Thomas Rosen geändert'), { subject: 'Raumänderung', author: 'Thomas Rosen' });
    assert.deepEqual(splitNewsTitle('Mitteilung "Übung "SGTM", 16.11.2026" wurde von Johanna M. erstellt'), { subject: 'Übung "SGTM", 16.11.2026', author: 'Johanna M.' });
    assert.deepEqual(splitNewsTitle('Wartungsarbeiten am 20.11.'), { subject: 'Wartungsarbeiten am 20.11.' });
});
test('migration keeps first visible legacy geometry and unrelated entries unchanged', () => {
    const unknown = entry('unknown');
    const visible = { ...entry('aktuelles'), x: 7 };
    const input = [entry('news', true), unknown, visible, entry('announcements')];
    const result = migrateNewsLayout(input);
    assert.deepEqual(result, [unknown, { ...visible, widgetId: 'neuigkeiten' }]);
    assert.equal(input.length, 4);
    assert.deepEqual(migrateNewsLayout(result), result);
});
test('all hidden feeds stay hidden and new optional widget defaults hidden', () => {
    assert.equal(migrateNewsLayout([entry('news', true), entry('aktuelles', true)])[0].hidden, true);
    assert.equal(getDefaultLayout().find(e => e.widgetId === 'whats-new').hidden, true);
});
test('group files by course retaining source order', () => {
    const a = { path: ['Mathematik', 'Woche 1'] };
    const b = { path: ['Physik'] };
    assert.deepEqual([...groupNewFiles([a, b, a])], [['Mathematik', [a, a]], ['Physik', [b]]]);
});
test('relative time handles hours, calendar yesterday, days, and future timestamps', () => {
    const now = new Date(2026, 10, 15, 12).getTime();
    assert.equal(relativeTime(now - 7200000, now), 'vor 2 Std.');
    assert.equal(relativeTime(new Date(2026, 10, 14, 23).getTime(), now), 'gestern');
    assert.equal(relativeTime(now - 3 * 86400000, now), 'vor 3 Tagen');
    assert.equal(relativeTime(now + 5000, now), 'gerade eben');
    assert.equal(relativeTime(now - 2 * 86400000, now), 'vor 2 Tagen');
});

test('widget titles, markup and relative times follow language changes after import', () => {
    const now = new Date(2026, 10, 15, 12).getTime();
    assert.equal(quickaccessWidget.title, 'Schnellzugriff');
    try {
        setLocale('en');
        assert.equal(quickaccessWidget.title, 'Quick access');
        assert.match(quickaccessWidget.render(), /Teaching &amp; learning/);
        assert.equal(relativeTime(now - 7200000, now), '2 hours ago');
        assert.equal(relativeTime(now - 86400000, now), 'yesterday');
        assert.equal(relativeTime(now - 3 * 86400000, now), '3 days ago');
    } finally {
        setLocale('de');
    }
    assert.equal(quickaccessWidget.title, 'Schnellzugriff');
});
