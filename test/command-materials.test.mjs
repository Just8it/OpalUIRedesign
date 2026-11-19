import test from 'node:test';
import assert from 'node:assert/strict';
import { availableChips, selectedChip, filterMaterials, pairedSolution, parseShortcut } from '../src/command-center/materials.ts';
import { snapshotIndexNodes } from '../src/course/view/snapshot.ts';
test('material intent, chips and course-local solutions', () => {
 const exercise = { id:'e', category:'exercise', courseId:'a', itemNumber:'3', solutionUrl:'https://example.org/solution.pdf' };
 const solution = { id:'s', url:'https://example.org/solution.pdf', category:'solution', courseId:'a', itemNumber:'3' };
 const results = [exercise, solution].map(node => ({node}));
 assert.equal(selectedChip('\u00fc3'), 'exercise');
 assert.equal(availableChips(results).length, 3);
 assert.deepEqual(filterMaterials(results, 'solution'), [results[1]]);
 assert.equal(pairedSolution(exercise, [{...solution, url:'https://wrong.org/solution.pdf'}, solution]), solution);
 assert.deepEqual(parseShortcut('Mathe neu'), {course:'Mathe', action:'neu'});
 assert.deepEqual(parseShortcut('Mathe weiter'), {course:'Mathe', action:'weiter'});
});
test('snapshot nodes preserve parent chain, stable URL identity and classification', () => {
 const nodes = snapshotIndexNodes({url:'/opal/auth/RepositoryEntry/1', title:'Mathe', sections:[{url:'/opal/auth/RepositoryEntry/1/CourseNode/2', title:'Übungen', path:[], entries:[{title:'Blatt_3.pdf', url:'/opal/file/Blatt_3.pdf', kind:'file', folderPath:['Serie'], extension:'pdf', firstSeen:0, isNew:false}]}]});
 const file = nodes.at(-1);
 assert.equal(file.id, '/opal/file/Blatt_3.pdf'); assert.equal(file.category, 'exercise'); assert.equal(file.itemNumber, '3');
 assert.equal(nodes.find(n => n.id === file.parentId).title, 'Serie');
});

import { enrichBatch } from '../src/core/search/storage-enrichment.ts';
test('storage upserts derive root-first ancestry from stored and unordered batch parents', async () => {
 const file = {id:'f', title:'03.pdf', url:'/opal/03.pdf', type:'file', parentId:'p', courseId:'c', lastVisited:9, visitCount:2};
 const parent = {id:'p', title:'Aufgaben', type:'folder', parentId:'c'};
 await enrichBatch([file, parent], async id => id === 'c' ? {id:'c', title:'Mathe', parentId:null} : undefined);
 assert.equal(file.category, 'exercise'); assert.equal(file.itemNumber, '3');
 assert.equal(file.lastVisited, 9); assert.equal(file.visitCount, 2);
});
