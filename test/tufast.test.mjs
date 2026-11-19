import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTufast, tufastActions, clickTufast, observeTufast, waitForTufast, deferTufastLogin } from '../src/tufast.ts';

test('TUfast detection, action mirroring, live disabled state and original click', async () => {
    let present = false, callback, changes = 0, clicks = 0;
    const span = {textContent:'Alle Kurse öffnen',title:'TUfast',style:{},getAttribute:()=>null,click:()=>clicks++};
    globalThis.document = {body:{},querySelector:s=>s.startsWith('.') ? (present ? {} : null) : s === '#openAllCoursesButton' ? span : null,getElementById:()=>span};
    globalThis.MutationObserver = class { constructor(fn){callback=fn;} observe(){} disconnect(){} };
    assert.equal(hasTufast(),false);
    const pending = waitForTufast(20); present=true; callback(); assert.equal(await pending,true);
    const stop = observeTufast(()=>changes++);
    assert.deepEqual(tufastActions(),[{id:'openAllCoursesButton',label:'Alle Kurse öffnen',title:'TUfast',disabled:false}]);
    clickTufast('openAllCoursesButton'); assert.equal(clicks,1);
    span.style.pointerEvents='none'; callback(); assert.equal(changes,2);
    assert.equal(tufastActions()[0].disabled,true); clickTufast('openAllCoursesButton'); assert.equal(clicks,1);
    present=false; callback(); assert.deepEqual(tufastActions(),[]); stop();
    assert.equal(await waitForTufast(1),false);
});

test('login defers only with TUfast and restores normal login after fallback', async () => {
    const states=[]; let finish;
    await deferTufastLogin(s=>states.push(s),async()=>false,async()=>assert.fail('no delay without TUfast'));
    assert.deepEqual(states,[]);
    const pending=deferTufastLogin(s=>states.push(s),async()=>true,()=>new Promise(r=>finish=r));
    await Promise.resolve(); assert.deepEqual(states,[true]);
    finish(); await pending; assert.deepEqual(states,[true,false]);
});
