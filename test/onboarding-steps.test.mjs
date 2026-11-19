import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, TERMS_STEP, choose, stepDescription } from '../src/onboarding-steps.ts';
import { LEGAL_VERSION, acceptedCurrentTerms, readAcceptance } from '../src/legal.ts';
const off = {course:false,preload:false,news:false,deadlines:false,mensa:false};
test('the terms come first and every later step decides exactly one feature', () => {
    assert.equal(STEPS[TERMS_STEP].key, 'terms');
    assert.throws(()=>choose(off,TERMS_STEP,true),RangeError,'accepting the terms switches no feature on');
    let choices = off;
    for (let i=TERMS_STEP+1;i<STEPS.length;i++) choices = choose(choices,i,true);
    assert.deepEqual(choices,{course:true,preload:true,news:true,deadlines:true,mensa:true});
    assert.deepEqual(off,{course:false,preload:false,news:false,deadlines:false,mensa:false},'choices are not mutated');
    assert.throws(()=>choose(choices,STEPS.length,true),RangeError);
    const news = STEPS.findIndex(s=>s.key==='news');
    assert.match(stepDescription(news,off),/schon geöffnet/);
    assert.doesNotMatch(stepDescription(news,choices),/schon geöffnet/);
    assert.equal(choose(choices,news,false).preload,true);
});
test('only an acceptance of the current terms version counts', () => {
    assert.equal(acceptedCurrentTerms(null), false);
    assert.equal(acceptedCurrentTerms({version:1,completedAt:1,choices:off}), false, 'setups from before the terms step ask again');
    assert.equal(acceptedCurrentTerms({version:2,accepted:{version:'2000-01-01',at:1}}), false, 'changed terms ask again');
    assert.equal(acceptedCurrentTerms({version:2,accepted:{version:LEGAL_VERSION,at:1}}), true);
    assert.deepEqual(readAcceptance({accepted:{version:LEGAL_VERSION,at:5}}), {version:LEGAL_VERSION,at:5});
    assert.equal(readAcceptance({accepted:{version:LEGAL_VERSION,at:'5'}}), null);
});
