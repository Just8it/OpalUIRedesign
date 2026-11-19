import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { locate, find, pairSolutions, latest, recent, trimOpened, loadOpened, recordOpened, itemNumber, categoryCounts } from '../src/course/find/index.ts';

let id = 0;
const entry = (title, fileName = title, extra = {}) => ({ title, fileName, kind: 'file', url: `https://example.org/${++id}`, folderPath: [], firstSeen: 1000, isNew: false, external: false, ...extra });
const section = (title, entries, extra = {}) => ({ title, entries, nodeId: String(++id), kind: 'folder', state: 'loaded', path: [], ...extra });
const topic = [
    section('Flugleistungen', [
        entry('Vorlesung 6: Gleit-/Steig-/Sinkflug', 'LectureNotesGlideCruiseClimb.pdf'),
        entry('Vorlesung 7: Reichweite und Flugdauer', 'Week8Range.pdf'),
        entry('Übung 5: Gleit-/Steig-/Sinkflug', 'Uebung5_Aufgabenstellung.pdf'),
        entry('Übung 6: Reichweite und Höchstflugdauer', 'Uebung6_Aufgabenstellung.pdf'),
        entry('VCS', 'VCS', { url: 'https://videocampus.sachsen.de/watch/abc', kind: 'link' }),
        entry('Skript', 'FlugsimulatorSkript.m', { extension: 'm' }),
    ]),
    section('Einführung', [entry('Vorlesung 1: Einführung', 'Week1_Introduction.pdf'), entry('Übung 1: Kinematik', 'Uebung1_Aufgabenstellung.pdf'), entry('Übung 1: Kinematik - Lösung', 'Uebung1_Loesung.pdf'), entry('MATLAB Funktion: ICAO Standardatmosphäre', 'ICAOStdAtp.m')]),
    section('Prüfung', [entry('Formelblatt', 'Formelsammlung.pdf'), entry('Probeklausur', 'Probeklausur.pdf'), entry('Probeklausur Lösung')]),
];
const folders = [section('Vorlesung', [entry('Organisatorisches.pdf', undefined, { folderPath: ['Kapitel 0 - Organisatorisches'] }), entry('Aero_V02_Potentialtheorie.pdf', undefined, { folderPath: ['Kapitel 2 - Potentialtheorie'] })]), section('Übung', ['Uebung_03_Aufgaben.pdf', 'Uebung_03_Loesung.pdf', 'UE4.pdf', 'UE4_Lsg.pdf'].map(t => entry(t))), section('Praktikum Xfoil', [entry('Material.pdf')]), section('Zusatzmaterial', [entry('Vertiefung.pdf')])];
const lab = [section('Praktikumsunterlagen DM', [entry('Anleitung_Arduino.pdf'), entry('anleitung_Fehlerrechnung.pdf'), entry('How_to_Protokoll_mit_Excel.pdf')]), section('Ordner für Logbücher DM', [entry('punkte_protokolle_logbuecher_Info_MAT1_WS2627.pdf')]), section('Informationen zu Probeklausur und Klausur', [entry('Information.pdf')])];
const all = locate([...topic, ...folders, ...lab]);
test('classifies every topic, folder and lab item', () => {
    assert.deepEqual(all.map(i => i.category), ['lecture', 'lecture', 'exercise', 'exercise', 'video', 'other', 'lecture', 'exercise', 'solution', 'other', 'exam', 'exam', 'solution', 'lecture', 'lecture', 'exercise', 'solution', 'exercise', 'solution', 'exercise', 'other', 'exercise', 'exercise', 'exercise', 'other', 'exam']);
    assert.equal(categoryCounts(all).video, 1);
    assert.equal(locate([section('Hidden', [entry('Übung 5')], { state: 'native' })]).length, 0);
});
test('numbers prefer category labels and ignore dates, semesters, versions and years', () => {
    assert.deepEqual(all.slice(0, 4).map(i => i.number), [6, 7, 5, 6]);
    assert.equal(all[14].number, 2);
    assert.equal(all[17].number, 4);
    for (const title of ['WS2627.pdf', 'SS26.pdf', '2025.pdf', '2026-11-15.pdf', 'Version 1.2.3.pdf']) assert.equal(itemNumber(entry(title)), undefined, title);
    assert.equal(itemNumber(entry('Blatt 03.pdf')), 3);
});
for (const query of ['ü5', 'ue 5', 'übung 5', 'uebung 05']) test(`exercise query ${query}`, () => {
    assert.equal(find(all, query, 'all')[0].entry.title, 'Übung 5: Gleit-/Steig-/Sinkflug');
});

test('compact task and solution numbers ignore module digits and pair within a course', () => {
    const items = locate([section('Übung', [
        entry('aero1_A03.pdf', undefined, { folderPath: ['Aufgaben'] }),
        entry('aero1_L03.pdf', undefined, { folderPath: ['Lösungen'] }),
    ])]);
    assert.deepEqual(items.map(i => i.number), [3, 3]);
    assert.equal(find(items, 'übung 3')[0].entry.title, 'aero1_A03.pdf');
    assert.equal(find(items, 'lösung 3')[0].entry.title, 'aero1_L03.pdf');
    assert.equal(pairSolutions(items)[0].solution.title, 'aero1_L03.pdf');
    for (const title of ['aero1.pdf', 'aero1_A03extra.pdf']) assert.equal(itemNumber(entry(title)), undefined);
});
test('aliases, AND, prefixes, typos, numbers and scope', () => {
    for (const [query, title] of [['lösung 1', 'Übung 1: Kinematik - Lösung'], ['lsg 4', 'UE4_Lsg.pdf'], ['vl 6', 'Vorlesung 6: Gleit-/Steig-/Sinkflug'], ['kapitel 2', 'Aero_V02_Potentialtheorie.pdf'], ['potential', 'Aero_V02_Potentialtheorie.pdf']]) assert.equal(find(all, query, 'all')[0].entry.title, title);
    for (const query of ['reichw', 'reichwiete']) assert.equal(find(all, query, 'all').length, 2);
    assert.equal(find(all, 'übung reichweite', 'all')[0].entry.title, 'Übung 6: Reichweite und Höchstflugdauer');
    assert.equal(find(all, 'übung reichweite', 'all').length, 1);
    assert.ok(find(all, 'probeklausur', 'all').length >= 1);
    assert.equal(find(all, '5', 'all').length, 1);
    assert.equal(find(all, '2025', 'all').length, 0);
    assert.ok(find(all, '', 'exercise').every(i => i.category === 'exercise'));
    assert.equal(find(all, '', 'all').length, 0);
    assert.equal(find(all, 'x', 'all').length, 0);
});
test('highlights use original umlaut indices', () => {
    for (const [title, query, expected] of [['Übung', 'uebung', [0, 5]], ['Lösung', 'loesung', [0, 6]], ['Größe', 'groesse', [0, 5]]]) {
        const hit = find(locate([section('Test', [entry(title)])]), query, 'all')[0];
        assert.deepEqual(hit.titleRanges, [expected]);
    }
});
test('pair only unambiguous exercise and exam solutions', () => {
    const pairs = pairSolutions(all);
    assert.equal(pairs.find(i => i.entry.title === 'Übung 1: Kinematik').solution.title, 'Übung 1: Kinematik - Lösung');
    assert.equal(pairs.find(i => i.entry.title === 'UE4.pdf').solution.title, 'UE4_Lsg.pdf');
    assert.equal(pairs.find(i => i.entry.title === 'Probeklausur').solution.title, 'Probeklausur Lösung');
    const ambiguous = locate([section('Übung', [entry('Übung 1 A'), entry('Übung 1 B'), entry('Übung 1 Lösung')])]);
    assert.equal(pairSolutions(ambiguous).length, 3);
});
test('latest handles first load, modified dates and new flags; recent ignores removed URLs', () => {
    assert.equal(latest(all, 1)[0].number, 7);
    const items = locate([section('Test', [entry('Übung 1', undefined, { modified: 9000 }), entry('Übung 2', undefined, { modified: 5000 }), entry('Übung 3', undefined, { isNew: true })])]);
    assert.deepEqual(latest(items, 3).map(i => i.number), [1, 2, 3]);
    assert.deepEqual(recent(items, { [items[1].entry.url]: 20, [items[0].entry.url]: 10, missing: 30 }, 2).map(i => i.number), [2, 1]);
});
test('history trims oldest entries and works without chrome', async () => {
    const map = trimOpened(Object.fromEntries(Array.from({ length: 305 }, (_, i) => [`url${i}`, i])));
    assert.equal(Object.keys(map).length, 300);
    assert.equal(map.url4, undefined);
    assert.equal(map.url304, 304);
    assert.deepEqual(await loadOpened('test'), {});
    assert.ok((await recordOpened('test', 'url')).url > 0);
});
test('search averages under 5ms for 500 entries', () => {
    const items = locate([section('Übung', Array.from({ length: 500 }, (_, i) => entry(`Übung ${i}: Reichweite und Größe`)))]);
    find(items, 'übung reichwiete', 'all');
    const start = performance.now();
    for (let i = 0; i < 100; i++) find(items, 'übung reichwiete', 'all');
    assert.ok((performance.now() - start) / 100 < 5);
});

test('each query token highlights its first title occurrence only', () => {
    for (const [title, query, expected] of [
        ['Aero_I_Kap_2.4-2.9_2026-11-03_neu', 'kap 2', ['Kap', '2']],
        ['Übung_05_Aufgaben_5', 'ü 5', ['Übung', '05']],
        ['Skript_Skript', 'skript', ['Skript']],
    ]) {
        const hit = find(locate([section('Test', [entry(title)])]), query)[0];
        assert.deepEqual(hit.titleRanges.map(([a, b]) => title.slice(a, b)), expected);
    }
});
