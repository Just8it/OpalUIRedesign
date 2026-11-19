import test from 'node:test';
import assert from 'node:assert/strict';
import { keptSection, staleSnapshot } from '../src/course/loader.ts';
import { OpalError } from '../src/opal/gateway.ts';
test('non-session failures retain the original snapshot without changing new markers', () => {
 const previous = { sections: [{ entries: [{ isNew: false, firstSeen: 123 }] }], fetchedAt: 123 };
 for (const error of [new Error('offline'), new OpalError('timeout', 'timeout'), new OpalError('unavailable', 'offline')]) {
  assert.equal(staleSnapshot(previous, error), previous);
 }
 assert.equal(previous.sections[0].entries[0].isNew, false);
 assert.equal(staleSnapshot(undefined, new Error('offline')), undefined);
 assert.equal(staleSnapshot(previous, new OpalError('session', 'login')), undefined);
});
test('a failed section keeps its last finished copy, never a pending or failed one', () => {
 const previous = { sections: [
  { nodeId: 'a', state: 'loaded', entries: [{ url: 'x' }] },
  { nodeId: 'b', state: 'error', entries: [] },
  { nodeId: 'c', state: 'pending', entries: [] },
 ] };
 assert.equal(keptSection(previous, 'a'), previous.sections[0]);
 assert.equal(keptSection(previous, 'b'), undefined);
 assert.equal(keptSection(previous, 'c'), undefined);
 assert.equal(keptSection(undefined, 'a'), undefined);
});
