import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchIndex } from '../src/core/search/engine.ts';
import { enrichNode } from '../src/core/search/enrich.ts';
import { parseQuery, parseIntent } from '../src/core/search/query.ts';
const node = (id, title, parentId = null, courseId = 'aero', type = 'file') => ({ id, title, parentId, courseId, type, url: `https://opal/${id}`, visitCount: 0, lastVisited: 0 });
const nodes = [node('aero', 'Aerodynamik I', null, 'aero', 'course'), node('tm2', 'Technische Mechanik 2', null, 'tm2', 'course'),
    node('ex', 'Übung', 'aero', 'aero', 'folder'), node('lectures', 'Vorlesung', 'aero', 'aero', 'folder'),
    node('exam', 'Altklausur 2023.pdf', 'aero'), node('video', 'Aufzeichnung 03.mp4', 'aero'),
    node('groups', 'Uebungsgruppen', 'tm2', 'tm2', 'action'), node('tm-ex3', 'Uebung_03.pdf', 'tm2', 'tm2')];
for (let n = 1; n <= 12; n++) nodes.push(node(`ex${n}`, `Übung_${String(n).padStart(2, '0')}.pdf`, 'ex'));
for (let n = 1; n <= 10; n++) nodes.push(node(`sol${n}`, `Loesung_${String(n).padStart(2, '0')}.pdf`, 'ex'));
for (const n of ['0', '1', '2', '2.1', '2.10']) {
    nodes.push(node(`vl${n}`, `Aero_I_Kap_${n}.pdf`, 'lectures'));
    nodes.push(node(`notes${n}`, `Aero_I_Kap_${n}_Notizseiten.pdf`, 'lectures'));
}
nodes.push(node('ex13', 'Übung_13.pdf', 'ex'), node('ex30', 'Übung_30.pdf', 'ex'));
const index = () => { const i = createSearchIndex(); i.setAll(nodes); return i; };
for (const [query, expected] of [['aero Übung 3', 'ex3'], ['ü3', 'ex3'], ['uebung 03', 'ex3'], ['lösung 3', 'sol3'], ['aero vl kap 2.10', 'notes2.10'], ['kap 2.10 notizseiten', 'notes2.10'], ['altklausur', 'exam'], ['video', 'video']]) {
    test(`material intent: ${query}`, () => assert.equal(index().search(query, { activeCourseId: 'aero' })[0]?.node.id, expected));
}
test('category-only queries prefer exercises and exact number penalizes mismatches', () => {
    const i = index();
    assert.ok(i.search('Übung').every(r => r.node.category === 'exercise'));
    const hits = i.search('Übung 3', { limit: 100, activeCourseId: 'aero' });
    assert.equal(hits[0].node.id, 'ex3');
    assert.ok(hits[0].explanation.some(s => s.includes('item number 3 match')));
    const j = createSearchIndex(); j.setAll(nodes.filter(n => ['ex13', 'ex30'].includes(n.id)));
    assert.ok(j.search('Übung 3').every(r => r.explanation.some(s => s.includes('item number 3 mismatch'))));
});
test('intent preserves course aliases and hierarchical numbers', () => {
    assert.deepEqual(parseIntent('tm2 ü03'), { category: 'exercise', number: '3', rest: ['tm2'] });
    assert.equal(parseQuery('aero vl kap 02.10').intent.number, '2.10');
    assert.equal(parseIntent('3.').number, '3');
});
test('enrichment is pure, respects supplied metadata, and uses nearest folder', () => {
    const n = node('neutral', 'Material.pdf');
    const enriched = enrichNode(n, { ancestorTitles: ['Vorlesung', 'Übung 03'] });
    assert.equal(enriched.category, 'exercise'); assert.equal(enriched.itemNumber, '3');
    assert.equal(n.category, undefined);
    assert.equal(enrichNode({ ...n, category: 'exam', itemNumber: '02.10' }).itemNumber, '2.10');
    assert.equal(enrichNode(node('v', 'V05.pdf')).category, 'lecture');
    assert.equal(enrichNode(node('date', 'Übung 21 (vom 5.1).pdf')).itemNumber, '21');
});
test('ancestor upserts refresh inferred categories and numbers', () => {
    const i = createSearchIndex(); i.setAll([node('folder', 'Übung 03'), node('leaf', 'Material.pdf', 'folder')]);
    assert.equal(i.search('ü3')[0].node.id, 'folder');
    i.upsert({ ...i.get('folder'), title: 'Lösung 04' });
    assert.equal(i.search('lösung 4').find(r => r.node.id === 'leaf').node.category, 'solution');
});
test('plain fuzzy queries retain relevance', () => { const i = createSearchIndex(); i.setAll([nodes[0], nodes[1]]); assert.equal(i.search('aerodynmaik')[0].node.id, 'aero'); });

test('exported Aerodynamik filename shape resolves A03 and L03 in an existing index', () => {
    const i = createSearchIndex();
    i.setAll([
        node('aero', 'Aerodynamik', null, 'aero', 'course'),
        node('exercises', 'Übung', 'aero', 'aero', 'folder'),
        node('tasks', 'Aufgaben', 'exercises', 'aero', 'folder'),
        node('solutions', 'Lösungen', 'exercises', 'aero', 'folder'),
        // Persisted entries have categories, but no itemNumber.
        ...[1, 2, 3, 13, 30].flatMap(n => [
            { ...node(`a${n}`, `aero1_A${String(n).padStart(2, '0')}.pdf`, 'tasks'), category: 'exercise', source: 'user' },
            { ...node(`l${n}`, `aero1_L${String(n).padStart(2, '0')}.pdf`, 'solutions'), category: 'solution', source: 'user' },
        ]),
        node('foreign', 'Übung_03.pdf', 'tm2', 'tm2'),
        node('tm2', 'Technische Mechanik 2', null, 'tm2', 'course'),
        { ...node('chapter', 'Aero_I_Kap_3.pdf', 'aero'), category: 'lecture' },
    ]);
    for (const q of ['aerodynamik übung 3', 'aero übung 03', '/f aerodynamik uebung 3', 'aerodynamik aufgabe 3']) {
        const hit = i.search(q, { excludeCatalog: true })[0];
        assert.equal(hit?.node.id, 'a3', q);
        assert.equal(hit.node.itemNumber, '3');
        assert.ok(hit.explanation.some(s => s.includes('item number 3 match')));
        assert.ok(hit.score > 0);
    }
    for (const q of ['aerodynamik lösung 3', 'aero loesung 03']) assert.equal(i.search(q)[0]?.node.id, 'l3', q);
    assert.equal(i.search('aerodynamik übung 13')[0]?.node.id, 'a13');
});
