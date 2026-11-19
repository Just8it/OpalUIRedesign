#!/usr/bin/env node
// End-to-end smoke test: loads the built extension (repo root manifest.json)
// into a real headless Chromium, answers every request from a local fake
// OPAL (fake-opal.mjs) and checks the dashboard, search index, options page,
// popup and (when present) the course view. See test/e2e/README.md.
//
//   node test/e2e/smoke.mjs [--no-build] [--browser chrome|edge|<path>] [--headful] [--out <dir>]

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, describeException, findBrowser, formatConsole } from './cdp.mjs';
import { COURSE_TITLE, COURSE_URL, START_URL, createFakeOpal } from './fake-opal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };

const OUT = path.resolve(opt('--out', process.env.E2E_OUT || path.join(os.tmpdir(), 'opal-redesign-e2e', new Date().toISOString().replace(/[:.]/g, '-'))));
const SAMPLES = process.env.E2E_COURSE_SAMPLES
    || [path.join(HERE, 'fixtures', 'course-samples')].find(p => fs.existsSync(p))
    || '';
const VIEWPORT = { width: 1440, height: 900 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

/* ── Result bookkeeping ───────────────────────────────────────── */

const results = [];
function record(id, name, status, evidence = []) {
    results.push({ id, name, status, evidence: evidence.filter(Boolean) });
    const mark = status === 'PASS' ? 'ok  ' : status === 'SKIPPED' ? 'skip' : 'FAIL';
    console.log(`[${mark}] ${id}. ${name}`);
    for (const e of evidence.filter(Boolean)) console.log(`        ${String(e).replace(/\n/g, '\n        ')}`);
}
async function check(id, name, fn) {
    try {
        const r = await fn();
        record(id, name, r.status, r.evidence);
    } catch (err) {
        record(id, name, 'FAIL', [`test error: ${err.stack || err.message}`]);
    }
}

async function waitUntil(fn, { timeout = 15000, interval = 250 } = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
        try { last = await fn(); if (last) return last; } catch (e) { last = undefined; void e; }
        await sleep(interval);
    }
    return last;
}

/* ── Build ────────────────────────────────────────────────────── */

if (!flag('--no-build')) {
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
            execSync('npm run build', { cwd: REPO, stdio: 'pipe' });
            ok = true;
        } catch (e) {
            console.log(`build attempt ${attempt} failed: ${String(e.stderr || e.message).split('\n').slice(0, 6).join(' | ')}`);
            if (attempt < 3) await sleep(30000);
        }
    }
    if (!ok) { console.log('Build failed; aborting.'); process.exit(2); }
}

/* ── Browser + interception ───────────────────────────────────── */

const browserInfo = findBrowser(opt('--browser'));
const fake = createFakeOpal({ repoRoot: REPO, samplesDir: SAMPLES });
const args = [
    '--enable-unsafe-extension-debugging',
    // Belt and braces: nothing may resolve, even if interception missed a request.
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--no-proxy-server',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
];
if (flag('--headful')) args.push('--window-position=-2400,-2400'); else args.push('--headless=new');

console.log(`browser: ${browserInfo.path}\nout:     ${OUT}\nsamples: ${SAMPLES || '(none: course checks limited)'}`);
const browser = await Browser.launch({ executable: browserInfo.path, args, userDataDir: path.join(OUT, 'profile') });
const version = await browser.send('Browser.getVersion');
console.log(`product: ${version.product}\n`);

browser.on('Fetch.requestPaused', async p => {
    try {
        const r = fake.resolve(p.request.url, p.request.method);
        if (r.block) {
            await browser.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' });
            return;
        }
        await browser.send('Fetch.fulfillRequest', {
            requestId: p.requestId,
            responseCode: r.status,
            responseHeaders: Object.entries(r.headers).map(([name, value]) => ({ name, value })),
            body: r.body.toString('base64'),
        });
    } catch { /* request may be gone */ }
});
await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] });

/* ── Target tracking (console, exceptions) ────────────────────── */

const targets = new Map(); // targetId -> { info, sessionId, logs, exceptions }
const bySession = new Map();
browser.on('Target.attachedToTarget', async ({ sessionId, targetInfo, waitingForDebugger }) => {
    const t = targets.get(targetInfo.targetId) || { info: targetInfo, logs: [], exceptions: [] };
    t.info = targetInfo;
    t.sessionId = sessionId;
    targets.set(targetInfo.targetId, t);
    bySession.set(sessionId, t);
    const s = browser.session(sessionId);
    s.on('Runtime.consoleAPICalled', p => t.logs.push({ type: p.type, text: formatConsole(p), url: p.stackTrace?.callFrames?.[0]?.url || '' }));
    s.on('Runtime.exceptionThrown', p => {
        const d = p.exceptionDetails;
        const urls = [d.url, ...(d.stackTrace?.callFrames || []).map(f => f.url)].filter(Boolean).join(' ');
        t.exceptions.push({ text: describeException(d), urls });
    });
    s.on('Log.entryAdded', p => t.logs.push({ type: `log-${p.entry.level}`, text: `[${p.entry.source}] ${p.entry.text} ${p.entry.url || ''}`.slice(0, 600), url: p.entry.url || '' }));
    try {
        await Promise.all([s.send('Runtime.enable'), s.send('Log.enable').catch(() => {})]);
        if (targetInfo.type === 'page') {
            await s.send('Page.enable');
            await s.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false }).catch(() => {});
            s.on('Page.javascriptDialogOpening', p => {
                t.logs.push({ type: 'dialog', text: `[dialog ${p.type}] ${p.message}`, url: '' });
                s.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
            });
        }
    } catch { /* target may be gone */ }
    if (waitingForDebugger) await s.send('Runtime.runIfWaitingForDebugger').catch(() => {});
});
browser.on('Target.targetInfoChanged', ({ targetInfo }) => { const t = targets.get(targetInfo.targetId); if (t) t.info = targetInfo; });
browser.on('Target.detachedFromTarget', ({ sessionId }) => { const t = bySession.get(sessionId); if (t) t.detached = true; });
await browser.send('Target.setDiscoverTargets', { discover: true });
await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

let extId = null;
const isExt = s => !!extId && String(s || '').includes(`chrome-extension://${extId}`);
function extProblems(t, since = 0) {
    if (!t) return { exceptions: [], errors: [], warnings: [] };
    const exceptions = t.exceptions.slice(since.exc || 0).filter(e => isExt(e.urls) || isExt(t.info.url)).map(e => e.text);
    const logs = t.logs.slice(since.log || 0);
    const errors = logs.filter(l => (l.type === 'error' || l.type === 'assert') && (isExt(l.url) || isExt(t.info.url))).map(l => l.text);
    const warnings = logs.filter(l => l.type === 'warning' && (isExt(l.url) || isExt(t.info.url))).map(l => l.text);
    return { exceptions, errors, warnings };
}
function pageNoise(t, since = {}) {
    if (!t) return [];
    return [
        ...t.exceptions.slice(since.exc || 0).filter(e => !isExt(e.urls)).map(e => `page exception: ${e.text}`),
        ...t.logs.slice(since.log || 0).filter(l => l.type === 'error' && !isExt(l.url)).map(l => `page console: ${l.text}`),
    ];
}
const mark = t => ({ exc: t.exceptions.length, log: t.logs.length });

async function newPage(url = 'about:blank') {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const t = await waitUntil(() => targets.get(targetId)?.sessionId && targets.get(targetId), { timeout: 10000 });
    if (!t) throw new Error('page target not attached');
    t.s = browser.session(t.sessionId);
    t.id = targetId;
    if (url !== 'about:blank') await navigate(t, url);
    return t;
}
async function navigate(t, url, { waitLoad = true } = {}) {
    const loaded = waitLoad ? t.s.waitFor('Page.loadEventFired', () => true, 30000).catch(() => null) : null;
    const r = await t.s.send('Page.navigate', { url });
    if (r.errorText) throw new Error(`navigate ${url}: ${r.errorText}`);
    if (loaded) await loaded;
}
async function shot(t, name, full = false) {
    const file = path.join(OUT, `${name}.png`);
    const params = { format: 'png' };
    if (full) params.captureBeyondViewport = true;
    const { data } = await t.s.send('Page.captureScreenshot', params, 20000);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
}
const swTarget = () => [...targets.values()].find(t => t.info.type === 'service_worker' && isExt(t.info.url) && !t.detached);
const fmt = (label, list, n = 5) => list.length ? `${label} (${list.length}): ${list.slice(0, n).join(' || ')}` : null;

/* ── Flash sampler, installed before the start page loads ─────── */

const FLASH_SAMPLER = `(() => {
  if (window.top !== window || !/\\/opal(\\/home|\\/?$)/.test(location.pathname)) return;
  const out = []; window.__opalFlash = out; const t0 = performance.now();
  const sample = () => {
    const html = document.documentElement, body = document.body;
    const ui = document.getElementById('opal-modern-ui');
    const native = document.querySelector('#wrap') || document.querySelector('#main-content');
    let painted = false, hitNative = false;
    if (native && body) {
      const r = native.getBoundingClientRect(), cs = getComputedStyle(native), bs = getComputedStyle(body), hs = getComputedStyle(html);
      painted = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
        && parseFloat(cs.opacity) > 0 && bs.visibility !== 'hidden' && parseFloat(bs.opacity) > 0 && parseFloat(hs.opacity) > 0;
      const el = document.elementFromPoint(innerWidth / 2, Math.min(innerHeight - 1, 300));
      hitNative = !!el && native.contains(el) && !(ui && ui.contains(el));
    }
    out.push({ t: Math.round(performance.now() - t0), rs: document.readyState,
      pending: html.classList.contains('opal-modern-pending'), ui: !!ui,
      uiChildren: ui ? ui.children.length : 0, nativeVisible: painted && hitNative && !(ui && ui.children.length) });
  };
  const loop = () => { sample(); if (out.length < 400 && performance.now() - t0 < 8000) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();`;

/* ── Run ──────────────────────────────────────────────────────── */

let home = null, client = null;
const shots = {};
let flashData = null, earlyShots = [];

try {
    // a. Extension loads, service worker starts cleanly
    await check('a', 'Extension loads; service worker starts without errors', async () => {
        const extPath = REPO.replace(/\\/g, '/');
        const r = await browser.send('Extensions.loadUnpacked', { path: extPath });
        extId = r.id;
        const sw = await waitUntil(swTarget, { timeout: 15000 });
        if (!sw) return { status: 'FAIL', evidence: [`id ${extId}, but no service_worker target appeared`, `targets: ${[...targets.values()].map(t => t.info.type + ' ' + t.info.url).join(', ')}`] };
        await sleep(1500);
        const p = extProblems(sw);
        const ok = !p.exceptions.length && !p.errors.length;
        return { status: ok ? 'PASS' : 'FAIL', evidence: [`extension id ${extId} (loaded via Extensions.loadUnpacked from ${extPath})`, `worker target: ${sw.info.url}`, fmt('exceptions', p.exceptions), fmt('console errors', p.errors), fmt('warnings', p.warnings)] };
    });
    if (!extId) throw new Error('extension did not load; remaining checks impossible');

    // b. Start page dashboard
    await check('b', 'Start page: dashboard overlay mounts, native page hidden, no extension exceptions', async () => {
        home = await newPage();
        await home.s.send('Page.addScriptToEvaluateOnNewDocument', { source: FLASH_SAMPLER });
        // Record every painted frame while the page loads (flash evidence for h).
        // Page.captureScreenshot hangs during a navigation in headless Chrome; a screencast does not.
        const navStart = Date.now();
        const onFrame = p => {
            if (earlyShots.length < 60) earlyShots.push({ ms: Date.now() - navStart, data: p.data });
            home.s.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
        };
        home.s.on('Page.screencastFrame', onFrame);
        await home.s.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
        await navigate(home, START_URL);
        const loadMs = Date.now() - navStart;
        const mounted = await waitUntil(() => home.s.eval(`document.querySelectorAll('#opal-modern-ui .grid-stack-item').length`), { timeout: 15000 });
        // First-run setup opens on the terms and owns focus until it is put off with "Später".
        await waitUntil(() => home.s.eval(`!!document.querySelector('#opal-onboarding [data-choice="no"]')`), { timeout: 5000 });
        await home.s.eval(`document.querySelector('#opal-onboarding [data-choice="no"]')?.click()`);
        await waitUntil(() => home.s.eval(`!document.getElementById('opal-onboarding')`));
        await sleep(1500);
        await home.s.send('Page.stopScreencast').catch(() => {});
        home.s.off('Page.screencastFrame', onFrame);
        const st = await home.s.eval(`(() => {
            const ui = document.getElementById('opal-modern-ui');
            const wrap = document.querySelector('#wrap');
            const el = document.elementFromPoint(innerWidth / 2, 400);
            const cs = wrap ? getComputedStyle(wrap) : null;
            return {
              ui: !!ui, widgets: document.querySelectorAll('#opal-modern-ui .grid-stack-item').length,
              titles: [...document.querySelectorAll('#opal-modern-ui .grid-stack-item')].map(w => (w.getAttribute('gs-id') || w.dataset.widgetId || w.querySelector('h2,h3,.widget-title')?.textContent || '').trim()).slice(0, 20),
              pending: document.documentElement.classList.contains('opal-modern-pending'),
              modActive: document.body.classList.contains('opal-mod-active'),
              wrapOpacity: cs?.opacity, wrapVisibility: cs?.visibility,
              topIsOverlay: !!(el && ui && ui.contains(el)),
              title: document.title,
            };
        })()`);
        shots.dashboard = await shot(home, 'dashboard');
        const p = extProblems(home);
        const nativeHidden = st.topIsOverlay || st.wrapOpacity === '0' || st.wrapVisibility === 'hidden';
        const ok = st.ui && st.widgets > 0 && nativeHidden && !p.exceptions.length;
        return {
            status: ok ? 'PASS' : 'FAIL', evidence: [
                `#opal-modern-ui=${st.ui}, widgets=${st.widgets} [${st.titles.join(', ')}], load ${loadMs} ms, mounted=${!!mounted}`,
                `native hidden=${nativeHidden} (overlay on top=${st.topIsOverlay}, #wrap opacity=${st.wrapOpacity}, visibility=${st.wrapVisibility})`,
                `html.opal-modern-pending still set=${st.pending}, body.opal-mod-active=${st.modActive}` + (st.pending ? ' (note: main.ts:170 re-adds it on render and only removes it on failure, so it stays by design)' : ''),
                fmt('extension exceptions', p.exceptions), fmt('extension console errors', p.errors), fmt('extension warnings', p.warnings, 8),
                `page-own errors (fake OPAL, not counted): ${pageNoise(home).length}`,
                `screenshot: ${shots.dashboard}`,
            ],
        };
    });

    // h. Flash check (data collected during b)
    await check('h', 'Flash check: native start page never visible before the dashboard', async () => {
        if (!home) return { status: 'SKIPPED', evidence: ['start page not loaded'] };
        flashData = await home.s.eval('window.__opalFlash || null');
        const files = [];
        if (earlyShots.length) {
            const pick = [earlyShots[0], earlyShots[1], earlyShots[Math.floor(earlyShots.length / 2)], earlyShots[earlyShots.length - 1]].filter(Boolean);
            pick.forEach((s, i) => { const f = path.join(OUT, `flash-${i}-${s.ms}ms.png`); fs.writeFileSync(f, Buffer.from(s.data, 'base64')); files.push(f); });
        }
        if (!flashData?.length) return { status: 'FAIL', evidence: ['no rAF samples recorded (sampler did not run?)', ...files.map(f => `screenshot: ${f}`)] };
        const visible = flashData.filter(s => s.nativeVisible);
        const firstUi = flashData.find(s => s.uiChildren > 0);
        const firstPending = flashData.find(s => s.pending);
        return {
            status: visible.length ? 'FAIL' : 'PASS', evidence: [
                `${flashData.length} animation-frame samples; first frame t=${flashData[0].t}ms readyState=${flashData[0].rs} pending=${flashData[0].pending}`,
                `pending class first seen at ${firstPending ? firstPending.t + 'ms' : 'never'}, dashboard content first seen at ${firstUi ? firstUi.t + 'ms' : 'never'}`,
                visible.length ? `native page visible in ${visible.length} frames, e.g. t=${visible.slice(0, 5).map(s => s.t + 'ms(' + s.rs + ',pending=' + s.pending + ')').join(', ')}` : 'native page not visible in any sampled frame',
                `${earlyShots.length} screencast frames during load (first at ${earlyShots[0]?.ms ?? '-'} ms after navigation start)`,
                ...files.map(f => `screenshot: ${f}`),
            ],
        };
    });

    // c. Search index round trip
    const indexReq = async (req, timeout = 10000) => client.s.eval(`new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('no reply in ${timeout}ms')), ${timeout});
        chrome.runtime.sendMessage(Object.assign({ channel: 'opal-index' }, ${JSON.stringify(req)}), r => {
            clearTimeout(t);
            const e = chrome.runtime.lastError; if (e) rej(new Error(e.message)); else res(r);
        });
    })`, { timeout: timeout + 5000 });

    await check('c', 'Search index round trip (indexing, stats, Ctrl+K palette)', async () => {
        if (!home) return { status: 'SKIPPED', evidence: ['start page not loaded'] };
        client = await newPage(`chrome-extension://${extId}/options/options.html`);
        const ev = [];
        const stats1 = await waitUntil(async () => { const r = await indexReq({ op: 'stats' }); return r?.ok && r.data.total > 0 ? r : null; }, { timeout: 20000, interval: 750 });
        ev.push(`stats after start page: ${JSON.stringify(stats1?.data ?? 'no index entries within 20s')}`);
        // Visit the fake course page so the passive indexer records it.
        const course = await newPage();
        const cm = mark(course);
        if (fake.hasSamples) {
            await navigate(course, COURSE_URL);
            const found = await waitUntil(async () => { const r = await indexReq({ op: 'search', query: COURSE_TITLE }); return r?.ok && r.data.some(x => x.node.title.includes(COURSE_TITLE)) ? r : null; }, { timeout: 10000, interval: 750 });
            ev.push(`course page visit indexed: ${!!found}`);
            const cp = extProblems(course, cm);
            if (cp.exceptions.length) ev.push(fmt('course page extension exceptions', cp.exceptions));
        }
        await browser.send('Target.closeTarget', { targetId: course.id }).catch(() => {});
        const stats2 = await indexReq({ op: 'stats' });
        ev.push(`stats now: ${JSON.stringify(stats2?.data)}`);

        // Palette: Ctrl+K on the dashboard tab.
        await browser.send('Target.activateTarget', { targetId: home.id });
        await home.s.send('Page.bringToFront');
        const key = (type, extra = {}) => home.s.send('Input.dispatchKeyEvent', { type, ...extra });
        await key('keyDown', { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 });
        await key('keyDown', { key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
        await key('keyUp', { key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
        await key('keyUp', { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
        const opened = await waitUntil(() => home.s.eval(`!!document.getElementById('opal-cmd-input')`), { timeout: 5000 });
        if (!opened) return { status: 'FAIL', evidence: [...ev, 'Ctrl+K did not open #opal-cmd-overlay'] };
        const startView = await waitUntil(() => home.s.eval(`(() => { const r = document.getElementById('opal-cmd-results'); return r && r.innerText.trim() ? r.innerText.trim().replace(/\\s+/g, ' ').slice(0, 200) : ''; })()`), { timeout: 5000 });
        ev.push(`empty query start view: ${startView ? JSON.stringify(startView) : '(empty)'}`);
        await home.s.eval(`document.getElementById('opal-cmd-input').focus()`);
        await home.s.send('Input.insertText', { text: 'Werkstoff' });
        const readRows = () => home.s.eval(`(() => ({ value: document.getElementById('opal-cmd-input')?.value,
            rows: [...document.querySelectorAll('#opal-cmd-results .opal-cmd-result')].map(r => r.innerText.trim().replace(/\\s+/g, ' ').slice(0, 90)),
            text: document.getElementById('opal-cmd-results')?.innerText.trim().replace(/\\s+/g, ' ').slice(0, 160) }))()`);
        // Start-view rows use the same class, so wait for a row that matches the query.
        const found = await waitUntil(async () => { const r = await readRows(); return r.rows.some(x => /Werkstofftechnik/.test(x)) ? r : null; }, { timeout: 6000 });
        const final = found || await readRows();
        const rows = final.rows;
        ev.push(`query ${JSON.stringify(final.value)}: ${rows.length} rows ${JSON.stringify(rows.slice(0, 3))}${rows.length ? '' : ', results text: ' + JSON.stringify(final.text)}`);
        shots.palette = await shot(home, 'palette-results');
        ev.push(`screenshot: ${shots.palette}`);
        const hit = !!rows?.some(r => /Werkstofftechnik/.test(r));
        // Clear the query: the start view must come back.
        await home.s.eval(`(() => { const i = document.getElementById('opal-cmd-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(600);
        const back = await home.s.eval(`(() => { const r = document.getElementById('opal-cmd-results'); return { rows: r.querySelectorAll('.opal-cmd-result').length, text: r.innerText.trim().replace(/\\s+/g, ' ').slice(0, 120) }; })()`);
        ev.push(`after clearing the query: ${JSON.stringify(back)}`);
        await key('keyDown', { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await key('keyUp', { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        const p = extProblems(home);
        if (p.exceptions.length) ev.push(fmt('extension exceptions on dashboard', p.exceptions));
        const ok = !!stats1 && hit && !!startView && !p.exceptions.length;
        return { status: ok ? 'PASS' : 'FAIL', evidence: ev };
    });

    // d. Service worker restart
    await check('d', 'Service worker restart: search still answers (lazy reload from IndexedDB)', async () => {
        if (!client) return { status: 'SKIPPED', evidence: ['no extension client page'] };
        const before = swTarget();
        if (!before) return { status: 'FAIL', evidence: ['no service worker target to stop'] };
        const beforeCount = (await indexReq({ op: 'stats' }))?.data?.total;
        // A worker with an attached debugger never stops and then stops answering;
        // detach our auto-attach session first (the restarted worker is auto-attached again).
        const destroyed = browser.waitForEvent('Target.targetDestroyed', p => p.targetId === before.info.targetId, 8000).then(() => true, () => false);
        await browser.send('Target.detachFromTarget', { sessionId: before.sessionId }).catch(() => {});
        let how = 'detach debugger + ServiceWorker.stopAllWorkers';
        try {
            await client.s.send('ServiceWorker.enable');
            await client.s.send('ServiceWorker.stopAllWorkers');
        } catch (e) {
            how = `Target.closeTarget (stopAllWorkers failed: ${e.message})`;
            await browser.send('Target.closeTarget', { targetId: before.info.targetId }).catch(() => {});
        }
        const gone = await destroyed;
        before.detached = true;
        const r = await indexReq({ op: 'search', query: 'Werkstoff' }, 15000);
        const after = swTarget();
        const hits = r?.ok ? r.data.length : 0;
        const p = after ? extProblems(after) : { exceptions: [], errors: [] };
        const ok = !!gone && r?.ok && hits > 0 && !p.exceptions.length;
        return {
            status: ok ? 'PASS' : 'FAIL', evidence: [
                `stopped via ${how}; old worker target destroyed=${gone}; new worker target=${after ? after.info.targetId.slice(0, 8) + (after === before ? ' (same target!)' : '') : 'none'}`,
                `entries before stop=${beforeCount}; search "Werkstoff" after restart: ok=${r?.ok}, ${hits} hits${r?.ok ? '' : ', error=' + r?.error}`,
                fmt('restarted worker exceptions', p.exceptions), fmt('restarted worker console errors', p.errors),
            ],
        };
    });

    // f. Popup as tab
    await check('f', 'Popup page: search field returns results from the index', async () => {
        const pop = await newPage(`chrome-extension://${extId}/popup/popup.html`);
        await sleep(500);
        await pop.s.eval(`document.getElementById('search').focus()`);
        await pop.s.send('Input.insertText', { text: 'Werkstoff' });
        // The empty field lists recents with the same class: wait for a row matching the query.
        const readRows = () => pop.s.eval(`[...document.querySelectorAll('#results .search-result')].map(x => x.innerText.replace(/\\s+/g, ' ').slice(0, 90))`);
        const rows = await waitUntil(async () => { const r = await readRows(); return r.some(x => /Werkstofftechnik/.test(x)) ? r : null; }, { timeout: 6000 }) || await readRows();
        const text = await pop.s.eval(`'value=' + JSON.stringify(document.getElementById('search').value) + ' results=' + document.getElementById('results').innerText.slice(0, 120)`);
        shots.popup = await shot(pop, 'popup');
        const p = extProblems(pop);
        const ok = !!rows?.some(r => /Werkstofftechnik/.test(r)) && !p.exceptions.length;
        await browser.send('Target.closeTarget', { targetId: pop.id }).catch(() => {});
        return { status: ok ? 'PASS' : 'FAIL', evidence: [`results: ${JSON.stringify(rows.slice(0, 3))} (${text.replace(/\s+/g, ' ')})`, fmt('exceptions', p.exceptions), fmt('console errors', p.errors), `screenshot: ${shots.popup}`] };
    });

    // g. Course view (only when the feature exists)
    await check('g', 'Course view mounts, shows sections, "Originalansicht" restores the native page', async () => {
        const viewSrc = path.join(REPO, 'src', 'course', 'view.ts');
        if (!fs.existsSync(viewSrc)) return { status: 'SKIPPED', evidence: ['src/course/view.ts does not exist yet'] };
        if (!fake.hasSamples) return { status: 'SKIPPED', evidence: ['no course samples (set E2E_COURSE_SAMPLES)'] };
        const bundle = fs.readFileSync(path.join(REPO, 'dist', 'content.js'), 'utf8');
        if (!bundle.includes('opalCourseViewEnabled')) return { status: 'SKIPPED', evidence: ['view.ts exists but dist/content.js does not reference opalCourseViewEnabled (not wired into main.ts yet)'] };
        await client.s.eval(`chrome.storage.local.set({ opalCourseViewEnabled: true })`);
        const page = await newPage();
        const m0 = mark(page);
        await navigate(page, COURSE_URL);
        // First visit mirrors the switch into localStorage; a reload exercises the early gate too.
        // Selectors from src/course/view.ts and src/course/render/*.ts.
        const findView = () => page.s.eval(`(() => {
            const root = document.querySelector('#opal-modern-ui.opal-course-mode');
            if (!root || !root.querySelector('#opal-course-list')) return null;
            const el = document.elementFromPoint(innerWidth / 2, 400);
            const sections = [...root.querySelectorAll('.opal-course-home-block')].map(s => s.getAttribute('aria-label')).filter(Boolean);
            const browserSections = [...root.querySelectorAll('.opal-course-group.is-grouped')].map(s => {
              const t = s.querySelector('.opal-course-ghead-name')?.textContent.trim();
              const rows = s.querySelectorAll('.opal-course-row[data-url]').length;
              const state = s.querySelector('.opal-course-line')?.textContent.trim().slice(0, 60) || '';
              return t + ' [' + rows + (state ? ', ' + state : '') + ']';
            });
            return { sections, browserSections, rows: root.querySelectorAll('.opal-course-home-file[data-url]').length, onTop: !!(el && root.contains(el)), title: root.querySelector('#opal-course-title')?.textContent.trim(),
              meta: root.querySelector('#opal-course-meta-text')?.textContent.trim(), original: !!root.querySelector('#opal-course-original'),
              loading: !(root.querySelector('#opal-course-progress')?.hidden ?? true), status: root.querySelector('#opal-course-status')?.textContent.trim(),
              pending: document.documentElement.className };
        })()`);
        let view = await waitUntil(findView, { timeout: 12000 });
        let reloaded = false;
        if (!view) { reloaded = true; await navigate(page, COURSE_URL); view = await waitUntil(findView, { timeout: 12000 }); }
        // Wait for the loader to finish: the progress strip hides when the phase is 'done' or 'error'.
        if (view) await waitUntil(async () => { const v = await findView(); view = v || view; return v && !v.loading; }, { timeout: 30000, interval: 500 });
        shots.course = await shot(page, 'course-view');
        const ev = [`view: ${JSON.stringify(view)}${reloaded ? ' (needed a reload)' : ''}`, `screenshot: ${shots.course}`];
        await page.s.eval(`document.querySelector('[data-nav="all"]')?.click()`);
        const browserList = await waitUntil(() => page.s.eval(`document.querySelectorAll('.opal-course-row[data-url]').length || null`), { timeout: 5000 });
        ev.push(`Alle Dateien rows: ${browserList}`);
        let restored = null;
        if (view?.original) {
            await page.s.eval(`document.getElementById('opal-course-original').click()`).catch(e => ev.push(`click failed: ${e.message}`));
            await sleep(2500);
            restored = await page.s.eval(`(() => { const el = document.elementFromPoint(innerWidth / 2, 400); const main = document.querySelector('#main-content, .content-container');
                const cs = main ? getComputedStyle(main) : null;
                return { href: location.href, overlay: !!document.getElementById('opal-modern-ui'), nativeOnTop: !!(el && main && main.contains(el)),
                  mainVisibility: cs?.visibility, mainOpacity: cs?.opacity, htmlClass: document.documentElement.className,
                  fab: !!document.querySelector('.opal-course-fab-btn') }; })()`).catch(e => ({ error: e.message }));
            shots.courseOriginal = await shot(page, 'course-original').catch(() => null);
            ev.push(`after Originalansicht: ${JSON.stringify(restored)}`, shots.courseOriginal && `screenshot: ${shots.courseOriginal}`);
        }
        const p = extProblems(page, m0);
        ev.push(fmt('extension exceptions', p.exceptions), fmt('extension console errors', p.errors), fmt('warnings', p.warnings));
        // The fake course page has no OPAL CSS, so its layout is unstyled; "restored" means the overlay
        // is gone, the hiding classes are cleared and the native content is visible again.
        const nativeBack = !!restored && !restored.overlay && !/opal-(modern|course)-pending/.test(restored.htmlClass || '')
            && restored.mainVisibility === 'visible' && restored.mainOpacity === '1';
        const ok = !!view && view.onTop && view.rows > 0 && view.sections.length >= 2 && browserList > 0 && view.original && nativeBack && !p.exceptions.length;
        return { status: ok ? 'PASS' : 'FAIL', evidence: ev };
    });

    // e. Options page (last: it clears the index)
    await check('e', 'Options page: loads cleanly, shows stats, "clear index" empties it', async () => {
        if (!client) return { status: 'SKIPPED', evidence: ['no options page'] };
        const m0 = mark(client);
        const loaded = client.s.waitFor('Page.loadEventFired', () => true, 15000).catch(() => null);
        await client.s.send('Page.reload', { ignoreCache: true });
        await loaded;
        const readStats = () => client.s.eval(`({ index: document.getElementById('indexCount').textContent.trim(), courses: document.getElementById('courseCount').textContent.trim(),
            files: document.getElementById('fileCount').textContent.trim(), status: document.getElementById('statusText').textContent.trim() })`);
        const shown = await waitUntil(async () => { const s = await readStats(); return s.index !== '-' ? s : null; }, { timeout: 8000 });
        await client.s.eval(`document.querySelector('details').open = true`);
        const controls = await client.s.eval(`({ summary: document.getElementById('searchSummary').textContent, course: !!document.getElementById('courseViewToggle'), switches: document.querySelectorAll('input[role=switch]').length, clear: document.getElementById('clearIndexBtn').textContent })`);
        if (!controls.summary.includes('Dateien aus') || !controls.course || controls.switches < 6 || controls.clear !== 'Suchindex löschen') throw new Error('New options controls missing: ' + JSON.stringify(controls));
        shots.options = await shot(client, 'options', true);
        const stored = (await indexReq({ op: 'stats' }))?.data;
        const t0 = client.logs.length;
        await client.s.eval(`document.getElementById('clearIndexBtn').click()`, { timeout: 15000 });
        const dialog = client.logs.slice(t0).find(l => l.type === 'dialog');
        const cleared = await waitUntil(async () => { const r = await indexReq({ op: 'stats' }); return r?.ok && r.data.total === 0 ? r.data : null; }, { timeout: 8000 });
        const after = await waitUntil(async () => { const s = await readStats(); return s.index === '0' ? s : null; }, { timeout: 5000 }) || await readStats();
        const p = extProblems(client, m0);
        const ok = !!shown && Number(shown.index) === stored?.total && !!cleared && after.index === '0' && !p.exceptions.length && !p.errors.length;
        return {
            status: ok ? 'PASS' : 'FAIL', evidence: [
                `shown before clear: ${JSON.stringify(shown)}; background stats: ${JSON.stringify(stored)}`,
                `confirm dialog: ${dialog ? dialog.text : 'none seen'}; background total after clear: ${cleared ? cleared.total : 'not 0'}; page shows: ${JSON.stringify(after)}`,
                fmt('exceptions', p.exceptions), fmt('console errors', p.errors), `screenshot: ${shots.options}`,
            ],
        };
    });
} catch (err) {
    record('!', 'Run aborted', 'FAIL', [err.stack || err.message]);
} finally {
    // Leftover logs for the report.
    const allExt = [];
    for (const t of targets.values()) {
        const p = extProblems(t);
        for (const e of p.exceptions) allExt.push(`${t.info.type} ${t.info.url.slice(0, 80)}: ${e}`);
    }
    fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(fake.log, null, 1));
    fs.writeFileSync(path.join(OUT, 'targets.json'), JSON.stringify([...targets.values()].map(t => ({ type: t.info.type, url: t.info.url, exceptions: t.exceptions, logs: t.logs })), null, 1));
    await browser.close();

    console.log('\n┌────┬─────────┬──────────────────────────────────────────────────────────────────────┐');
    for (const r of results) console.log(`│ ${r.id.padEnd(2)} │ ${r.status.padEnd(7)} │ ${r.name.slice(0, 68).padEnd(68)} │`);
    console.log('└────┴─────────┴──────────────────────────────────────────────────────────────────────┘');
    console.log(`requests: ${fake.counters.served} served, ${fake.counters.notFound} 404, ${fake.counters.blocked} blocked (other hosts)`);
    if (allExt.length) console.log(`all extension exceptions:\n  ${allExt.slice(0, 20).join('\n  ')}`);
    console.log(`artifacts: ${OUT}  (screenshots, requests.json, targets.json)`);
    process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
}
