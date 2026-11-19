import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const bundle = await build({
    entryPoints: ['src/background.ts'], bundle: true, write: false, format: 'iife',
    plugins: [{ name: 'stored-index', setup(build) {
        build.onLoad({ filter: /core[\\/]index-db\.ts$/ }, () => ({
            contents: 'export const db = { nodes: { toArray: async () => globalThis.storedNodes } };', loader: 'js',
        }));
    } }],
});

test('background export returns every stored row without ranking limits or modifying storage', async () => {
    const storedNodes = Array.from({ length: 650 }, (_, n) => ({ id: `node${n}`, title: `Übung ${n}`, parentId: 'folder', courseId: 'course', visitCount: 3 }));
    const before = JSON.stringify(storedNodes);
    const listeners = [];
    runInNewContext(bundle.outputFiles[0].text, {
        storedNodes,
        chrome: {
            runtime: { id: 'own-extension', onMessage: { addListener: fn => listeners.push(fn) } },
            commands: { onCommand: { addListener() {} } },
        },
    });
    const message = { channel: 'opal-index', op: 'exportNodes' };
    const reply = await new Promise(resolve => {
        for (const listener of listeners) listener(message, { id: 'own-extension' }, resolve);
    });
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.data, storedNodes);
    assert.equal(JSON.stringify(storedNodes), before);
    for (const listener of listeners) {
        listener(message, { id: 'another-extension' }, () => assert.fail('foreign sender received index'));
    }
});
