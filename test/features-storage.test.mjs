import test from 'node:test';
import assert from 'node:assert/strict';
const stored = {};
globalThis.chrome = {storage:{local:{get(keys, callback){ const value = structuredClone(stored); callback?.(value); return Promise.resolve(value); },set(value,callback){Object.assign(stored,structuredClone(value));callback?.();return Promise.resolve();}}}};
const {readFeatureChoices,applyFeatureChoices} = await import('../src/features.ts');
const all = {course:true,preload:false,news:true,deadlines:true,mensa:true};
test('every optional feature is off on a fresh install', async () => {
    assert.deepEqual(await readFeatureChoices(),{course:false,preload:false,news:false,deadlines:false,mensa:false});
});
test('applying choices switches widgets and settings and keeps existing positions',async()=>{
    stored.opalDashboardLayout_v4=[{widgetId:'favorites',x:2,y:3,w:6,h:4,hidden:false}];
    assert.equal(await applyFeatureChoices(all),true);
    assert.deepEqual(stored.opalDashboardLayout_v4[0],{widgetId:'favorites',x:2,y:3,w:6,h:4,hidden:false});
    for (const id of ['whats-new','deadline','mensa']) assert.equal(stored.opalDashboardLayout_v4.find(e=>e.widgetId===id).hidden,false,id);
    assert.deepEqual(stored.opalActiveIndexSettings,{enabled:false});
    assert.deepEqual(await readFeatureChoices(),all);
    assert.equal(await applyFeatureChoices(all),false);
    assert.equal(await applyFeatureChoices({...all,mensa:false}),true);
    assert.equal(stored.opalDashboardLayout_v4.find(e=>e.widgetId==='mensa').hidden,true);
});
