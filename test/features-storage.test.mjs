import test from 'node:test';
import assert from 'node:assert/strict';
const stored = {};
globalThis.chrome = {storage:{local:{get(keys, callback){ const value = structuredClone(stored); callback?.(value); return Promise.resolve(value); },set(value,callback){Object.assign(stored,structuredClone(value));callback?.();return Promise.resolve();}}}};
const {readFeatureChoices,applyFeatureChoices} = await import('../src/features.ts');
test('defaults and missing widget entries agree; applying choices retains existing positions',async()=>{
    assert.deepEqual(await readFeatureChoices(),{course:false,preload:true,news:false,deadlines:false});
    stored.opalDashboardLayout_v4=[{widgetId:'favorites',x:2,y:3,w:6,h:4,hidden:false}];
    assert.equal(await applyFeatureChoices({course:true,preload:false,news:true,deadlines:true}),true);
    assert.deepEqual(stored.opalDashboardLayout_v4[0],{widgetId:'favorites',x:2,y:3,w:6,h:4,hidden:false});
    assert.equal(stored.opalDashboardLayout_v4.find(e=>e.widgetId==='whats-new').hidden,false);
    assert.equal(stored.opalDashboardLayout_v4.find(e=>e.widgetId==='deadline').hidden,false);
    assert.deepEqual(stored.opalActiveIndexSettings,{enabled:false});
    assert.deepEqual(await readFeatureChoices(),{course:true,preload:false,news:true,deadlines:true});
    assert.equal(await applyFeatureChoices({course:true,preload:false,news:true,deadlines:true}),false);
});
