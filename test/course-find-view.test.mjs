import test from 'node:test';
import assert from 'node:assert/strict';
import { bannerAnnouncement, announcementKey, renderBanner, renderAnnouncementsPane } from '../src/course/render/announcements.ts';
import { renderSidebar } from '../src/course/render/sidebar.ts';
import { typeToFind, findPlaceholder } from '../src/course/render/find-field.ts';
import { highlight } from '../src/course/render/format.ts';
globalThis.location = { origin: 'https://bildungsportal.sachsen.de' };
test('banner follows last visit and dismissal; announcements keep expanded state', () => {
    const list = [1, 3, 2].map(date => ({ title: `T${date}`, date, text: '<b>Text</b>', author: 'Dr. Weber', url: 'https://example.org/news' }));
    assert.equal(bannerAnnouncement(list, 0, ''), null);
    assert.equal(bannerAnnouncement(list, 4, ''), null);
    const fresh = bannerAnnouncement(list, 1, '');
    assert.equal(fresh.title, 'T3');
    assert.equal(bannerAnnouncement(list, 1, announcementKey(fresh)), null);
    assert.equal(renderBanner(null), '');
    assert.match(renderBanner(fresh), /data-banner="read">Lesen/);
    const html = renderAnnouncementsPane(list, 1, new Set(['3|T3']));
    assert.ok(html.indexOf('T3') < html.indexOf('T2'));
    assert.match(html, /data-ann="3\|T3"[^>]*aria-expanded="true"/);
    assert.match(html, /&lt;b&gt;Text&lt;\/b&gt;/);
    assert.match(html, /Alle Mitteilungen in OPAL/);
});
test('sidebar uses one tab stop and offers section editing and native links', () => {
    const blocks = [{ key: 'content', title: 'Kursinhalt', items: [
        { id: 'sec:42', kind: 'section', label: 'Vorlesung', count: 2, hasNew: true, depth: 1 },
        { id: 'area:9', kind: 'area', label: 'Forum', url: 'https://example.org/forum', depth: 0 },
    ] }];
    const html = renderSidebar(blocks, 'sec:42', true);
    assert.equal((html.match(/tabindex="0"/g) || []).length, 1);
    assert.match(html, /aria-current="true"/);
    assert.match(html, /Neues/);
    assert.match(html, /<a class="opal-course-nav-item"/);
    assert.match(html, /data-edit="hide"/);
    assert.match(html, /class="opal-course-grip" data-grip data-id="42"/);
    assert.match(html, /aria-describedby="opal-course-grip-hint"/);
    assert.doesNotMatch(renderSidebar(blocks, 'sec:42', false), /data-grip/);
    assert.match(renderSidebar(blocks, 'sec:42', false), /opal-course-nav-count">2/);
});
test('type anywhere, shortcut exclusion and escaped search emphasis', () => {
    const key = (key, extra = {}) => typeToFind({ key, ctrlKey: false, metaKey: false, altKey: false, editable: false, ...extra });
    assert.equal(key('ü'), 'insert');
    assert.equal(key('/'), 'focus');
    for (const k of [' ', 'Enter', 'ArrowDown']) assert.equal(key(k), null);
    assert.equal(key('k', { ctrlKey: true }), null);
    assert.equal(key('x', { editable: true }), null);
    assert.equal(findPlaceholder('Aerodynamik'), 'In „Aerodynamik“ suchen');
    assert.equal(highlight('a<b', [[1, 2]]), 'a<mark class="opal-course-hit">&lt;</mark>b');
    assert.equal(highlight('cdef', [[1, 4]], 2), '<mark class="opal-course-hit">cd</mark>ef');
});
