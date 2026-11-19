import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePage, withoutTitleLine, pageExcerpt, isRichPage } from '../src/course/parsers.ts';
import { buildList } from '../src/course/browse/index.ts';
import { locate } from '../src/course/find/index.ts';
import { defaultHome, buildHome, addable } from '../src/course/home/index.ts';
import { renderGroup } from '../src/course/render/list.ts';
import { renderPageDoc } from '../src/course/render/page-doc.ts';
import { renderHome } from '../src/course/render/home.ts';

globalThis.location = { origin: 'https://bildungsportal.sachsen.de' };
const BASE = 'https://bildungsportal.sachsen.de/opal/FolderResource/1/page.html';

// Shaped like the Aerodynamik "Ablaufplan": title line, lecturers, a coloured notice, a schedule table.
const AERO = `<html><head><style>td{color:#000}</style><script>alert(1)</script></head><body>
<h3 style="color:#333">Aerodynamik, Wintersemester 2026/2027</h3><p>&nbsp;</p><p></p><br><br><br><br>
<table border="1" style="width:100%"><tr><td>Dozenten:</td><td>Prof. Dr.-Ing. habil. Jochen Fröhlich<br>PD Dr.-Ing. habil. Jörg Stiller</td></tr></table>
<div style="background-color:#2d3b6b;padding:8px">Vorlesungen, Übungen und Praktika finden <b>in Präsenz</b> statt.</div>
<h4>Termine</h4>
<table><tr><th rowspan="2" style="color:black" onclick="x()">KW</th><th colspan="2">Übung</th></tr>
<tr><td>42</td><td><a href="Week1_Introduction.pdf" onmouseover="steal()">V01</a> Einleitung, Grundlagen</td></tr></table>
<a href="javascript:alert(1)">böse</a><img src="https://evil.example/x.png"><img src="bild.png" alt="Profil" onerror="x()">
<iframe src="https://evil.example"></iframe><form><input></form><p>Text mit < Zeichen</p></body></html>`;

test('sanitizer keeps structure, drops scripts, handlers, styles and foreign embeds', () => {
    const { html, truncated } = sanitizePage(AERO, BASE);
    assert.equal(truncated, false);
    for (const bad of ['<script', 'alert(1)', 'onclick', 'onmouseover', 'onerror', 'style=', 'javascript:', 'evil.example', '<iframe', '<form', '<input', 'color:']) assert.ok(!html.includes(bad), bad);
    assert.match(html, /<div class="opal-course-doc-scroll"><table>/);
    assert.match(html, /<th rowspan="2">KW<\/th>/);
    assert.match(html, /<th colspan="2">/);
    assert.match(html, /<a href="https:\/\/bildungsportal\.sachsen\.de\/opal\/FolderResource\/1\/Week1_Introduction\.pdf" data-url="[^"]+" target="_blank" rel="noopener noreferrer">V01<\/a>/);
    assert.match(html, /<div class="is-note">Vorlesungen/);
    assert.match(html, /<img src="https:\/\/bildungsportal\.sachsen\.de\/opal\/FolderResource\/1\/bild\.png" alt="Profil" loading="lazy">/);
    assert.match(html, /Text mit &lt; Zeichen/);
    assert.ok(!/<p>(?:&nbsp;)?<\/p>/.test(html), 'empty spacer paragraphs removed');
    assert.ok(!/(<br>\s*){3,}/.test(html), 'runs of breaks collapsed');
    assert.match(html, /böse/, 'an unusable link keeps its text');
});

test('sanitizer caps very long pages and says so', () => {
    const long = '<p>' + 'Wort '.repeat(30000) + '</p><p>Ende</p>';
    const page = sanitizePage(long, BASE, 2000);
    assert.equal(page.truncated, true);
    assert.ok(page.html.length < 160000);
});

test('the repeated course title line is dropped, the excerpt is one calm line', () => {
    const { html } = sanitizePage(AERO, BASE);
    const body = withoutTitleLine(html, 'Aerodynamik');
    assert.ok(!body.startsWith('<h3>Aerodynamik'));
    assert.equal(withoutTitleLine('<p>Aerodynamik ist spannend, und zwar sehr, sehr, sehr, sehr, sehr spannend.</p>', 'Aerodynamik').startsWith('<p>'), true, 'a real sentence stays');
    const excerpt = pageExcerpt(html, 'Aerodynamik', 60);
    assert.ok(excerpt.startsWith('Dozenten:'));
    assert.ok(excerpt.endsWith('…') && excerpt.length <= 61);
    assert.equal(isRichPage(html), true);
    assert.equal(isRichPage('<p>Kurz.</p>'), false);
});

const now = Date.now();
const file = (title, extra = {}) => ({ title, kind: 'file', url: `https://bildungsportal.sachsen.de/opal/f/${encodeURIComponent(title)}`, extension: 'pdf', folderPath: [], external: false, firstSeen: now, isNew: false, ...extra });
function course() {
    const { html } = sanitizePage(AERO, BASE);
    const sections = [
        { nodeId: 'plan', title: 'Ablaufplan', kind: 'page', rawType: 'sp', path: [], url: 'https://bildungsportal.sachsen.de/opal/n/plan', state: 'loaded', entries: [file('Übung 1 Kinematik.pdf')], html },
        { nodeId: 'ue', title: 'Übung', kind: 'folder', rawType: 'bc', path: [], url: 'https://bildungsportal.sachsen.de/opal/n/ue', state: 'loaded', entries: [file('Übung 2.pdf'), file('Übung 3.pdf')] },
        { nodeId: 'vl', title: 'Vorlesung', kind: 'folder', rawType: 'bc', path: [], url: 'https://bildungsportal.sachsen.de/opal/n/vl', state: 'loaded', entries: [file('Vorlesung 1.pdf'), file('Vorlesung 2.pdf')] },
    ];
    return { courseId: '1', title: 'Aerodynamik', url: 'https://bildungsportal.sachsen.de/opal/c/1', tree: { id: 'root', title: 'Aerodynamik', kind: 'root', rawType: 'root', url: '', children: [] }, sections, announcements: [], fetchedAt: now, previousVisit: 0 };
}

test('lists carry a page as one excerpt line that unfolds into the page', () => {
    const s = course(), located = locate(s.sections);
    const model = buildList({ snapshot: s, located, opened: {}, prefs: { order: [], hidden: [], collapsed: [] }, selected: 'cat:exercise', query: '', sort: { key: 'order', dir: 'asc' } });
    const plan = model.groups.find(g => g.id === 'plan');
    assert.ok(plan.intro.excerpt.startsWith('Dozenten:'));
    assert.ok(!model.groups.find(g => g.id === 'ue').intro);
    const cols = { loc: false, type: true, size: false, modified: false };
    const closed = renderGroup(plan, { key: 'g:plan', cols, grouped: true, collapsed: false });
    assert.match(closed, /opal-course-intro-line/);
    assert.match(closed, /data-intro="plan"[^>]*aria-expanded="false">Mehr</);
    assert.ok(!closed.includes('<table>'));
    const open = renderGroup(plan, { key: 'g:plan', cols, grouped: true, collapsed: false, introOpen: true });
    assert.match(open, /opal-course-doc is-inline/);
    assert.match(open, /aria-expanded="true">Weniger</);
});

test('page reader: whole when it is only text, clamped with "Mehr anzeigen" when it has files', () => {
    const page = course().sections[0];
    const whole = renderPageDoc(page, { courseTitle: 'Aerodynamik', clamp: false, open: false });
    assert.ok(!whole.includes('is-clamped') && !whole.includes('data-doc-toggle'));
    assert.ok(!whole.includes('Aerodynamik, Wintersemester'));
    const clamped = renderPageDoc(page, { courseTitle: 'Aerodynamik', clamp: true, open: false });
    assert.match(clamped, /is-clamped/);
    assert.match(clamped, /data-doc-toggle="plan"[^>]*aria-expanded="false"[^>]*>Mehr anzeigen/);
    assert.match(renderPageDoc(page, { courseTitle: 'Aerodynamik', clamp: true, open: true }), /Weniger anzeigen/);
});

test('the first rich page becomes one overview block, others stay addable', () => {
    const s = course(), located = locate(s.sections);
    const config = defaultHome(s, located);
    assert.ok(config.blocks.some(b => b.id === 'page:plan' && b.source.type === 'page' && !b.series));
    const model = buildHome({ snapshot: s, located, config, progress: { done: {}, pointer: {}, pinned: [] }, opened: {}, editing: false });
    const block = model.blocks.find(b => b.kind === 'page');
    assert.ok(!block.html.startsWith('<h3>Aerodynamik'), 'title line dropped');
    const html = renderHome(model, { progress: { done: {}, pointer: {}, pinned: [] }, expanded: new Set(), editing: false, rename: '', adding: false, previousVisit: 0 });
    assert.match(html, /data-kind="page"/);
    assert.match(html, /opal-course-doc is-preview/);
    assert.match(html, />Ganze Seite</);
    const without = { ...config, blocks: config.blocks.filter(b => b.id !== 'page:plan') };
    assert.ok(addable(s, located, without).some(a => a.id === 'page:plan'));
    assert.ok(!addable(s, located, without).some(a => a.id === 'sec:plan'), 'a page is offered once, as a page');
});
