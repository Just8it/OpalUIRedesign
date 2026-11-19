import test from 'node:test';
import assert from 'node:assert/strict';
import { keys, families } from '../src/storage/registry.ts';
import { createStore, memoryBackend } from '../src/storage/store.ts';
const time = 1794916800000;
const url = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/123';
const snapshot = {courseId:'123', title:'Analysis', semester:'Wintersemester 2026 / 2027', url, tree:{id:'root',title:'Analysis',children:[]}, sections:[{nodeId:'materials',title:'Materialien',kind:'folder',url:url+'/CourseNode/2',state:'done',entries:[]}],announcements:[],fetchedAt:time,previousVisit:time-100000,partial:true,partialAt:time};
const staticFixture = {
 gateway:{jobs:[{id:'1:0:job',priority:'user',stateful:true,timeoutMs:30000,order:1,expires:time+30000,active:true,key:url}],sequence:2,failures:1,retryAt:time,userActiveUntil:time+1000},
 progress:{status:'running',kind:'catalog',startedAt:time,updatedAt:time,totalCourses:20,completedCourses:3,indexedItems:12,currentCourseTitle:'Analysis'},
 scrapedDeadlines:[{id:'sd_123',title:'Abgabe',courseId:'123',courseTitle:'Analysis',pageUrl:url,due:'2026-12-01T12:00:00.000Z',kind:'deadline',foundAt:'2026-11-17T12:00:00.000Z',description:'Blatt 4',dismissed:true}],
 snapshotIndex:{123:time}, activeIndex:{[url]:time},catalogIndexed:time,prunedAt:time,migrated:time,
 highlight:{title:'Blatt 4.pdf',url:url+'/file.pdf'},favoriteSnapshot:[{href:url,title:'Analysis',type:'course',moduleCode:'MA1'}],favoriteFingerprint:[url],
 mensa:{favoriteCanteenIds:[4,6],favoriteNames:['Pasta']},preload:{enabled:false},catalog:{enabled:true},history:['analysis','blatt 4'],
 onboarding:{version:1,completedAt:time,choices:{course:true,preload:true,news:false,deadlines:true}},refreshRequested:time,customizeRequested:{request:'appearance',at:time,tabId:7},
 enabled:false,language:'en',courseView:true,deadlines:false,reopen:true,explainRanking:true,downloadFiles:true,
 theme:{mode:'light',accent:'#123456'},layout:[{widgetId:'favorites',x:0,y:0,w:8,h:5,hidden:false}],
 courseLayout:{density:'normal',sidebar:false,columns:{type:true,size:false,modified:true}},
 calendarEvents:[{id:'exam',title:'Klausur',start:'2026-12-01T12:00:00.000Z',end:'2026-12-01T14:00:00.000Z',allDay:false,isDeadline:true,timeZone:'Europe/Berlin',exdates:[],location:'HS1',description:'Analysis',color:'#123456',createdAt:'2026-11-17T12:00:00.000Z'}],
 calendarSettings:{showFavoritesAsEvents:true,matchThreshold:0.6},newsFilter:'favorites',whatsNewRevealed:true,whatsNew:{days:7,limit:20},
};
const familyFixture = {
 home:{version:1,blocks:[{id:'cat:lecture',title:'Vorlesung',color:2,source:{type:'category',category:'lecture'},hidden:false,series:true}]},
 courseProgress:{done:{unit1:time},pointer:{'cat:lecture':'unit2'},pinned:[url+'/file.pdf']},
 snapshot,legacySnapshot:snapshot,homeHintDismissed:true,collapsed:['materials'],
 prefs:{order:['materials'],hidden:[],collapsed:[],open:['materials'],selected:'sec:materials',sort:{key:'name',dir:'asc'}},
 announcementSeen:'2026-11-17|Klausur',opened:{[url+'/file.pdf']:time},
};
test('every registered descriptor round-trips realistic persisted user data without loss',async()=>{
 assert.deepEqual(Object.keys(staticFixture).sort(),Object.keys(keys).sort(),'new keys require explicit fixtures');
 assert.deepEqual(Object.keys(familyFixture).sort(),Object.keys(families).sort(),'new families require explicit fixtures');
 const entries=[...Object.entries(keys).map(([id,key])=>[key,staticFixture[id]]),...Object.entries(families).map(([id,factory])=>[factory('123'),familyFixture[id]])];
 const fixture=Object.fromEntries(entries.map(([key,value])=>[key.name,value]));
 const backend=memoryBackend(fixture); const store=createStore(backend);
 for(const [key,value] of entries){const loaded=await store.get(key);assert.deepEqual(loaded,value,key.name+' read');await store.set(key,loaded);}
 assert.deepEqual(await backend.read('local',Object.keys(fixture)),fixture);
});
