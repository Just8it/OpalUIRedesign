import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(dir+'/'+e.name):[dir+'/'+e.name]);}
test('extension storage is accessed only through the storage boundary',()=>{
    const violations=files('src').filter(p=>p.endsWith('.ts')&&!p.startsWith('src/storage/')).flatMap(p=>readFileSync(p,'utf8').replace(/\/\*[\s\S]*?\*\//g, block=>block.replace(/[^\n]/g,' ')).split('\n').flatMap((line,i)=> !line.trimStart().startsWith('*')&&!line.trimStart().startsWith('//')&&/\b(?:chrome|browser)\.storage\b/.test(line)?[p+':'+(i+1)]:[]));
    assert.deepEqual(violations,[]);
});
