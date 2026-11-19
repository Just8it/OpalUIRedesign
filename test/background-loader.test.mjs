import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { gatewayRuntime } from './fixtures/opal-gateway-runtime.mjs';
const bundle = (entry, globalName='subject') => buildSync({entryPoints:[entry],bundle:true,write:false,format:'iife',globalName,target:'es2022'}).outputFiles[0].text;
const load = (entry, context={}) => {runInNewContext(bundle(entry), context); return context.subject;};
const url = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/123';
const entry = (title, name) => ({title, url:url+'/CourseNode/2/'+name, kind:'file', folderPath:[], firstSeen:10, isNew:false, modified:100});
const snapshot = () => ({courseId:'123',url,title:'Mathe',tree:{id:'1',title:'Mathe',kind:'root',children:[]},sections:[{nodeId:'2',title:'Aufgaben',kind:'folder',state:'loaded',path:[],url:url+'/CourseNode/2',entries:[entry('Aufgabe 3','a.pdf'),entry('Loesung 3','l.pdf')]}],announcements:[],previousVisit:50,fetchedAt:Date.now()});
test('shared mapping preserves modified and exact solution; neu includes changed known files', () => {
 const {snapshotIndexNodes} = load('src/course/index-nodes.ts', {URL});
 const nodes = snapshotIndexNodes(snapshot()), e = nodes.find(n=>n.category==='exercise');
 assert.equal(e.modified,100); assert.equal(e.itemNumber,'3'); assert.equal(e.solutionUrl,url+'/CourseNode/2/l.pdf');
 const {changedSinceVisit} = load('src/command-center/course-shortcuts.ts', {URL});
 assert.equal(changedSinceVisit({...e,firstSeenAt:10},50),true);
 assert.equal(changedSinceVisit({...e,firstSeenAt:10,modified:40},50),false);
});
test('background fresh cache changes neither visit index nor markers; weiter resolves pointer read-only', async () => {
 const snap=snapshot(), data={opalCourseSnapshot2_123:snap,opalCourseSnapshotIndex:{123:50}}, writes=[];
 const chrome={runtime:gatewayRuntime(),storage:{local:{get:async()=>data,set:async v=>{writes.push(v);Object.assign(data,v);},remove:async()=>{}}}};
 const context={chrome, URL, AbortController, structuredClone, Date, setTimeout, clearTimeout};
 const {loadCourseInBackground}=load('src/course/loader.ts',context);
 const result=await loadCourseInBackground('123');
 assert.equal(data.opalCourseSnapshotIndex[123],50); assert.equal(writes.length,0); assert.equal(result.previousVisit,50);
 const {continueCourse}=load('src/command-center/course-shortcuts.ts',context);
 const nodes=await continueCourse(url); assert.equal(nodes[0].url,snap.sections[0].entries[0].url); assert.equal(writes.length,0);
 snap.sections[0].entries.push(entry('Aufgabe 4','a4.pdf'));
 data.opalCourseProgress_123={done:{},pointer:{'cat:exercise':'2|n|exercise|4'},pinned:[]};
 const continued=await continueCourse(url); assert.equal(continued[0].url,url+'/CourseNode/2/a4.pdf'); assert.equal(writes.length,0);
});
test('background budget stores partial progress and resumes completed sections without visiting', async () => {
 const data={opalCourseSnapshotIndex:{123:50}}, requests=[];
 const raw=(id)=>({id:'id'+id,text:'Aufgaben '+id,icon:'fonticon icon-bc',a_attr:{href:url+'/CourseNode/'+id},children:[]});
 const html='var initial_data='+JSON.stringify([{id:'id1',text:'Mathe',icon:'fonticon icon-root',a_attr:{href:url},children:[raw(2),raw(3)]}])+';';
 const runtime=gatewayRuntime(), priorities=[], send=runtime.sendMessage.bind(runtime); runtime.sendMessage=(message,cb)=>{if(message.command?.ticket) priorities.push(message.command.ticket.priority);return send(message,cb);};
 const context={chrome:{runtime,storage:{local:{get:async()=>data,set:async v=>Object.assign(data,v),remove:async()=>{}}}},URL,Headers,AbortController,structuredClone,Date,setTimeout,clearTimeout,crypto,fetch:async target=>{requests.push(target);return {ok:true,status:200,url:target,text:async()=>target===url?html:'<html></html>'};}};
 const {loadCourseInBackground}=load('src/course/loader.ts',context);
 const first=await loadCourseInBackground('123',{maxRequests:2});
 assert.equal(requests.length,2); assert.equal(first.partial,true); assert.equal(first.sections[0].state,'empty');
 requests.length=0;
 const second=await loadCourseInBackground('123',{maxRequests:2});
 assert.equal(second.partial,undefined); assert.equal(requests.length,2); assert.equal(data.opalCourseSnapshotIndex[123],50); assert.ok(priorities.length>0); assert.ok(priorities.every(p=>p==='background'));
});
test('sanitizer keeps material metadata and https external entries, rejects unsafe URLs', () => {
 const context={URL,console,chrome:{runtime:{onMessage:{addListener(){}}},commands:{onCommand:{addListener(){}}}}};
 const {sanitize}=load('src/background.ts',context);
 const raw={id:'https://example.org/video',url:'https://example.org/video',title:'Video',type:'file',courseId:new URL(url).pathname,category:'video',itemNumber:'3',modified:100,solutionUrl:'https://example.org/l.pdf'};
 const clean=sanitize(raw); for(const k of ['category','itemNumber','modified','solutionUrl']) assert.equal(clean[k],raw[k]);
 assert.equal(sanitize({...raw,url:'javascript:alert(1)'}),null);
 assert.equal(sanitize({...raw,id:'http://example.org/a',url:'http://example.org/a'}),null);
 assert.equal(sanitize({...raw,solutionUrl:'javascript:alert(1)'}).solutionUrl,undefined);
});
test('indexer course loop calls loader with fakes and creates no frames', async () => {
 const plugin={name:'fakes',setup(build){build.onLoad({filter:/course[\\/]loader\.ts$/},()=>({contents:'export const courseIdFromUrl=()=>"123"; export const loadCourseInBackground=async()=>{globalThis.loads++;return {sections:[]}};',loader:'js'}));build.onLoad({filter:/course[\\/]index-nodes\.ts$/},()=>({contents:'export const snapshotIndexNodes=()=>[];',loader:'js'}));}};
 const {build}=await import('esbuild');
 const output=await build({entryPoints:['src/indexer.ts'],plugins:[plugin],bundle:true,write:false,format:'iife',globalName:'subject'});
 const data={}, context={loads:0,window:{addEventListener(){},setInterval:()=>1,setTimeout:r=>{r();return 1;}},document:{},console,URL,location:{origin:'https://bildungsportal.sachsen.de'},setTimeout:r=>{r();return 1;},clearTimeout(){},setInterval:()=>1,clearInterval(){},chrome:{runtime:{sendMessage(_m,cb){cb?.({ok:true,data:{written:0}});}},storage:{local:{get:async defaults=>typeof defaults==='object'?{...defaults,...data}:data,set:async v=>Object.assign(data,v)},onChanged:{addListener(){}}}}};
 runInNewContext(output.outputFiles[0].text,context);
 await context.subject.indexFavoriteCourses(new Map([[url,{href:url,title:'Mathe'}]]),true);
 assert.equal(context.loads,1);
 // A refresh the user asked for covers every favourite, not only the first three.
 const many=new Map([1,2,3,4,5,6,7].map(n=>{const href=`https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/${n}00`;return [href,{href,title:`Kurs ${n}`}];}));
 await context.subject.indexFavoriteCourses(many,true);
 assert.equal(context.loads,8);
});
