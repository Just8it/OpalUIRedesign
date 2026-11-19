import { gatewayRuntime } from './fixtures/opal-gateway-runtime.mjs';
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractTree, buildSections, nodeKind } from '../src/course/tree.ts';
import { parseFolder, parseLinks, parseFrameUrl, parseAnnouncements, parseLiterature, safeFetchUrl, plainText } from '../src/course/parsers.ts';
import { markChanges, trimCache, loadCourse } from '../src/course/loader.ts';
import { OpalError } from '../src/opal/coordinator.ts';
const base = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/123/CourseNode/2';
const raw = (id, type, text, children = []) => ({ id: `id${id}`, text, icon: `fonticon icon-${type}`, a_attr: { href: base.replace(/2$/, id) }, children });
const treeHtml = 'var initial_data=' + JSON.stringify([raw('1', 'root', 'Testkurs', [raw('3', 'st', 'Übungen', [raw('2', 'bc', '<span>Gr&ouml;ße &amp; Maß</span>')])])]) + ';';
test('tree decodes titles and preserves nesting and menu order', () => {
    const tree = extractTree(treeHtml);
    assert.equal(tree.children[0].children[0].title, 'Größe & Maß');
    assert.deepEqual(buildSections(tree)[0].path, ['Übungen']);
    assert.equal(buildSections(tree).length, 1);
});
test('all supported codes map conservatively', () => {
    for (const [code, kind] of Object.entries({ root: 'root', st: 'structure', bc: 'folder', sp: 'page', file: 'page', info: 'announcements', ll: 'links', bib: 'literature', cal: 'calendar', calendar: 'calendar', fo: 'interactive', iqtest: 'interactive', unknown: 'interactive' })) assert.equal(nodeKind(code), kind);
});
test('folder metadata and subfolders exclude listener links', () => {
    const result = parseFolder(readFileSync('test/fixtures/course/folder.html', 'utf8'), base);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].sizeText, '1,2 MB');
    assert.equal(result.entries[0].modified, new Date(2026, 9, 12, 16, 49).getTime());
    assert.equal(result.folders[0].title, 'Weitere Übungen');
    assert.equal(result.incomplete, true);
    assert.deepEqual(result.pages, []);
});
test('frame links resolve, merge empty labels and reject non-links', () => {
    const entries = parseLinks(readFileSync('test/fixtures/course/page.html', 'utf8'), 'https://bildungsportal.sachsen.de/opal/FolderResource/123/start.html?99');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].title, 'Vorlesung 1: Einführung');
    assert.equal(entries[0].url, 'https://bildungsportal.sachsen.de/opal/FolderResource/123/folien.pdf');
    assert.equal(entries[1].external, true);
    assert.equal(parseFrameUrl('<iframe src="/opal/FolderResource/123/a.html?123">', base), 'https://bildungsportal.sachsen.de/opal/FolderResource/123/a.html?123');
});
test('announcements decode date, author and text', () => {
    const [a] = parseAnnouncements('<div class="box box-neutral"><span>11</span><span>NOV 2026</span><h3>Änderung</h3><a title="Profil anzeigen (Erika)">Erika</a><div class="post-content"><p>Grüße &amp; Dank</p></div></div>', base);
    assert.equal(a.date, new Date(2026, 10, 11).getTime());
    assert.equal(a.author, 'Erika');
    assert.equal(a.text, 'Grüße & Dank');
});
test('known video hosts and ordinary links are classified', () => {
    assert.deepEqual(parseLinks('<a href="https://videocampus.sachsen.de/m/abc">Video</a><a href="https://example.org">Quelle</a>', base).map(e => e.kind), ['video', 'link']);
});
test('literature keeps titles even without external links', () => {
    assert.deepEqual(parseLiterature('<tr><td></td><td>Übungsbuch</td></tr>', base).map(e => e.title), ['Übungsbuch']);
});
test('change detection preserves first seen and recognizes modifications', () => {
    const e = parseLinks('<a href="a.pdf">A</a>', base + '/')[0];
    const previous = { sections: [{ entries: [{ ...e, firstSeen: 10 }] }] };
    assert.equal(markChanges([e], undefined, 0, 100)[0].isNew, false);
    assert.equal(markChanges([e], previous, 50, 100)[0].firstSeen, 10);
    assert.equal(markChanges([{ ...e, modified: 60 }], previous, 50, 100)[0].isNew, true);
    assert.equal(markChanges([e], undefined, 50, 100)[0].isNew, true);
});
test('cache retains fifteen most recently opened courses', () => {
    assert.deepEqual(trimCache(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`c${i}`, i]))), ['c1', 'c0']);
});
test('fetch allowlist rejects external, action and Wicket URLs', () => {
    for (const url of ['https://example.org/opal/a', base + '?12-1.page', base + '/logout', 'http://bildungsportal.sachsen.de/opal/a']) assert.equal(safeFetchUrl(url), false);
    assert.equal(plainText('Gr&#252;ße &Uuml;bung'), 'Grüße Übung');
});
test('loader uses fresh cache without network and persists visit', async () => {
    const now = Date.now();
    const tree = extractTree(treeHtml);
    const data = { opalCourseSnapshot2_123: { courseId: '123', title: tree.title, tree, sections: [], announcements: [], fetchedAt: now, previousVisit: 0, url: base }, opalCourseSnapshotIndex: { 123: now - 1000 } };
    globalThis.chrome = { runtime: gatewayRuntime(), storage: { local: { get: async () => data, set: async values => Object.assign(data, values), remove: async () => {} } } };
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('unexpected fetch'); };
    try {
        const phases = [];
        await new Promise(resolve => loadCourse('123', (_, state) => { phases.push(state.phase); if (state.phase === 'done') resolve(); }));
        assert.deepEqual(phases, ['cache', 'done']);
        assert.ok(data.opalCourseSnapshotIndex[123] >= now);
    } finally { globalThis.fetch = original; }
});
test('an interrupted load continues: finished sections are not fetched again, the visit is kept', async () => {
    const now = Date.now();
    const tree = extractTree(treeHtml);
    const sections = buildSections(tree);
    // The fixture course has one folder; it finished before the page reloaded.
    const done = sections.map(s => ({ ...s, state: 'loaded', entries: [{ kind: 'file', title: 'Blatt.pdf', url: s.url + '/Blatt.pdf', folderPath: [], external: false, firstSeen: now - 60000, isNew: false }] }));
    const data = {
        opalCourseSnapshot2_123: { courseId: '123', title: tree.title, tree, sections: done, announcements: [], fetchedAt: 0, previousVisit: 4242, url: base, partial: true, partialAt: now - 60000 },
        opalCourseSnapshotIndex: { 123: now - 60000 },
    };
    globalThis.chrome = { runtime: gatewayRuntime(), storage: { local: { get: async () => data, set: async values => Object.assign(data, values), remove: async () => {} } } };
    const original = globalThis.fetch, fetched = [];
    globalThis.fetch = async target => {
        fetched.push(String(target));
        return { ok: true, url: String(target), text: async () => /\/RepositoryEntry\/123$/.test(String(target)) ? treeHtml : '<html></html>' };
    };
    try {
        let last, phase;
        await new Promise(resolve => loadCourse('123', (snapshot, state) => { last = snapshot; phase = state.phase; if (state.phase === 'done' || state.phase === 'error') resolve(); }));
        assert.equal(phase, 'done');
        const others = fetched.filter(u => !/\/RepositoryEntry\/123$/.test(u));
        assert.deepEqual(others, [], 'finished sections are not fetched again');
        assert.equal(last.sections[0].entries[0].title, 'Blatt.pdf');
        assert.equal(last.previousVisit, 4242);
        assert.ok(!data.opalCourseSnapshot2_123.partial, 'the finished load replaces the partial snapshot');
    } finally { globalThis.fetch = original; }
});

test('a failed section stays resumable and the next open retries it without refetching completed sections', async () => {
    const html = 'var initial_data=' + JSON.stringify([raw('1','root','Course',[raw('2','bc','First'),raw('4','bc','Second')])]) + ';';
    const data = {}, fetched = [];
    const original = globalThis.fetch;
    let fail = true;
    globalThis.chrome = {runtime:gatewayRuntime(), storage:{local:{get:async()=>data,set:async v=>Object.assign(data,structuredClone(v)),remove:async()=>{}}}};
    globalThis.fetch = async target => {
        fetched.push(target);
        if (target.endsWith('/4') && fail) throw new OpalError('timeout','slow section');
        const text = target.endsWith('/123') ? html : `<table><tr><td><a href="${target}/sheet.pdf">Sheet</a></td></tr></table>`;
        return {ok:true,url:target,status:200,text:async()=>text};
    };
    const load = () => new Promise(resolve=>loadCourse('123',(snap,state)=>{
        if(state.phase==='done' || state.phase==='error') resolve(snap);
    }));
    try {
        const first = await load();
        assert.equal(first.partial,true);
        assert.equal(first.fetchedAt,0);
        assert.equal(first.sections[0].entries.length,1);
        fail = false; fetched.length = 0;
        const second = await load();
        assert.ok(!second.partial);
        assert.ok(second.sections.every(s=>s.entries.length===1));
        assert.ok(fetched.some(url=>url.endsWith('/4')));
        assert.ok(!fetched.some(url=>url.endsWith('/2')));
    } finally {globalThis.fetch=original;}
});

test('a timeout while refreshing a cached course returns stale files without replacing storage', async () => {
    const tree=extractTree(treeHtml), sections=buildSections(tree);
    sections[0].state='loaded';
    sections[0].entries=[{kind:'file',title:'Kept.pdf',url:base+'/Kept.pdf',folderPath:[],external:false,firstSeen:1,isNew:false}];
    const data={opalCourseSnapshot2_123:{courseId:'123',title:'Course',url:base,tree,sections,announcements:[],fetchedAt:1,previousVisit:0}};
    const original=globalThis.fetch;
    globalThis.chrome={runtime:gatewayRuntime(),storage:{local:{get:async()=>data,set:async v=>Object.assign(data,structuredClone(v)),remove:async()=>{}}}};
    globalThis.fetch=async()=>{throw new OpalError('timeout','stalled');};
    try {
        const last=await new Promise(resolve=>loadCourse('123',(snap,state)=>{if(state.stale)resolve(snap);}));
        assert.equal(last.sections[0].entries[0].title,'Kept.pdf');
        assert.equal(data.opalCourseSnapshot2_123.partial,undefined);
        assert.equal(data.opalCourseSnapshot2_123.fetchedAt,1);
    } finally {globalThis.fetch=original;}
});

test('leaving a course page aborts its fetch and releases its queue slot without emitting an error', async () => {
    const originalFetch=globalThis.fetch, originalWindow=globalThis.window;
    const events=new EventTarget(), runtime=gatewayRuntime();
    let signal, started;
    const fetching=new Promise(resolve=>{started=resolve;});
    const phases=[], commands=[];
    const send=runtime.sendMessage.bind(runtime);
    runtime.sendMessage=(message,callback)=>{commands.push(message.command);send(message,callback);};
    globalThis.window=events;
    globalThis.chrome={runtime,storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}};
    globalThis.fetch=async(_url,init)=>{
        signal=init.signal;started();
        return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    };
    try {
        loadCourse('123',(_snap,state)=>phases.push(state.phase));
        await fetching;
        events.dispatchEvent(new Event('pagehide'));
        await new Promise(setImmediate);
        assert.equal(signal.aborted,true);
        assert.ok(commands.some(command=>command?.op==='release'));
        assert.ok(!phases.includes('error'));
    } finally {globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});

test('one network failure pauses the course without requesting all remaining sections or restarting',async()=>{
    const html='var initial_data='+JSON.stringify([raw('1','root','Course',[raw('2','bc','Exercises'),raw('4','bc','Lectures'),raw('5','bc','More')])])+';';
    const original=globalThis.fetch,data={},requests=[];
    globalThis.chrome={runtime:gatewayRuntime(),storage:{local:{get:async()=>data,set:async v=>Object.assign(data,structuredClone(v)),remove:async()=>{}}}};
    globalThis.fetch=async target=>{
        requests.push(target);
        if(target.endsWith('/123'))return {ok:true,url:target,status:200,text:async()=>html};
        throw new TypeError('NetworkError when attempting to fetch resource.');
    };
    try {
        const state=await new Promise(resolve=>loadCourse('123',(_snap,state)=>{if(state.phase==='error'||state.phase==='done')resolve(state);}));
        assert.equal(state.phase,'error');
        assert.equal(requests.length,2);
        assert.equal(data.opalCourseSnapshot2_123.partial,true);
        assert.ok(data.opalCourseSnapshot2_123.sections.every(section=>section.state==='pending'));
        await new Promise(setImmediate);
        assert.equal(requests.length,2,'no automatic restart');
    } finally {globalThis.fetch=original;}
});
