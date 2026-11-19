import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';

const source = buildSync({entryPoints:['src/main-world.ts'],bundle:true,write:false,format:'iife'}).outputFiles[0].text;
const course = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/45591953410';
function setup({active=true, iframe=false}={}) {
    const attrs = new Map(active ? [['data-opal-course-active','']] : []);
    const calls=[], redirects=[];
    const ajax={
        ajax(...args) {calls.push(args);return 'sent';},
        redirect(url) {redirects.push(url);},
    };
    const window={Wicket:{Ajax:ajax}};window.top=iframe?{}:window;
    const document=new EventTarget();
    Object.assign(document,{
        documentElement:{hasAttribute:key=>attrs.has(key),getAttribute:key=>attrs.get(key),setAttribute:(key,value)=>attrs.set(key,value)},
        querySelectorAll:()=>[],getElementById:()=>null,
    });
    runInNewContext(source,{window,document,location:new URL(course+'?813'),URL,Event,
        MutationObserver:class{observe(){}},setTimeout,clearTimeout,setInterval,clearInterval});
    return {attrs,ajax,calls,redirects};
}

test('hidden native Wicket timers cannot issue stale-page requests while the course view owns the page',()=>{
    const {ajax,calls}=setup();
    // Shape copied from the saved OPAL Wicket.Timer callback, which has no component id.
    ajax.ajax({u:course+'?813-1.1-&ajax=true'});
    assert.equal(calls.length,0);
    assert.equal(ajax.ajax({u:course+'?813-1.1-optionsProfile',c:'profile-link'}),'sent');
    assert.equal(calls.length,1,'explicit native components remain usable');
});

test('an already in-flight stale Wicket response cannot reload the same course during loading',()=>{
    const {ajax,attrs,redirects}=setup({active:false});
    ajax.ajax({u:course+'?813-1.1-&ajax=true'});
    attrs.set('data-opal-course-active','');
    ajax.redirect(course);
    ajax.redirect('?815');
    assert.equal(redirects.length,0);
    ajax.redirect('/opal/shiblogin');
    ajax.redirect(course.replace('45591953410','999'));
    assert.equal(redirects.length,2,'login and other-course navigation remain available');
    attrs.delete('data-opal-course-active');
    ajax.redirect(course);
    assert.equal(redirects.length,3,'original view restores Wicket navigation');
});

test('normal OPAL pages and catalogue iframes retain their original automatic behavior',()=>{
    for(const options of [{active:false},{active:true,iframe:true}]) {
        const {ajax,calls,redirects}=setup(options);
        ajax.ajax({u:course+'?813-1.1-&ajax=true'});
        ajax.redirect(course);
        assert.equal(calls.length,1);
        assert.equal(redirects.length,1);
    }
});
