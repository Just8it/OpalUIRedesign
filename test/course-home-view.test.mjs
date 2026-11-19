import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHomeSeries } from '../src/course/render/home-series.ts';
import { renderHomeList, renderHomeAnnouncements } from '../src/course/render/home-list.ts';
import { renderHomeEdit } from '../src/course/render/home-edit.ts';
import { renderHome, renderHomeSkeleton } from '../src/course/render/home.ts';
import { doneEntries } from '../src/course/render/home-shared.ts';
import { pinToggle, renderRow } from '../src/course/render/list-row.ts';
globalThis.location = { origin: 'https://bildungsportal.sachsen.de' };
const entry={title:'Aufgaben 1.pdf',url:'https://example.org/1.pdf',extension:'pdf',kind:'file',folderPath:[]};
const config={id:'cat:exercise',title:'Übung',color:1,hidden:false,series:true,source:{type:'category',category:'exercise'}};
const state={progress:{done:{},pointer:{},pinned:[]},expanded:new Set(),editing:false,rename:'',adding:false,previousVisit:100};
const unit={key:'u1',title:'Übung 1',entries:[entry],solutions:[{...entry,url:'https://example.org/solution.pdf'}],location:'Übung › Aufgaben',state:'current',hasNew:false};
const block={kind:'series',config,units:[unit],current:unit,next:[],earlier:[],progressText:'1 Einheit',doneCount:0};
test('series prioritises current, includes solutions and next/past disclosures',()=>{
 const html=renderHomeSeries({...block,next:[{...unit,key:'u2',title:'Übung 2'}],earlier:[{...unit,key:'u0',doneAt:1700000000000}]},state);
 for(const text of ['Jetzt dran','Als Nächstes','Frühere (1)','Erledigt am','Hier weitermachen','Wieder öffnen','Lösungen','Überspringen'])assert.ok(html.includes(text),text);
 assert.ok(html.indexOf('Jetzt dran')<html.indexOf('Als Nächstes'));
 assert.match(html,/data-home="done"/);
 assert.match(html,/aria-expanded="false"/);
});
test('all done and empty series',()=>{
 assert.match(renderHomeSeries({...block,current:undefined},state),/Alles erledigt/);
 assert.match(renderHomeSeries({...block,current:undefined},state),/Von vorn beginnen/);
 assert.match(renderHomeSeries({...block,current:undefined,units:[]},state),/Keine Dateien/);
});
test('plain list caps six and pins stay operable',()=>{
 const b={kind:'list',config,entries:Array.from({length:8},(_,i)=>({...entry,url:`https://example.org/${i}.pdf`})),total:8};
 const html=renderHomeList(b,state);
 assert.equal((html.match(/class="opal-course-home-file"/g)||[]).length,6);
 assert.match(html,/Alle 8 anzeigen/);
 assert.match(pinToggle(entry.url,true),/aria-pressed="true" aria-label="Lösen"/);
 assert.match(pinToggle(entry.url),/aria-pressed="false" aria-label="Anpinnen"/);
 assert.match(renderHomeList({...b,config:{...config,source:{type:'pinned'}},entries:[],total:0},state),/Nichts angepinnt/);
});
test('announcements show unread text and safe preview content',()=>{
 const html=renderHomeAnnouncements({kind:'announcements',config,items:[{title:'Neuer Raum',text:'<b>Raum 4</b>',date:1000}],total:1,unread:1},state);
 assert.match(html,/Neu/);assert.match(html,/&lt;b&gt;/);assert.match(html,/Alle Mitteilungen/);
});
test('arrange rows: grip, hide, options with rename, colours, progress and custom removal',()=>{
 const html=renderHomeEdit({...config,id:'custom:1'},{...state,rename:'custom:1'},'3 Dateien',{index:1,total:3});
 for(const text of ['data-grip','Position 2 von 3','data-home="hide"','data-home="expand"','data-home="remove"','data-home-rename','role="radiogroup"','role="switch"'])assert.ok(html.includes(text),text);
 assert.match(html,/opal-course-home-eopts[^>]* hidden/);
 assert.match(renderHomeEdit({...config,hidden:true},state),/is-placeholder/);
 assert.equal((html.match(/role="radio"/g)||[]).length,8);
 assert.doesNotMatch(renderHomeEdit(config,state),/data-home="remove"/);
});
test('done mapping includes solutions, done mark supersedes opened mark',()=>{
 const model={blocks:[{...block,units:[{...unit,doneAt:1700000000000}]}],hidden:[],addable:[],empty:false};
 const done=doneEntries(model);assert.equal(done.size,2);
 const html=renderRow({entry,name:'Aufgaben 1',head:'Aufgaben ',tail:'1',ranges:[],type:'PDF',size:'',modified:'',openedAt:1000}, {cols:{},nested:false,group:'all',done,pinned:new Set([entry.url])});
 assert.match(html,/is-done/);assert.match(html,/Erledigt am/);assert.doesNotMatch(html,/Geöffnet am/);assert.match(html,/aria-pressed="true"/);
 assert.match(renderHome(model,state),/data-block="cat:exercise"/);assert.match(renderHomeSkeleton(),/aria-busy="true"/);
});
