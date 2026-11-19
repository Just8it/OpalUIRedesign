import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createSearchIndex } from '../src/core/search/engine.ts';
import { fixtureSuites } from './fixtures/search/reference.mjs';
const now = Date.UTC(2026, 10, 15);
const node = (id, title, extra = {}) => ({ id, title, url: `https://opal/${id}`, type: 'course', courseId: id, parentId: null, lastVisited: 0, visitCount: 0, ...extra });
function index(nodes) { const i = createSearchIndex(); i.setAll(nodes); return i; }
for (const suite of fixtureSuites) {
    const byId = new Map(suite.rawNodes.map(n => [n.id, n]));
    const nodes = suite.rawNodes.map(n => {
        let root = n;
        while (root.parentId) root = byId.get(root.parentId);
        return node(n.id, n.title, { ...n, courseId: root.id });
    });
    for (const q of suite.benchmarkQueries) test(`${suite.name}: ${q.query}`, () => {
        assert.equal(index(nodes).search(q.query, { now })[0]?.node.id, q.expectedTop, q.reason);
    });
}
test('prefix typing, transposition and academic aliases', () => {
    const i = index([node('m', 'Mathematik'), node('t', 'Technische Mechanik 1'), node('w', 'Woche', { parentId: 't', courseId: 't' }), node('v', 'Vorlesung')]);
    for (const q of ['ma', 'math']) assert.equal(i.search(q)[0].node.id, 'm');
    assert.equal(i.search('tm1 wo')[0].node.id, 'w');
    assert.equal(i.search('vorlesnug')[0].node.id, 'v');
    assert.equal(i.search('vl')[0].node.id, 'v');
});
test('exact sheet numbers outrank date numbers and do not match 20', () => {
    const i = index([node('one', '1. Uebungsblatt (20. bis 24. Oktober 2025)'), node('twenty', '20. Uebungsblatt'), node('two', '02 Uebungsblatt')]);
    for (const q of ['uebung 2', 'uebung 02']) assert.equal(i.search(q)[0].node.id, 'two');
    assert.equal(i.search('uebung 20')[0].node.id, 'twenty');
});
test('semester constraints, year ranges and current semester preference', () => {
    const i = index([node('old', 'Mathematik', { semester: 'Wintersemester 2025/26' }), node('new', 'Mathematik', { semester: 'Wintersemester 2026/27' }), node('summer', 'Mathematik', { semester: 'Sommersemester 2026' })]);
    assert.equal(i.search('mathematik', { now })[0].node.id, 'new');
    for (const q of ['2025', '2025/26', 'ws25', 'ws 2025', 'wintersemester 2025/26']) {
        const hits = i.search(q, { now });
        assert.equal(hits[0].node.id, 'old', q);
        assert.ok(hits[0].explanation.every(s => !s.includes('missing exact number')));
    }
    assert.equal(i.search('ss26', { now })[0].node.id, 'summer');
    assert.equal(i.search('sose', { now })[0].node.id, 'summer');
    assert.equal(i.search('wise', { now })[0].node.id, 'new');
});
test('filters, weak metadata, URL exclusion, dedupe and empty queries', () => {
    const i = index([node('c', 'Analysis'), node('f', 'Analysis.pdf', { type: 'file', author: 'Euler', description: 'Integralrechnung' }), node('duplicate', 'Analysis.pdf', { type: 'file', url: 'https://opal/f/?version=2' })]);
    assert.equal(i.search('/c analysis')[0].node.id, 'c');
    assert.ok(i.search('/f analysis').every(r => r.node.type === 'file'));
    for (const q of ['pdf', 'analysis ext:pdf']) assert.equal(i.search(q).length, 1);
    assert.equal(i.search('euler')[0].node.id, 'f');
    assert.equal(i.search('integralrechnung')[0].node.id, 'f');
    assert.deepEqual(i.search('https'), []);
    assert.deepEqual(i.search(''), []);
});
test('context cannot beat better text or full coverage; indexing adds no recency', () => {
    const i = index([node('exact', 'Mathematik Algebra'), node('partial', 'Mathematik', { courseId: 'active', type: 'file', visitCount: 100000, lastVisited: now }), node('prefix', 'Mathematiker Algebra', { courseId: 'active', visitCount: 100000, lastVisited: now })]);
    assert.equal(i.search('mathematik algebra', { now, activeCourseId: 'active' })[0].node.id, 'exact');
    const j = index([node('a', 'Mathematik', { lastVisited: now, visitCount: 0 }), node('b', 'Mathematik')]);
    assert.equal(j.search('mathematik', { now })[0].score, j.search('mathematik', { now })[1].score);
    assert.deepEqual(j.recents(), []);
});
test('recents combine actual opens and decay', () => {
    const i = index([node('fresh', 'Fresh', { lastVisited: now, visitCount: 4 }), node('old', 'Old', { lastVisited: now - 100 * 86400000, visitCount: 20 }), node('indexed', 'Indexed', { indexedAt: now })]);
    assert.deepEqual(i.recents(8, now).map(r => r.node.id), ['fresh', 'old']);
    assert.match(i.recents(1, now)[0].explanation[0], /frecency/);
});
test('deep paths, broken ancestry, incremental rename, removal and cycles', () => {
    const i = index([node('c', 'Technische Mechanik 1'), node('f', 'Uebungen', { parentId: 'c', courseId: 'c' }), node('w', 'Woche 03', { parentId: 'f', courseId: 'c' }), node('leaf', 'Loesung.pdf', { type: 'file', parentId: 'w', courseId: 'c' }), node('broken', 'Aufgabe', { parentId: 'missing', courseId: 'c' })]);
    assert.equal(i.search('tm1 uebungen woche 3 loesung')[0].node.id, 'leaf');
    assert.deepEqual(i.search('aufgabe')[0].path, ['Technische Mechanik 1']);
    i.upsert({ ...i.get('w'), title: 'Neue Woche 03' });
    assert.ok(i.search('neue loesung')[0].path.includes('Neue Woche 03'));
    i.remove('w');
    assert.deepEqual(i.search('loesung')[0].path, ['Technische Mechanik 1']);
    i.upsert({ ...i.get('f'), parentId: 'leaf' });
    i.upsert({ ...i.get('leaf'), parentId: 'f' });
    assert.ok(i.search('loesung').length);
    i.upsert(node('self', 'Self', { parentId: 'self' }));
    assert.deepEqual(i.search('self')[0].path, []);
    i.clear(); assert.equal(i.size(), 0);
});
test('10,000 nodes search and upsert performance', () => {
    const i = index(Array.from({ length: 10000 }, (_, n) => node(`n${n}`, `Mathematik Vorlesung Kapitel ${n}`, { type: 'file' })));
    for (let n = 0; n < 5; n++) i.search('math vorlesung kap');
    let start = performance.now();
    for (let n = 0; n < 20; n++) i.search('math vorlesung kap');
    const searchMs = (performance.now() - start) / 20;
    start = performance.now();
    for (let n = 0; n < 100; n++) i.upsert(node(`n${n}`, `New title ${n}`));
    const upsertMs = (performance.now() - start) / 100;
    console.log(`Search average: ${searchMs.toFixed(3)} ms; upsert average: ${upsertMs.toFixed(3)} ms`);
    assert.ok(searchMs < 30, `search ${searchMs} ms`);
    assert.ok(upsertMs < 2, `upsert ${upsertMs} ms`);
});
