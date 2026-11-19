import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, key } from '../src/storage/store.ts';
import { keys, families } from '../src/storage/registry.ts';
test('defaults, validators, legacy layout shapes, and per-course isolation', async () => {
    const store = createStore(memoryBackend({ opalTheme_v1: {mode:'broken',accent:'bad'}, opalDashboardLayout_v4:[{widgetId:'news',x:0,y:0,w:4,h:3,hidden:false}], opalCourseLayout: {columns:3,density:'normal'} }));
    assert.deepEqual(await store.get(keys.theme), {mode:'dark',accent:'#2f6fe4'});
    assert.equal((await store.get(keys.layout))[0].widgetId, 'neuigkeiten');
    assert.deepEqual((await store.get(keys.courseLayout)).columns, {type:true,size:true,modified:true});
    await store.set(families.opened('a'), {file: 123});
    assert.deepEqual(await store.get(families.opened('b')), {});
    assert.throws(() => families.opened(''));
});
test('updates serialize per key, recover after rejection, and watch unsubscribes', async () => {
    const store = createStore(memoryBackend());
    const counter = key('counter', () => 0, v => typeof v === 'number' ? v : 0);
    const seen=[]; const stop=store.watch(counter, value=>seen.push(value));
    await Promise.all(Array.from({length:20},()=>store.update(counter, async value=>{await Promise.resolve(); return value+1;})));
    assert.equal(await store.get(counter),20);
    assert.deepEqual(seen,Array.from({length:20},(_,i)=>i+1));
    await assert.rejects(store.update(counter,()=>{throw Error('fail')}));
    stop(); await store.update(counter, value=>value+1);
    assert.equal(seen.length,20); assert.equal(await store.get(counter),21);
});
test('older key migration reads without destroying source', async () => {
    const store=createStore(memoryBackend({old:7}));
    assert.equal(await store.get(key('new',()=>0,Number,['old'])),7);
});

test('remove deletes a stored value and notifies subscribers with the default', async () => {
    const backend = memoryBackend({ opalHighlightFile: {title:'Blatt',url:'https://example.org/file'} });
    const store = createStore(backend);
    const seen = [];
    const stop = store.watch(keys.highlight, value => seen.push(value));
    await store.remove(keys.highlight);
    assert.deepEqual(await backend.read('local', [keys.highlight.name]), {});
    assert.equal(await store.get(keys.highlight), undefined);
    assert.deepEqual(seen, [undefined]);
    stop();
});
