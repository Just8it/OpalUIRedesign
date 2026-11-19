import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, choose, stepDescription } from '../src/onboarding-steps.ts';
test('four decisions preserve earlier choices and apply only to the selected feature', () => {
    const initial = {course:false,preload:false,news:false,deadlines:false};
    let choices = initial;
    for (let i=0;i<STEPS.length;i++) choices = choose(choices,i,true);
    assert.deepEqual(choices,{course:true,preload:true,news:true,deadlines:true});
    assert.equal(initial.course,false);
    assert.throws(()=>choose(choices,4,true),RangeError);
    assert.match(stepDescription(2,initial),/schon geöffnet/);
    assert.doesNotMatch(stepDescription(2,choices),/schon geöffnet/);
    assert.equal(choose(choices,0,false).preload,true);
});
