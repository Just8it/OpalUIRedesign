import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createSearchIndex } from '../src/core/search/engine.ts';

const node = (id, title, extra = {}) => ({ id, title, url: `https://opal/${id}`, type: 'course', courseId: id, parentId: null, visitCount: 0, lastVisited: 0, ...extra });
const foreign = Array.from({ length: 40 }, (_, n) => node(`foreign${n}`, 'Analysis', { source: 'catalog', type: 'file' }));
const local = node('local', 'Analysisunterlagen.pdf', { type: 'file', courseId: 'mine' });

test('course and catalogue filters run before full-match selection and result limits', () => {
    const index = createSearchIndex();
    index.setAll([...foreign, local]);
    assert.equal(index.search('analysis', { limit: 1 })[0].node.id, 'foreign0');
    for (const filters of [{ courseId: 'mine' }, { excludeCatalog: true }]) {
        assert.deepEqual(index.search('analysis', { ...filters, limit: 1 }).map(r => r.node.id), ['local']);
    }
    assert.deepEqual(index.search('analysis', { courseId: 'missing' }), []);
});

const code = buildSync({ entryPoints: ['src/command-center/providers.ts'], bundle: true, write: false, format: 'iife', globalName: 'subject' }).outputFiles[0].text;
function providers(nodes) {
    const index = createSearchIndex();
    index.setAll(nodes);
    const context = {
        viewSeq: 0, closed: false, courseId: 'mine', input: { value: 'analysis' },
        parseCommandQuery: () => ({ commandMode: false }), _favorites: new Map(),
        asResult: node => ({ node, path: [], score: 0, explanation: [] }),
        highlightTokens: () => [], rerender() {},
    };
    const sandbox = { window: { addEventListener() {} }, clearTimeout, URL, location: { origin: 'https://opal' },
        chrome: { runtime: { sendMessage(req, reply) {
            reply({ ok: true, data: req.op === 'search' ? index.search(req.query, req.options) : [] });
        } } } };
    runInNewContext(code, sandbox);
    return { ...sandbox.subject.createProviders(context), context };
}

test('ordinary command search keeps visible matches when catalogue results fill the first page', async () => {
    const p = providers([...foreign, local]);
    await p.runSearch('analysis');
    assert.equal(p.context.results[0].node.id, 'local');
    await p.runSearch('/f analysis');
    assert.equal(p.context.results[0].node.id, 'foreign0');
});

test('course drill-down finds local files behind higher-ranked foreign files and local folders', async () => {
    const folders = Array.from({ length: 25 }, (_, n) => node(`folder${n}`, 'Analysis', { courseId: 'mine', type: 'folder' }));
    const p = providers([...foreign, ...folders, local]);
    await p.enterDrillMode(node('mine', 'Analysis'));
    assert.equal(p.context.mode, 'drill');
    assert.equal(p.context.results[0].node.id, 'local');
});
