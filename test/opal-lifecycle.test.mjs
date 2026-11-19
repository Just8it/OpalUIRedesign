import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';

const source = buildSync({ entryPoints:['src/opal/background.ts'], bundle:true, write:false, format:'iife', globalName:'subject' }).outputFiles[0].text;
function setup() {
    let listener;
    const data = {}, updated = [], removed = [];
    const context = {chrome:{
        runtime:{id:'extension', onMessage:{addListener:fn=>{listener=fn;}}},
        tabs:{onUpdated:{addListener:fn=>updated.push(fn)}, onRemoved:{addListener:fn=>removed.push(fn)}},
        storage:{local:{get:async()=>structuredClone(data),set:async v=>Object.assign(data,structuredClone(v))}},
    }};
    runInNewContext(source, context);
    context.subject.installOpalCoordinator();
    const acquire = (tabId, id, priority='user', frameId=0) => new Promise(resolve => listener({
        channel:'opal-gateway-v1', command:{op:'acquire', ticket:{id,priority,stateful:true,timeoutMs:30000}},
    }, {id:'extension',tab:{id:tabId},frameId,url:'https://bildungsportal.sachsen.de/opal/home'}, resolve));
    return {data, acquire, updated, removed};
}

test('navigating a tab releases its abandoned request so the next course does not time out', async () => {
    const {acquire, updated} = setup();
    assert.equal((await acquire(1, 'old-page', 'background')).kind, 'grant');
    assert.equal((await acquire(2, 'waiting-course')).kind, 'wait');
    for (const fn of updated) fn(1, {status:'loading'});
    assert.equal((await acquire(2, 'waiting-course')).kind, 'grant');
});

test('tab cleanup covers iframe requests, preserves other tabs, and ignores title updates', async () => {
    const {acquire, updated, removed, data} = setup();
    assert.equal((await acquire(1, 'frame-request', 'background', 7)).kind, 'grant');
    for (const fn of updated) fn(1, {title:'Course'});
    assert.equal((await acquire(2, 'other-tab')).kind, 'wait');
    for (const fn of removed) fn(1);
    assert.equal((await acquire(2, 'other-tab')).kind, 'grant');
    assert.ok(data.opalGatewayLeasesV1.jobs.every(job=>job.id.startsWith('2:')));
});

test('the next document in the same tab gets its permit immediately after navigation', async () => {
    const {acquire, updated} = setup();
    assert.equal((await acquire(1,'old-course')).kind,'grant');
    for (const fn of updated) fn(1,{status:'loading'});
    assert.equal((await acquire(1,'new-course')).kind,'grant');
});
