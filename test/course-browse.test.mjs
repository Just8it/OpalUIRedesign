import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildNav, buildList, splitName, formatSize, formatModified, defaultLayout, normaliseLayout, normalisePrefs, moveSection, placeSections } from '../src/course/browse/index.ts';
import { locate } from '../src/course/find/index.ts';

const now = Date.now();
const prefs = () => ({ order: [], hidden: [], collapsed: [] });
const file = (title, extra = {}) => ({ title, kind: 'file', url: `https://opal.test/${title}`, extension: 'pdf', folderPath: [], external: false, firstSeen: now - 30 * 86400000, isNew: false, ...extra });
const section = (nodeId, title, entries = [], extra = {}) => ({ nodeId, title, entries, kind: 'folder', rawType: 'bc', path: [], url: `https://opal.test/node/${nodeId}`, state: 'loaded', ...extra });
const node = (id, title, children = [], kind = 'structure') => ({ id, title, children, kind, rawType: 'st', url: `https://opal.test/node/${id}` });
function fixture() {
    const sections = [
        section('f', 'Dateien', [file('Kapitel 10.pdf'), file('Kapitel 2.pdf'), file('Aero_I_Kap_0_2026-10-12_Notizseiten.pdf', { folderPath: ['Aero'] }), file('Aero_I_Kap_0_2026-10-12.pdf', { folderPath: ['Aero'] }), file('Neu.pdf', { isNew: true, sizeText: '266,9KB', modified: now }), file('Alt.pdf', { sizeText: '1,1MB', modified: now - 20 * 86400000 })]),
        section('t', 'Themen', [file('Übung 5.pdf'), file('Lösung Übung 5.pdf'), file('Einführung', { fileName: 'intro_2026.pdf' }), file('Video', { kind: 'video', extension: undefined }), file('Webseite', { kind: 'link', extension: undefined })], { kind: 'page' }),
        section('a', 'Versuch A', [file('Messung A.pdf')], { path: ['Praktikum', 'Dehnungsmessung'] }),
        section('b', 'Versuch B', [file('Messung B.pdf')], { path: ['Praktikum', 'Dehnungsmessung'] }),
        section('c', 'Versuch C', [file('Messung C.pdf')], { path: ['Praktikum', 'Dehnungsmessung'] }),
        section('single', 'Einzelsektion', [file('Einzel.pdf')], { path: ['Einzelgruppe'] }),
        section('empty', 'Leseseite', [], { kind: 'page', state: 'empty' }),
        section('hand', 'Abgabe', [], { canUpload: true }),
        section('wait', 'Wird geladen', [], { state: 'pending' }),
        section('bad', 'Fehler', [], { state: 'error', error: 'Nicht erreichbar' }),
        section('partial', 'Teilweise', [file('Teil.pdf')], { incomplete: true, error: 'Weitere Dateien fehlen' }),
        section('forum', 'Forum', [], { kind: 'interactive', state: 'native' }),
        section('news', 'Mitteilungen', [], { kind: 'announcements', state: 'native' }),
    ];
    return { courseId: '1', title: 'Kurs', url: 'https://opal.test/course/1', sections,
        tree: node('root', 'Kurs', [node('outer', 'Praktikum', [node('inner', 'Dehnungsmessung', sections.slice(2, 5).map(s => node(s.nodeId, s.title, [], 'folder')))]), node('only', 'Einzelgruppe', [node('single', 'Einzelsektion', [], 'folder')])], 'root'),
        announcements: [{ title: 'Nachricht', date: now, text: 'Hallo', url: 'https://opal.test/news' }], fetchedAt: now, previousVisit: now - 86400000 };
}
function args(snapshot = fixture(), extra = {}) { return { snapshot, located: locate(snapshot.sections), opened: {}, prefs: prefs(), selected: 'all', query: '', sort: { key: 'order', dir: 'asc' }, ...extra }; }
const rows = model => model.groups.flatMap(g => g.folders.flatMap(f => f.entries));
const nav = (a, editing = false) => buildNav(a.snapshot, a.located, a.opened, a.prefs, editing);

test('nav leads with the overview and what a student studies, then activity, then the course menu', () => {
    const a = args(); a.opened[a.located[0].entry.url] = now;
    const blocks = nav(a);
    assert.deepEqual(blocks.map(b => b.key), ['study', 'activity', 'content', 'areas']);
    // Übersicht first, then the kinds in plural; solutions travel with Übungen, so no "Lösungen" item.
    assert.deepEqual(blocks[0].items.map(i => i.id), ['home', 'cat:lecture', 'cat:exercise', 'cat:video', 'upload']);
    assert.deepEqual(blocks[0].items.slice(1, 4).map(i => i.label), ['Vorlesungen', 'Übungen', 'Videos']);
    const kinds = a.located.map(i => i.category);
    assert.equal(blocks[0].items.find(i => i.id === 'cat:exercise').count, kinds.filter(c => c === 'exercise' || c === 'solution').length);
    assert.equal(blocks[0].items.find(i => i.id === 'upload').count, undefined);
    assert.ok(!blocks[0].items.some(i => i.id === 'cat:other' || i.id === 'cat:solution'));
    assert.deepEqual(blocks[1].items.map(i => i.id), ['changed', 'ann', 'recent']);
    assert.equal(blocks[1].items[0].hasNew, true);
    assert.equal(blocks[1].items[1].hasNew, true);
    assert.equal(blocks[1].items[2].count, 1);
    assert.equal(blocks[2].items[0].id, 'all');
    assert.equal(blocks[2].items[0].count, a.located.length);
});
test('Übungen lists every sheet with its solution and titles the list in plural', () => {
    const model = buildList({ ...args(), selected: 'cat:exercise' });
    assert.equal(model.title, 'Übungen');
    const list = rows(model);
    assert.ok(list.every(r => r.category === 'exercise'));
    assert.match(list.find(r => r.name === 'Übung 5').solution.title, /Lösung/);
    assert.equal(buildList({ ...args(), selected: 'cat:lecture' }).title, 'Vorlesungen');
});
test('dropping a section or a whole group reorders only what moved', () => {
    const ids = ['x', 'a', 'b', 'c', 'y'];
    // Top-level units: x, group [a, b, c], y. Drag y above the group.
    assert.deepEqual(placeSections(prefs(), ids, [['x'], ['y'], ['a', 'b', 'c']]).order, ['x', 'y', 'a', 'b', 'c']);
    // Nested units only: c to the top of its group; x and y keep their places.
    assert.deepEqual(placeSections(prefs(), ids, [['c'], ['a'], ['b']]).order, ['x', 'c', 'a', 'b', 'y']);
    // Stored order is the starting point.
    assert.deepEqual(placeSections({ ...prefs(), order: ['y', 'x'] }, ids, [['x'], ['y']]).order, ['x', 'y', 'a', 'b', 'c']);
});
test('structures flatten deeper labels and single section ancestors', () => {
    const items = nav(args()).find(b => b.key === 'content').items;
    const index = items.findIndex(i => i.id === 'grp:inner');
    assert.equal(items[index].label, 'Praktikum › Dehnungsmessung');
    assert.equal(items[index].count, 3);
    assert.deepEqual(items.slice(index + 1, index + 4).map(i => [i.id, i.depth]), [['sec:a', 1], ['sec:b', 1], ['sec:c', 1]]);
    assert.equal(items.find(i => i.id === 'sec:single').depth, 0);
    assert.ok(!items.some(i => i.id === 'grp:only'));
});
test('empty pages and native sections move to areas; announcements stay out', () => {
    const blocks = nav(args());
    assert.deepEqual(blocks.find(b => b.key === 'areas').items.map(i => i.id), ['area:empty', 'area:forum']);
    assert.ok(blocks.find(b => b.key === 'areas').items.every(i => i.url && i.count === undefined));
    assert.ok(!blocks.find(b => b.key === 'content').items.some(i => i.id === 'sec:empty'));
});
test('hidden sections are editable and remain reachable through direct selection and search', () => {
    const a = args(undefined, { prefs: { ...prefs(), hidden: ['f'] } });
    assert.ok(!nav(a).flatMap(b => b.items).some(i => i.id === 'sec:f'));
    assert.equal(nav(a, true).flatMap(b => b.items).find(i => i.id === 'sec:f').hidden, true);
    assert.ok(!buildList(a).groups.some(g => g.id === 'f'));
    assert.equal(buildList({ ...a, selected: 'sec:f' }).groups.length, 1);
    assert.ok(rows(buildList({ ...a, query: 'Notizseiten' })).length);
});
test('all groups preserve folder runs, natural names, lecturer order and pairing', () => {
    const model = buildList(args());
    assert.equal(model.grouped, true);
    assert.equal(model.showLocation, false);
    const folder = model.groups.find(g => g.id === 'f');
    assert.deepEqual(folder.folders.map(f => f.label), ['', 'Aero']);
    assert.ok(folder.folders[0].entries.findIndex(e => e.name === 'Kapitel 2') < folder.folders[0].entries.findIndex(e => e.name === 'Kapitel 10'));
    const topic = model.groups.find(g => g.id === 't').folders[0].entries;
    assert.deepEqual(topic.map(e => e.name), ['Übung 5', 'Einführung', 'Video', 'Webseite']);
    assert.equal(topic[0].solution.title, 'Lösung Übung 5.pdf');
    assert.equal(topic[1].fileName, 'intro_2026.pdf');
});
test('section, ancestor group, category and upload selections', () => {
    const a = args();
    assert.deepEqual(buildList({ ...a, selected: 'sec:t' }).groups.map(g => g.id), ['t']);
    assert.deepEqual(buildList({ ...a, selected: 'grp:inner' }).groups.map(g => g.id), ['a', 'b', 'c']);
    assert.deepEqual(buildList({ ...a, selected: 'grp:outer' }).groups.map(g => g.id), ['a', 'b', 'c']);
    const solutions = rows(buildList({ ...a, selected: 'cat:solution' }));
    assert.equal(solutions.length, 1); assert.equal(solutions[0].category, 'solution');
    assert.deepEqual(buildList({ ...a, selected: 'upload' }).groups.map(g => g.id), ['hand']);
    for (const selected of ['ann', 'area:forum', 'area:empty']) {
        const model = buildList({ ...a, selected });
        assert.deepEqual(model.groups, []); assert.equal(model.empty, undefined);
    }
});
test('query overrides all layouts, returns solutions separately, and scopes categories', () => {
    const a = args();
    for (const selected of ['all', 'recent', 'changed', 'sec:f', 'grp:inner', 'ann', 'upload', 'area:forum']) {
        const model = buildList({ ...a, selected, query: 'Übung 5' });
        assert.equal(model.title, 'Treffer für „Übung 5“');
        assert.equal(model.grouped, false); assert.equal(model.showLocation, true);
        assert.equal(rows(model).length, 2);
        assert.equal(model.summary, '2 Treffer');
        assert.ok(rows(model).every(r => !r.solution));
    }
    assert.equal(rows(buildList({ ...a, selected: 'cat:solution', query: 'Übung 5' })).length, 1);
    assert.equal(rows(buildList({ ...a, selected: 'cat:video', query: 'Übung 5' })).length, 0);
});
test('recent and changed are flat, newest first; changed is capped at 30', () => {
    const a = args(); a.opened = { [a.located[0].entry.url]: now - 10, [a.located[1].entry.url]: now };
    const recent = buildList({ ...a, selected: 'recent' });
    assert.equal(recent.grouped, false); assert.equal(rows(recent)[0].entry, a.located[1].entry);
    const s = fixture(); s.sections = [section('many', 'Viele', Array.from({ length: 40 }, (_, i) => file(`Datei ${i}`, { modified: now - i, isNew: i === 39 })))];
    const changed = buildList(args(s, { selected: 'changed' }));
    assert.equal(rows(changed).length, 30); assert.equal(rows(changed)[0].name, 'Datei 39');
});
test('pending, error and incomplete groups retain their state and notes', () => {
    const groups = buildList(args()).groups;
    assert.deepEqual(groups.find(g => g.id === 'wait').folders, []);
    assert.equal(groups.find(g => g.id === 'wait').state, 'pending');
    assert.equal(groups.find(g => g.id === 'bad').state, 'error');
    assert.equal(groups.find(g => g.id === 'bad').note, 'Nicht erreichbar');
    assert.equal(groups.find(g => g.id === 'partial').note, 'Weitere Dateien fehlen');
    assert.equal(groups.find(g => g.id === 'partial').folders[0].entries.length, 1);
});
test('sort keys keep missing values last in both directions, within folders and globally', () => {
    const s = fixture();
    s.sections = [section('sort', 'Sortieren', [file('Kapitel 10', { sizeText: '10KB', modified: now, extension: 'zip' }), file('Kapitel 2', { sizeText: '2KB', modified: now - 100, extension: 'pdf' }), file('Ohne', { extension: undefined })])];
    for (const key of ['size', 'modified', 'type']) for (const dir of ['asc', 'desc']) {
        const a = args(s, { sort: { key, dir } });
        assert.equal(rows(buildList(a)).at(-1).name, 'Ohne');
        assert.equal(rows(buildList({ ...a, query: 'Sortieren' })).at(-1).name, 'Ohne');
        assert.equal(rows(buildList(a))[0].name, dir === 'asc' ? 'Kapitel 2' : 'Kapitel 10');
    }
    assert.deepEqual(rows(buildList(args(s, { sort: { key: 'name', dir: 'asc' } }))).map(r => r.name), ['Kapitel 2', 'Kapitel 10', 'Ohne']);
});
test('row names, aliases, location, types and clipped search ranges', () => {
    const s = fixture(); s.sections = [section('x', 'Literatur', [file('MEIN Skript.PDF', { fileName: 'mein_skript.pdf', folderPath: ['Woche 2'] })], { kind: 'literature' })];
    const r = rows(buildList(args(s)))[0];
    assert.equal(r.name, 'MEIN Skript'); assert.equal(r.fileName, undefined);
    assert.equal(r.type, 'Literatur'); assert.equal(r.location, 'Literatur › Woche 2');
    assert.equal(rows(buildList(args(undefined, { selected: 'cat:video' })))[0].type, 'Video');
});
test('German summaries and calm empty messages', () => {
    const s = fixture(); s.sections = [];
    assert.equal(buildList(args(s)).empty, 'Dieser Kurs enthält keine Dateien.');
    assert.equal(buildList(args(s, { selected: 'recent' })).empty, 'Du hast in diesem Kurs noch nichts geöffnet.');
    assert.equal(buildList(args(s, { query: 'xyz' })).empty, 'Nichts gefunden für „xyz“.');
    s.sections = [section('x', 'X', [file('A')])];
    assert.equal(buildList(args(s)).summary, '1 Datei');
    s.sections[0].entries.push(file('B', { kind: 'link' }));
    assert.equal(buildList(args(s)).summary, '1 Datei und 1 Link');
    s.sections[0].entries = [file('A', { kind: 'link' }), file('B', { kind: 'link' })];
    assert.equal(buildList(args(s)).summary, '2 Links');
});
test('nav omits unused smart and kind blocks, respects user order', () => {
    const s = fixture(); s.sections = [section('x', 'X', [file('Sonstiges')]), section('y', 'Y', [file('Anderes')])]; s.announcements = [];
    const a = args(s, { prefs: { ...prefs(), order: ['y', 'missing', 'x'] } });
    assert.deepEqual(nav(a)[0].items.map(i => i.id), ['home']);
    assert.ok(!nav(a).some(b => b.key === 'activity'));
    assert.equal(nav(a).find(b => b.key === 'content').items[0].id, 'all');
    assert.deepEqual(buildList(a).groups.map(g => g.id), ['y', 'x']);
});
test('sidebar and all list share section order even with interleaved group preferences', () => {
    const a = args(undefined, { prefs: { ...prefs(), order: ['b', 'f', 'c', 'a'] } });
    const ids = nav(a).find(b => b.key === 'content').items.filter(i => i.kind === 'section').map(i => i.id.slice(4));
    assert.deepEqual(buildList(a).groups.map(g => g.id), ids);
    assert.deepEqual(ids.slice(0, 3), ['b', 'c', 'a']);
});
test('empty hand-in folders remain reachable through the upload selection', () => {
    const s = fixture(); s.sections.find(s => s.nodeId === 'hand').state = 'empty';
    const model = buildList(args(s, { selected: 'upload' }));
    assert.equal(model.groups[0].id, 'hand'); assert.equal(model.groups[0].canUpload, true);
});
test('upload alone does not inflate the number of categories needed for Art', () => {
    const s = fixture(); s.sections = [section('hand', 'Übung', [file('Übung 1.pdf')], { canUpload: true })];
    assert.deepEqual(nav(args(s))[0].items.map(i => i.id), ['home', 'upload']);
});
test('splitName keeps short names whole, preserves numeric tokens and distinguishes Aero tails', () => {
    for (const name of ['Kurz', '123456789012345678901234']) assert.deepEqual(splitName(name), { head: name, tail: '' });
    const a = 'Aero_I_Kap_0_2026-10-12_Notizseiten', b = 'Aero_I_Kap_0_2026-10-12';
    assert.notEqual(splitName(a).tail, splitName(b).tail);
    for (const name of [a, b, 'Langes_Dokument_1234567890123456789012345', 'EinsehrlangesWortMitabc']) {
        const split = splitName(name); assert.equal(split.head + split.tail, name);
        assert.ok(!(/\d$/.test(split.head) && /^\d/.test(split.tail)));
    }
});
test('formatSize accepts OPAL variants and returns bytes', () => {
    for (const [raw, text, bytes] of [['266,9KB', '267 KB', 266.9 * 1024], ['1,1MB', '1,1 MB', 1.1 * 1024 ** 2], ['18,2KB', '18,2 KB', 18.2 * 1024], ['3,6 KB', '3,6 KB', 3.6 * 1024], ['540 Bytes', '540 B', 540], ['0 B', '0 B', 0]]) assert.deepEqual(formatSize(raw), { text, bytes });
    assert.deepEqual(formatSize(undefined), { text: '' }); assert.deepEqual(formatSize('unbekannt'), { text: '' });
});
test('formatModified uses local calendar days', () => {
    const today = new Date(2026, 10, 16, 12).getTime();
    assert.equal(formatModified(today, today), 'heute');
    assert.equal(formatModified(new Date(2026, 10, 15, 23).getTime(), today), 'gestern');
    assert.equal(formatModified(new Date(2026, 9, 2).getTime(), today), '02.10.2026');
    assert.equal(formatModified(undefined, today), '');
});
test('compact is the default and fallback density', () => {
    assert.equal(defaultLayout().density, 'compact');
    for (const raw of [null, {}, { density: 'invalid' }]) assert.equal(normaliseLayout(raw).density, 'compact');
    assert.equal(normaliseLayout({ density: 'normal' }).density, 'normal');
});

test('layout and prefs migration drop stale ids and wide without mutating input', () => {
    assert.deepEqual(normaliseLayout({ columns: 'auto', density: 'compact', blocks: {} }), { ...defaultLayout(), density: 'compact' });
    assert.deepEqual(normaliseLayout({ columns: { type: false }, sidebar: false }), { ...defaultLayout(), sidebar: false, columns: { type: false, size: true, modified: true } });
    const raw = { order: ['b', 'bad', 'b'], hidden: ['a', 'bad'], collapsed: ['b'], wide: ['a'], selected: 'sec:bad', sort: { key: 'name', dir: 'desc' } };
    assert.deepEqual(normalisePrefs(raw, ['a', 'b']), { order: ['b'], hidden: ['a'], collapsed: ['b'], sort: { key: 'name', dir: 'desc' } });
    assert.deepEqual(raw.wide, ['a']);
});
test('moveSection moves within full listable order and respects boundaries', () => {
    const p = { ...prefs(), order: ['b'] };
    assert.deepEqual(moveSection(p, ['a', 'b', 'c'], 'a', -1).order, ['a', 'b', 'c']);
    assert.deepEqual(moveSection(p, ['a', 'b', 'c'], 'b', 1).order, ['a', 'b', 'c']);
    assert.deepEqual(moveSection(p, ['a', 'b', 'c'], 'b', -1).order, ['b', 'a', 'c']);
    assert.deepEqual(p.order, ['b']);
});
test('600 entries: nav and all list average below 10 ms', t => {
    const s = fixture();
    s.sections = Array.from({ length: 12 }, (_, i) => section(`perf${i}`, `Abschnitt ${i}`, Array.from({ length: 50 }, (_, j) => file(`Kapitel ${j}.pdf`, { folderPath: j % 2 ? ['Teil'] : [], sizeText: '266,9KB' }))));
    const a = args(s);
    for (let i = 0; i < 20; i++) { nav(a); buildList(a); }
    const start = performance.now();
    for (let i = 0; i < 100; i++) { nav(a); buildList(a); }
    const average = (performance.now() - start) / 100;
    t.diagnostic(`Average buildNav + buildList: ${average.toFixed(2)} ms`);
    assert.ok(average < 10, `Average ${average.toFixed(2)} ms`);
});
