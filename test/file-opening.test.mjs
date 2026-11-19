import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';

const bundle = entry => buildSync({entryPoints:[entry], bundle:true, write:false, format:'iife', globalName:'subject'}).outputFiles[0].text;
const openingCode = bundle('src/core/file-opening.ts');
const file = 'https://bildungsportal.sachsen.de/opal/FolderResource/123/aero1_A03.pdf';
function setup() {
    let listener;
    const data = {}, tabs = [], downloads = [];
    const chrome = {
        runtime: { id:'extension', getURL: path => `chrome-extension://extension/${path}`, onMessage:{addListener:fn=>{listener=fn;}} },
        storage: { local:{get:async()=>data, set:async value=>Object.assign(data,value)}, onChanged:{addListener(){}} },
        tabs: { create(options, cb) { tabs.push(options); cb(); } },
        downloads: { download(options, cb) { downloads.push(options); cb(1); } },
    };
    const context = {chrome, URL, console};
    runInNewContext(openingCode, context);
    context.subject.installFileOpening(async () => ({url:'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/123/CourseNode/456'}));
    const request = (url=file, id='extension', folder) => new Promise(resolve => {
        const handled = listener({type:'opal-open-file', url, folder}, {id}, resolve);
        if (!handled) resolve(null);
    });
    return {context, chrome, data, tabs, downloads, request};
}

test('files open their OPAL folder with a highlight by default; the toggle enables direct downloads', async () => {
    const {data, tabs, downloads, request} = setup();
    assert.equal((await request()).ok, true);
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].url, 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/123/CourseNode/456');
    assert.equal(data.opalHighlightFile.url, file);
    assert.equal(data.opalHighlightFile.title, 'aero1_A03.pdf');
    assert.equal(downloads.length, 0);
    data.opalDownloadFiles = true;
    assert.equal((await request()).ok, true);
    assert.equal(downloads[0].url, file);
    assert.equal(tabs.length, 1);
});

test('the course view never opens a folder tab: it downloads when asked, otherwise leaves the file to the caller', async () => {
    const {data, tabs, downloads, request} = setup();
    const reply = await request(file, 'extension', false);
    assert.equal(reply.ok, false);
    assert.equal(reply.direct, true);
    assert.equal(tabs.length, 0);
    assert.equal(data.opalHighlightFile, undefined);
    data.opalDownloadFiles = true;
    assert.equal((await request(file, 'extension', false)).ok, true);
    assert.equal(downloads[0].url, file);
    assert.equal(tabs.length, 0);
});

test('opening rejects foreign senders, external URLs, session links and script URLs', async () => {
    const {request, downloads, tabs} = setup();
    for (const url of ['javascript:alert(1)', 'https://evil.example/file.pdf', file+'?token=abc', '/opal/auth/logout']) assert.equal(await request(url), null);
    assert.equal(await request(file, 'foreign'), null);
    assert.equal(downloads.length + tabs.length, 0);
});

test('download failures are reported so navigation can fall back', async () => {
    const {chrome, data, request} = setup();
    data.opalDownloadFiles = true;
    chrome.downloads.download = (_options, cb) => {
        chrome.runtime.lastError = {message:'Download failed'}; cb(); delete chrome.runtime.lastError;
    };
    const reply = await request();
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'Download failed');
});

test('the client keeps session-dependent and external URLs on the native navigation path', async () => {
    const {context} = setup();
    assert.equal(await context.subject.openFile(file+'?token=abc'), false);
    assert.equal(await context.subject.openFile('https://example.com/video'), false);
});
