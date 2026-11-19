import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { locate } from '../src/course/find/index.ts';
import { buildUnits, buildSeries, buildHome, defaultHome, normaliseHome, normaliseProgress, toggleDone, setPointer, togglePin, addable, moveBlock, placeBlock, updateBlock, addBlock, removeBlock, blockSelectionId, loadHome, saveHome, loadProgress, saveProgress } from '../src/course/home/index.ts';

const file = (title, folderPath = [], extra = {}) => ({ kind: 'file', title, url: `https://opal.test/${folderPath.join('/')}/${title}`, extension: 'pdf', folderPath, external: false, firstSeen: 1, isNew: false, ...extra });
const section = (nodeId, title, entries) => ({ nodeId, title, entries, kind: 'folder', rawType: 'bc', path: [], url: `https://opal.test/section/${nodeId}`, state: 'loaded' });
const snapshot = sections => ({ courseId: '42', title: 'Testkurs', url: 'https://opal.test', tree: { id: 'root', title: 'Testkurs', kind: 'root', rawType: '', url: '', children: [] }, sections, announcements: [], previousVisit: 0, fetchedAt: 100 });
function folderCourse() {
    return snapshot([
        section('vl', 'Vorlesung', [file('Aero_I_Kap_2.10_plus.pdf', ['Kapitel 2 - Potentialtheorie']), file('Aero_I_Kap_2.4-2.9_2026-11-03_neu_Notizseiten.pdf', ['Kapitel 2 - Potentialtheorie']), file('Aero_I_Kap_2.pdf', ['Kapitel 2 - Potentialtheorie']), file('info.pdf', ['Kapitel 0 - Organisatorisches']), file('einleitung.pdf', ['Kapitel 1 - Einleitung und Grundlagen']), file('termin.pdf')]),
        section('ue', 'Übung', [file('aero1_A03.pdf', ['Aufgaben']), file('aero1_A01.pdf', ['Aufgaben']), file('aero1_A02.pdf', ['Aufgaben']), file('aero1_L01.pdf', ['Lösungen']), file('aero1_L02.pdf', ['Lösungen']), file('aero1_A01.pdf', ['Aufgaben', 'Zusatzaufgaben']), file('aero1_L01.pdf', ['Lösungen', 'Zusatzaufgaben'])]),
        section('extra', 'Zusatzmaterial', [file('Hinweise.pdf'), file('Literatur.pdf'), file('Kontakt.pdf')]),
        section('exam', 'Prüfung', [file('Klausur.pdf')]),
    ]);
}
function topicCourse() {
    return snapshot([1, 2, 3].map(n => section(`topic${n}`, `Thema ${n}`, [file(`Vorlesung ${n}: Gleit-/Steig-/Sinkflug`, [], { fileName: `LectureNotes${n}.pdf` }), file(`Übung ${n}: Rechnen`, [], { fileName: `Task${n}.pdf` }), file(`Übung ${n} - Lösung`, [], { fileName: `Answer${n}.pdf` })])));
}
function labCourse() {
    return snapshot([section('dm', 'Praktikumsunterlagen DM', [file('Versuch 2.pdf'), file('Versuch 1.pdf')]), section('mat', 'Materialien für MAT1', [file('Blatt 2.pdf', ['Rechenübungen']), file('Blatt 1.pdf', ['Rechenübungen']), file('Skript.pdf', ['Vorlesungsunterlagen'])])]);
}
const emptyProgress = () => normaliseProgress(null);
const seriesConfig = (source = { type: 'category', category: 'exercise' }) => ({ id: 'series', title: 'Übung', source, color: 1, hidden: false, series: true });
const home = (s, config = defaultHome(s, locate(s.sections)), progress = emptyProgress(), editing = false) => buildHome({ snapshot: s, located: locate(s.sections), config, progress, opened: {}, editing });

test('chapter folders are whole units, naturally ordered with main file first', () => {
    const s = folderCourse(), units = buildUnits({ type: 'category', category: 'lecture' }, locate(s.sections));
    assert.deepEqual(units.map(u => u.number), [0, 1, 2, undefined]);
    assert.equal(units[2].title, 'Kapitel 2 - Potentialtheorie');
    assert.equal(units[2].entries.length, 3);
    assert.equal(units[2].entries[0].title, 'Aero_I_Kap_2.pdf');
    assert.equal(units[2].location, 'Vorlesung');
});
test('transparent containers pair numbered sheets across sibling folders; extras stay separate', () => {
    const s = folderCourse(), units = buildUnits({ type: 'category', category: 'exercise' }, locate(s.sections));
    assert.deepEqual(units.map(u => u.title), ['Übung 1', 'Zusatzaufgabe 1', 'Übung 2', 'Übung 3']);
    assert.equal(units[0].solutions[0].title, 'aero1_L01.pdf');
    assert.deepEqual(units[1].solutions[0].folderPath, ['Lösungen', 'Zusatzaufgaben']);
    assert.equal(units[0].location, 'Übung › Aufgaben');
    assert.equal(units[1].location, 'Übung › Aufgaben › Zusatzaufgaben');
    assert.notEqual(units[0].key, units[1].key);
});
test('topic labels override file names and category units retain section identity', () => {
    const s = topicCourse(), located = locate(s.sections);
    const lectures = buildUnits({ type: 'category', category: 'lecture' }, located);
    assert.equal(lectures[0].title, 'Vorlesung 1: Gleit-/Steig-/Sinkflug');
    const exercises = buildUnits({ type: 'category', category: 'exercise' }, located);
    assert.equal(exercises.length, 3);
    assert.equal(exercises[0].solutions.length, 1);
    assert.match(exercises[1].key, /^topic2\|n\|exercise\|2$/);
});
test('mixed root files and deeper topic folders coexist without losing entries', () => {
    const s = snapshot([section('s', 'Material', [file('Blatt 2.pdf'), file('Anhang.pdf', ['Thema', 'Details']), file('Blatt 1.pdf'), file('Hinweis.pdf')])]);
    const units = buildUnits({ type: 'sections', sectionIds: ['s'] }, locate(s.sections));
    assert.equal(units.length, 4);
    assert.deepEqual(units.map(u => u.title), ['Übung 2', 'Thema', 'Übung 1', 'Hinweis.pdf']);
    assert.equal(units[1].entries[0].title, 'Anhang.pdf');
});
test('60 percent number threshold sorts numbered units then page-ordered unnumbered units', () => {
    const s = snapshot([section('s', 'Material', [file('Blatt 3.pdf'), file('Hinweis.pdf'), file('Blatt 1.pdf'), file('Blatt 2.pdf'), file('Kontakt.pdf')])]);
    assert.deepEqual(buildUnits({ type: 'sections', sectionIds: ['s'] }, locate(s.sections)).map(u => u.number), [1, 2, 3, undefined, undefined]);
});
test('folder source treats its own files as roots and child topics as whole units', () => {
    const s = snapshot([section('s', 'Übung', [file('Blatt 1.pdf', ['Semester']), file('extra.pdf', ['Semester', 'Thema']), file('Blatt 9.pdf', ['Andere'])])]);
    const units = buildUnits({ type: 'folder', sectionId: 's', folderPath: ['Semester'] }, locate(s.sections));
    assert.equal(units.length, 2);
    assert.equal(units[0].location, 'Übung › Semester');
    assert.equal(units[1].title, 'Thema');
});
test('keys survive reloads with added files; hasNew includes solutions and deep files', () => {
    const s = folderCourse(), source = { type: 'category', category: 'exercise' };
    const before = buildUnits(source, locate(s.sections));
    s.sections[1].entries.push(file('aero1_A04.pdf', ['Aufgaben']));
    s.sections[1].entries[3].isNew = true;
    const after = buildUnits(source, locate(s.sections));
    for (const u of before) assert(after.some(v => v.key === u.key));
    assert.equal(after[0].hasNew, true);
    s.sections[0].entries.push(file('deep.pdf', ['Kapitel 2 - Potentialtheorie', 'Mehr'], { isNew: true }));
    assert.equal(buildUnits({ type: 'category', category: 'lecture' }, locate(s.sections))[2].hasNew, true);
});
test('series starts at first unfinished unit, ignores timestamps, and exposes next three', () => {
    const s = folderCourse(), config = seriesConfig(), located = locate(s.sections);
    let result = buildSeries(config, located, emptyProgress());
    assert.equal(result.current, result.units[0]);
    assert.equal(result.next.length, 3);
    assert.equal(result.progressText, '4 Einheiten');
    const p = toggleDone(emptyProgress(), result.current.key, 0);
    result = buildSeries(config, located, p);
    assert.equal(result.units[0].state, 'done');
    assert.equal(result.units[0].doneAt, 0);
    assert.equal(result.current, result.units[1]);
    assert.equal(result.progressText, '1 von 4 erledigt');
});
test('manual pointer makes earlier unfinished units past and skips done pointer units', () => {
    const s = folderCourse(), config = seriesConfig(), located = locate(s.sections);
    const units = buildUnits(config.source, located);
    let p = setPointer(emptyProgress(), config.id, units[2].key);
    let result = buildSeries(config, located, p);
    assert.deepEqual(result.units.map(u => u.state), ['past', 'past', 'current', 'upcoming']);
    assert.deepEqual(result.earlier.map(u => u.key), [units[1].key, units[0].key]);
    p = { ...p, done: { [units[2].key]: 10 } };
    result = buildSeries(config, located, p);
    assert.equal(result.current.key, units[3].key);
    p.pointer.series = units[3].key; p.done[units[3].key] = 20;
    assert.equal(buildSeries(config, located, p).current, undefined);
    p.pointer.series = 'vanished';
    assert.equal(buildSeries(config, located, p).current.key, units[0].key);
});
test('all done has no current or next and reports completion', () => {
    const s = folderCourse(), config = seriesConfig(), located = locate(s.sections);
    const done = Object.fromEntries(buildUnits(config.source, located).map(u => [u.key, 100]));
    const result = buildSeries(config, located, { ...emptyProgress(), done });
    assert.equal(result.current, undefined); assert.deepEqual(result.next, []);
    assert.equal(result.progressText, 'Alles erledigt'); assert.equal(result.earlier.length, 4);
});
test('tick clears all matching manual pointers, untick preserves pointers; inputs immutable', () => {
    const p = { done: {}, pointer: { a: 'u', b: 'u', c: 'v' }, pinned: [] };
    const ticked = toggleDone(p, 'u', 10);
    assert.deepEqual(ticked.pointer, { c: 'v' }); assert.deepEqual(p.done, {});
    const unticked = toggleDone({ ...ticked, pointer: { a: 'u' } }, 'u', 20);
    assert.deepEqual(unticked.pointer, { a: 'u' }); assert.deepEqual(unticked.done, {});
    assert.deepEqual(setPointer(unticked, 'a', null).pointer, {});
});
test('default config for folder, topic and lab fixtures uses recognised categories', () => {
    for (const s of [folderCourse(), topicCourse(), labCourse()]) {
        const c = defaultHome(s, locate(s.sections));
        assert(c.blocks.some(b => b.id === 'cat:lecture' && b.series && b.color === 0));
        assert(c.blocks.some(b => b.id === 'cat:exercise' && b.series && b.color === 1));
        assert.equal(c.blocks.at(-1).id, 'pinned');
    }
    const s = folderCourse(), c = defaultHome(s, locate(s.sections));
    assert.deepEqual(c.blocks.map(b => b.id), ['cat:lecture', 'cat:exercise', 'cat:exam', 'sec:extra', 'pinned']);
    assert.equal(c.blocks[2].series, false); assert.equal(c.blocks[3].color, 5);
});
test('normalisation preserves user order and titles, retains empty builtins and drops removed sources', () => {
    const s = folderCourse(), located = locate(s.sections);
    const c = defaultHome(s, located);
    c.blocks.reverse(); c.blocks[0].title = 'Meine Favoriten';
    c.blocks.push({ ...seriesConfig({ type: 'sections', sectionIds: ['gone'] }), id: 'sec:gone' });
    s.sections = s.sections.filter(s => s.nodeId !== 'exam');
    const result = normaliseHome(c, s, locate(s.sections));
    assert.equal(result.blocks[0].title, 'Meine Favoriten');
    assert(result.blocks.some(b => b.id === 'cat:exam'));
    assert(!result.blocks.some(b => b.id === 'sec:gone'));
    assert(!normaliseHome({ version: 1, blocks: [] }, s, locate(s.sections)).blocks.some(b => b.id === 'sec:extra'));
    assert.deepEqual(normaliseHome(null, s, locate(s.sections)), defaultHome(s, locate(s.sections)));
});
test('normalisation appends newly possible builtins and rejects malformed blocks', () => {
    const s = topicCourse(); s.announcements.push({ title: 'Hallo', text: '', url: '', date: 5 });
    const result = normaliseHome({ blocks: [null, { id: 'bad', source: { type: 'folder', folderPath: 'bad' } }] }, s, locate(s.sections));
    assert.deepEqual(result.blocks.map(b => b.id), ['cat:lecture', 'cat:exercise', 'pinned', 'ann']);
});
test('addable includes sections and top-level folders with two entries, excludes exact sources', () => {
    const s = folderCourse(), located = locate(s.sections);
    let c = defaultHome(s, located);
    let options = addable(s, located, c);
    assert(options.some(o => o.id === 'sec:vl'));
    assert(!options.some(o => o.id === 'sec:extra'));
    assert(options.some(o => o.title === 'Aufgaben' && o.count === 4));
    assert(!options.some(o => o.title === 'Kapitel 0 - Organisatorisches'));
    const option = options.find(o => o.title === 'Aufgaben');
    c = addBlock(c, option.source, option.title, located);
    options = addable(s, located, c);
    assert(!options.some(o => o.id === option.id));
    assert.equal(c.blocks.at(-1).series, true);
});
test('pinned entries preserve pin order and vanished URLs stay in progress', () => {
    const s = folderCourse(), a = s.sections[0].entries[0], b = s.sections[0].entries[1];
    const p = { ...emptyProgress(), pinned: [b.url, 'gone', a.url] };
    const block = home(s, undefined, p).blocks.find(b => b.config.id === 'pinned');
    assert.deepEqual(block.entries, [b, a]); assert.equal(block.total, 2); assert.equal(p.pinned.length, 3);
    assert.deepEqual(togglePin(togglePin(emptyProgress(), a.url), b.url).pinned, [b.url, a.url]);
    assert.deepEqual(togglePin(p, a.url).pinned, [b.url, 'gone']);
});
test('announcements newest first, first visit unread zero, later visits compare dates', () => {
    const s = folderCourse(); s.announcements = [{ title: 'old', date: 20 }, { title: 'undated' }, { title: 'new', date: 50 }].map(a => ({ ...a, text: '', url: '' }));
    let block = home(s).blocks.find(b => b.kind === 'announcements');
    assert.deepEqual(block.items.map(a => a.title), ['new', 'old', 'undated']); assert.equal(block.unread, 0);
    s.previousVisit = 30;
    block = home(s).blocks.find(b => b.kind === 'announcements'); assert.equal(block.unread, 1);
});
test('list blocks keep page order; empty blocks appear in editing; hidden configs separate', () => {
    const s = folderCourse(), c = defaultHome(s, locate(s.sections));
    const exam = home(s, c).blocks.find(b => b.config.id === 'cat:exam');
    assert.equal(exam.kind, 'list'); assert.deepEqual(exam.entries, s.sections[3].entries);
    assert(!home(s, c).blocks.some(b => b.config.id === 'pinned'));
    assert(home(s, c, emptyProgress(), true).blocks.some(b => b.config.id === 'pinned'));
    const hidden = { ...c, blocks: c.blocks.map(b => ({ ...b, hidden: true })) };
    assert.equal(home(s, hidden, emptyProgress(), true).empty, true);
    assert.equal(home(s, hidden).hidden.length, c.blocks.length);
});
test('browse selection ids cover every source, including multi-section fallback', () => {
    const cases = [[{ type: 'category', category: 'lecture' }, 'cat:lecture'], [{ type: 'sections', sectionIds: ['a'] }, 'sec:a'], [{ type: 'sections', sectionIds: ['a', 'b'] }, 'all'], [{ type: 'folder', sectionId: 'a', folderPath: ['x'] }, 'sec:a'], [{ type: 'pinned' }, 'all'], [{ type: 'announcements' }, 'ann']];
    for (const [source, expected] of cases) assert.equal(blockSelectionId(seriesConfig(source)), expected);
});
test('move, update, add, remove are immutable and builtins hide instead of disappearing', () => {
    const s = folderCourse(), c = defaultHome(s, locate(s.sections));
    assert.equal(moveBlock(c, 'cat:exercise', -1).blocks[0].id, 'cat:exercise');
    assert.equal(moveBlock(c, 'cat:lecture', -1).blocks[0].id, 'cat:lecture');
    assert.equal(updateBlock(c, 'cat:lecture', { title: 'Meine Vorlesung', color: 7 }).blocks[0].title, 'Meine Vorlesung');
    assert.equal(c.blocks[0].title, 'Vorlesung');
    assert(removeBlock(c, 'cat:lecture').blocks[0].hidden);
    const added = addBlock(c, { type: 'sections', sectionIds: ['extra'] }, 'Eigener Block');
    assert.equal(added.blocks.at(-1).id, 'custom:1'); assert.equal(added.blocks.at(-1).series, false);
    assert.equal(removeBlock(added, 'custom:1').blocks.length, c.blocks.length);
});
test('progress validation caps newest done keys and pins and discards invalid values', () => {
    const done = Object.fromEntries(Array.from({ length: 2100 }, (_, n) => [`u${n}`, n]));
    done.invalid = NaN;
    const p = normaliseProgress({ done, pointer: { a: 'u', b: 42 }, pinned: Array.from({ length: 220 }, (_, n) => `url${n}`) });
    assert.equal(Object.keys(p.done).length, 2000); assert.equal(p.done.u0, undefined); assert.equal(p.done.u2099, 2099);
    assert.equal(p.pinned.length, 200); assert.deepEqual(p.pointer, { a: 'u' });
});
test('storage guards absent chrome, normalises reads and enforces caps on writes', async () => {
    const original = globalThis.chrome;
    try {
        delete globalThis.chrome;
        assert.deepEqual(await loadProgress('42'), emptyProgress());
        assert.deepEqual(await loadHome('42'), { version: 1, blocks: [] });
        await saveProgress('42', emptyProgress());
        const data = {};
        globalThis.chrome = { storage: { local: { get: async key => ({ [key]: data[key] }), set: async patch => Object.assign(data, patch) } } };
        const p = { done: Object.fromEntries(Array.from({ length: 2001 }, (_, n) => [`u${n}`, n])), pointer: {}, pinned: Array.from({ length: 201 }, (_, n) => `url${n}`) };
        await saveProgress('42', p);
        assert.equal(Object.keys(data.opalCourseProgress_42.done).length, 2000);
        assert.equal((await loadProgress('42')).pinned.length, 200);
        const s = folderCourse(), c = defaultHome(s, locate(s.sections));
        await saveHome('42', c); assert.deepEqual(await loadHome('42', s, locate(s.sections)), c);
        data.opalCourseHome_42 = { blocks: [null] };
        assert.deepEqual((await loadHome('42')).blocks, []);
    } finally { if (original === undefined) delete globalThis.chrome; else globalThis.chrome = original; }
});
test('600-entry home model builds in less than 10 ms average', t => {
    const s = snapshot([section('s', 'Übung', Array.from({ length: 300 }, (_, n) => [file(`aero1_A${n + 1}.pdf`, ['Aufgaben']), file(`aero1_L${n + 1}.pdf`, ['Lösungen'])]).flat())]);
    const located = locate(s.sections), config = defaultHome(s, located);
    const args = { snapshot: s, located, config, progress: emptyProgress(), opened: {}, editing: false };
    for (let n = 0; n < 10; n++) buildHome(args);
    const start = performance.now();
    for (let n = 0; n < 100; n++) buildHome(args);
    const average = (performance.now() - start) / 100;
    t.diagnostic(`Average buildHome: ${average.toFixed(2)} ms`);
    assert(average < 10, `Average ${average.toFixed(2)} ms`);
});
test('drag placement and arrow steps move among visible blocks only', () => {
    const b = (id, hidden = false) => ({ id, title: id, color: 0, hidden, series: false, source: { type: 'pinned' } });
    const c = { version: 1, blocks: [b('a'), b('h', true), b('b'), b('c')] };
    // Visible order a, b, c; dropping c at the top keeps the hidden block in its slot.
    assert.deepEqual(placeBlock(c, 'c', 0).blocks.map(x => x.id), ['c', 'h', 'a', 'b']);
    assert.deepEqual(placeBlock(c, 'a', 2).blocks.map(x => x.id), ['b', 'h', 'c', 'a']);
    assert.equal(placeBlock(c, 'h', 0), c);
    // One arrow press always passes one visible block.
    assert.deepEqual(moveBlock(c, 'a', 1).blocks.map(x => x.id), ['b', 'h', 'a', 'c']);
});
