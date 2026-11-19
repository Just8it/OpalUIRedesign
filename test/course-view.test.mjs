import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRow, nameHtml } from '../src/course/render/list-row.ts';
import { renderGroup, groupSignature, sortedList } from '../src/course/render/list.ts';
import { gridTemplate, listColumns, nextSort, renderColumnHead } from '../src/course/render/list-head.ts';
import { renderEditBar } from '../src/course/render/edit-bar.ts';
import { renderHeader, progressView } from '../src/course/render/header.ts';
import { defaultLayout } from '../src/course/browse/prefs.ts';
globalThis.location = { origin: 'https://bildungsportal.sachsen.de' };
const cols = { loc: false, type: true, size: true, modified: true };
const file = { title: 'Kapitel 2 - Potentialtheorie', url: 'https://example.org/a.pdf', kind: 'file', extension: 'pdf', folderPath: [] };
const row = { entry: file, name: file.title, head: 'Kapitel 2 - ', tail: 'Potentialtheorie', type: 'PDF', size: '295 KB', modified: '12.11.2026', category: 'lecture', location: 'Vorlesung', ranges: [], isNew: true };
const group = { id: '42', title: 'Vorlesung', path: ['Lehrunterlagen'], count: 1, state: 'loaded', url: 'https://example.org/course', folders: [{ label: 'Kapitel 2', entries: [row] }] };
const ctx = { key: 'g:42', cols, grouped: true, collapsed: false };
test('sort cycles both ways then restores lecturer order; columns use actual values', () => {
    for (const key of ['name', 'type', 'size', 'modified']) {
        const first = nextSort({ key: 'order', dir: 'asc' }, key), second = nextSort(first, key);
        assert.notEqual(first.dir, second.dir);
        assert.deepEqual(nextSort(second, key), { key: 'order', dir: 'asc' });
    }
    assert.match(renderColumnHead(cols, { key: 'modified', dir: 'desc' }), /aria-sort="descending"/);
    assert.match(renderColumnHead(cols, { key: 'order', dir: 'asc' }), /<button[^>]*data-sort="name"/);
    assert.match(gridTemplate(cols), /100px 56px 72px 92px$/);
    assert.equal(listColumns({ grouped: false, showLocation: true, groups: [{ ...group, folders: [{ entries: [{ ...row, size: '' }] }] }] }, defaultLayout().columns).size, false);
});
test('name halves touch; solution is a sibling link; opened and new have text labels', () => {
    assert.match(nameHtml(row), /Kapitel 2 - <\/span><span class="opal-course-name-t">Potentialtheorie/);
    const html = renderRow({ ...row, openedAt: new Date(2026, 10, 12).getTime(), solution: file }, { cols, nested: true, group: '42' });
    assert.match(html, /Geöffnet am 12\.11\.2026/);
    assert.match(html, /<span class="sr-only">Neu: <\/span>/, 'new is said in words to screen readers');
    assert.match(html, /opal-course-new-dot" aria-hidden="true"/, 'and shown as a leading dot');
    assert.match(html, /<\/a><\/span>\s*<span role="cell" class="c-act"><a class="opal-course-solution"/);
    assert.match(renderRow({ ...row, entry: { ...file, url: 'javascript:alert(1)' } }, { cols, nested: false, group: '42' }), /href="#"/);
});
test('groups render loading, error, note, folders, upload and collapse', () => {
    const html = renderGroup({ ...group, canUpload: true, note: 'Weitere Seiten in OPAL' }, ctx);
    for (const text of ['Lehrunterlagen', 'Kapitel 2', 'Abgabeordner', 'Hochladen', 'Weitere Seiten in OPAL']) assert.ok(html.includes(text));
    assert.equal((renderGroup({ ...group, state: 'pending' }, ctx).match(/opal-course-row is-skeleton/g) || []).length, 3);
    assert.match(renderGroup({ ...group, state: 'error', note: 'Fehler <b>' }, ctx), /Fehler &lt;b&gt;/);
    assert.ok(renderGroup(group, { ...ctx, collapsed: true }).includes('class="opal-course-group-body" hidden'));
    assert.notEqual(groupSignature(group, ctx), groupSignature({ ...group, note: 'Neu' }, ctx));
});
test('edit controls, quiet header and progress', () => {
    const html = renderEditBar(defaultLayout());
    for (const key of ['type', 'size', 'modified']) assert.match(html, new RegExp(`data-column="${key}" aria-pressed="true"`));
    assert.doesNotMatch(html, /type="checkbox"/);
    assert.match(html, /data-density="compact" aria-checked="true"/);
    assert.doesNotMatch(html, /Fertig|Zurücksetzen/, 'the top bar carries those while customising');
    assert.ok(!renderHeader('Aerodynamik').includes('Anpassen'));
    assert.equal(progressView({ phase: 'loading', loaded: 5, total: 12 }).text, 'Lade Abschnitte: 5 von 12');
});
test('explicit sorting compares entries across sections, unknown dates stay last', () => {
    const model = { title: 'Alle Dateien', grouped: true, showLocation: false, groups: [group, { ...group, folders: [{ label: '', entries: [{ ...row, name: 'New', modifiedMs: 20 }, { ...row, name: 'Old', modifiedMs: 10 }] }] }] };
    const sorted = sortedList(model, { key: 'modified', dir: 'desc' });
    assert.equal(sorted.grouped, false);
    assert.equal(sorted.showLocation, true);
    assert.deepEqual(sorted.groups[0].folders[0].entries.map(e => e.name), ['New', 'Old', row.name]);
    assert.equal(sortedList(model, { key: 'order', dir: 'asc' }), model);
});

test('file-name style reads as words; a shared start is set back; uniform types drop the column', async () => {
    const { sharedPrefix, readable } = await import('../src/course/render/list-row.ts');
    assert.equal(readable('Aero_I_Kap_2.10_Notizseiten', 'Aero_I_Kap_2.10_Notizseiten'), 'Aero I Kap 2.10 Notizseiten');
    assert.equal(readable('Blatt_1 neu', 'Blatt_1 neu'), 'Blatt_1 neu', 'names that already have spaces stay');
    assert.equal(sharedPrefix(['Aero_I_Kap_0_2026', 'Aero_I_Kap1_Fragen', 'Aero_I_Kap_2.10']), 'Aero_I_'.length);
    assert.equal(sharedPrefix(['Übung 1', 'Übung 2', 'Übung 3']), 0, 'never leaves a name with almost nothing');
    assert.equal(sharedPrefix(['A_x', 'A_y']), 0, 'two names are not a pattern');
});

test('an interrupted load does not make a whole section new', async () => {
    const { markChanges } = await import('../src/course/loader.ts');
    const visit = Date.UTC(2026, 10, 10), now = Date.UTC(2026, 10, 17);
    const e = (url, modified) => ({ kind: 'file', title: url, url, folderPath: [], external: false, firstSeen: 0, isNew: false, modified });
    const previous = { sections: [{ nodeId: 'vl', state: 'pending', entries: [] }, { nodeId: 'ue', state: 'loaded', entries: [] }] };
    const vl = markChanges([e('a', Date.UTC(2026, 9, 12)), e('b', Date.UTC(2026, 10, 12))], previous, visit, now, 'vl');
    assert.deepEqual(vl.map(x => x.isNew), [false, true], 'only the change date counts');
    const ue = markChanges([e('c', Date.UTC(2026, 9, 12))], previous, visit, now, 'ue');
    assert.equal(ue[0].isNew, true, 'a file that appeared in a section we did look at is new');
});
