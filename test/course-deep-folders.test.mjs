import { gatewayRuntime } from './fixtures/opal-gateway-runtime.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPageUrl } from '../src/course/parsers.ts';

/* A small stand-in for OPAL's folder component, with the behaviour observed
 * on the live site:
 *  - every GET of the node url creates a new page instance showing the root;
 *  - a folder is opened by the Wicket click listener of its row, which changes
 *    the state of THAT page instance and answers with an ajax listing;
 *  - a plain GET of a subfolder's href just shows the root again;
 *  - tables show 20 rows per page; "next page" is a plain listener link whose
 *    answer is a fresh render (the render counter goes up, old links go stale);
 *  - OPAL keeps one current node per session, so overlapping requests break. */

const ORIGIN = 'https://bildungsportal.sachsen.de';
const COURSE = `${ORIGIN}/opal/auth/RepositoryEntry/77`;
const NODE = `${COURSE}/CourseNode/500`;
const LISTENER = '-fluidContainer-contentPanel-folderPanel-tableForm-tableContainer';
const PAGE_SIZE = 20;

const files = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}_${String(i + 1).padStart(2, '0')}.pdf`);
/** Five levels deep, with siblings on several levels and one folder that needs paging. */
const TREE = {
    files: ['Hinweise.pdf'],
    dirs: {
        'Aufgaben': {
            files: files('A', 3),
            dirs: {
                'Serie 1': {
                    files: ['S1.pdf'],
                    dirs: {
                        'Teil a': {
                            files: ['a.pdf'],
                            dirs: { 'Daten': { files: ['d1.csv'], dirs: { 'Roh': { files: ['roh.zip'], dirs: {} } } } },
                        },
                        'Teil b': { files: ['b.pdf'], dirs: {} },
                    },
                },
                'Serie 2': { files: ['S2.pdf'], dirs: {} },
            },
        },
        'Lösungen': { files: files('L', 2), dirs: { 'Zusatz': { files: ['Z.pdf'], dirs: {} } } },
        'Skript': { files: files('Skript', 43), dirs: {} },
    },
};

function at(path) {
    let dir = TREE;
    for (const name of path) dir = dir.dirs[name];
    return dir;
}

function createFakeOpal() {
    const pages = new Map();
    let nextId = 10;
    let inFlight = 0;
    const stats = { requests: 0, overlaps: 0, staleLinks: 0 };

    function render(page, ajax) {
        const dir = at(page.path);
        const rows = [...Object.keys(dir.dirs).map(name => ({ name, dir: true })), ...dir.files.map(name => ({ name, dir: false }))];
        const shown = rows.slice(page.tablePage * PAGE_SIZE, (page.tablePage + 1) * PAGE_SIZE);
        page.rows = shown;
        const here = `${NODE}${page.path.map(p => '/' + encodeURIComponent(p)).join('')}`;
        let html = '<p>Sie dürfen Dateien herunterladen.</p><table><tbody>';
        let scripts = '';
        shown.forEach((row, i) => {
            const id = `id${page.id}x${page.render}x${i}`;
            html += `<tr><td>${row.dir ? '<span class="fonticon icon-folder" title="Ordner"></span>' : '<span class="fonticon icon-pdf"></span>'}</td>`
                + `<td><a id="${id}" href="${here}/${encodeURIComponent(row.name)}" data-file-name="${row.name}"><span>${row.name}</span></a></td>`
                + `<td>${row.dir ? '' : '120,5 KB'}</td><td><span>am 03.11.2026 um 09:15 Uhr</span></td></tr>`;
            if (row.dir) scripts += `Wicket.Ajax.ajax({"u":"/opal/auth/RepositoryEntry/77/CourseNode/500?${page.id}-${page.render}.1${LISTENER}-tableRow-${i}-tableCellRepeating-2-tableLink","c":"${id}","i":"veil"});`;
        });
        html += '</tbody></table>';
        const hasNext = (page.tablePage + 1) * PAGE_SIZE < rows.length;
        html += hasNext
            ? `<a href="/opal/auth/RepositoryEntry/77/CourseNode/500?${page.id}-${page.render}.${LISTENER}-pager-nextItem-next" title="Gehe zur nächsten Seite">›</a>`
            : '<a aria-disabled="true" title="Gehe zur nächsten Seite">›</a>';
        return ajax
            ? `<?xml version="1.0" encoding="UTF-8"?><ajax-response><component id="c"><![CDATA[${html}]]></component><evaluate><![CDATA[${scripts}]]></evaluate></ajax-response>`
            : `<html><body><div class="content-container">${html}</div><script>${scripts}</script></body></html>`;
    }

    const respond = (text, url) => ({ ok: true, status: 200, url, text: async () => text });

    async function fetchImpl(input, init = {}) {
        stats.requests++;
        if (inFlight > 0) stats.overlaps++;
        inFlight++;
        try {
            await new Promise(resolve => setTimeout(resolve, 2));
            const url = new URL(String(input));
            if (url.href === COURSE) {
                const tree = [{ id: 'id1', text: 'Tiefer Kurs', icon: 'fonticon icon-root', a_attr: { href: `${COURSE}/CourseNode/1` }, children: [
                    { id: 'id500', text: 'Material', icon: 'fonticon icon-bc', a_attr: { href: NODE }, children: [] },
                ] }];
                return respond(`<html><body>Wintersemester 2026 / 2027<script>var initial_data=${JSON.stringify(tree)};</script></body></html>`, `${COURSE}?1`);
            }
            if (url.pathname.startsWith(new URL(NODE).pathname)) {
                const listener = url.search.match(/^\?(\d+)-(\d+)\.(\d*)-?(.*)$/);
                if (!listener) {
                    // Fresh page instance; a subfolder href shows the root as well.
                    const page = { id: nextId++, render: 1, path: [], tablePage: 0, rows: [] };
                    pages.set(page.id, page);
                    return respond(render(page, false), `${url.origin}${url.pathname}?${page.id}`);
                }
                const page = pages.get(Number(listener[1]));
                if (!page) return respond('<html><body>expired</body></html>', url.href);
                if (Number(listener[2]) !== page.render) { stats.staleLinks++; return respond(render(page, false), url.href); }
                const row = url.search.match(/-tableRow-(\d+)-/);
                if (row) {
                    assert.equal(init.headers?.['Wicket-Ajax'], 'true', 'folder clicks are ajax requests');
                    const target = page.rows[Number(row[1])];
                    if (target?.dir) { page.path = [...page.path, target.name]; page.tablePage = 0; }
                    return respond(render(page, true), url.href);
                }
                if (/-pager-nextItem-next$/.test(url.search)) {
                    page.tablePage++;
                    page.render++;
                    return respond(render(page, false), `${url.origin}${url.pathname}?${page.id}`);
                }
            }
            return { ok: false, status: 404, url: url.href, text: async () => '' };
        } finally {
            inFlight--;
        }
    }
    return { fetchImpl, stats };
}

function allFiles(dir, path = []) {
    return [
        ...dir.files.map(name => [...path, name].join('/')),
        ...Object.entries(dir.dirs).flatMap(([name, sub]) => allFiles(sub, [...path, name])),
    ];
}

test('the pager link of this node is the only Wicket link accepted for paging', () => {
    const ok = `<a href="/opal/auth/RepositoryEntry/77/CourseNode/500?12-1.${LISTENER}-pager-nextItem-next" title="Gehe zur nächsten Seite">›</a>`;
    assert.match(nextPageUrl(ok, NODE), /\?12-1\..*-pager-nextItem-next$/);
    assert.equal(nextPageUrl('<a aria-disabled="true" title="Gehe zur nächsten Seite">›</a>', NODE), undefined);
    assert.equal(nextPageUrl(ok.replace('CourseNode/500', 'CourseNode/999'), NODE), undefined);
    assert.equal(nextPageUrl(ok.replace('-pager-nextItem-next', '-deleteButton'), NODE), undefined);
    assert.equal(nextPageUrl(ok.replace('/opal/auth', 'https://evil.example/opal/auth'), NODE), undefined);
});

test('loader lists a folder tree five levels deep, with siblings and paging, one request at a time', async () => {
    const store = {};
    globalThis.chrome = {
        storage: { local: {
            get: async keys => (keys == null ? { ...store } : Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]]))),
            set: async values => { Object.assign(store, structuredClone(values)); },
            remove: async keys => { for (const k of [].concat(keys)) delete store[k]; },
        } },
        runtime: gatewayRuntime((_msg, cb) => cb?.({ ok: true, data: { written: 0, rejected: 0 } })),
    };
    globalThis.window ??= { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
    const fake = createFakeOpal();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fake.fetchImpl;
    try {
        const { loadCourse } = await import('../src/course/loader.ts');
        const snapshot = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('loader did not finish')), 20000);
            loadCourse('77', (snap, state) => {
                if (state.phase === 'error') { clearTimeout(timer); reject(new Error(state.error)); }
                if (state.phase === 'done') { clearTimeout(timer); resolve(snap); }
            });
        });
        const section = snapshot.sections.find(s => s.kind === 'folder');
        assert.ok(section, 'folder section exists');
        const found = section.entries.map(e => [...e.folderPath, e.title].join('/')).sort();
        assert.deepEqual(found, allFiles(TREE).sort());
        assert.equal(Math.max(...section.entries.map(e => e.folderPath.length)), 5);
        assert.equal(section.incomplete, undefined, section.error);
        assert.equal(fake.stats.overlaps, 0, 'requests must never overlap');
        assert.equal(fake.stats.staleLinks, 0, 'no stale pager links are followed');
        // 10 folders incl. the root. Chains reuse the open page, so this stays far below one chain per folder.
        assert.ok(fake.stats.requests <= 26, `too many requests: ${fake.stats.requests}`);
        console.log(`deep tree: ${found.length} files, ${fake.stats.requests} requests`);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
