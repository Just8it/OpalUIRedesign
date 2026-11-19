import test from 'node:test';
import assert from 'node:assert/strict';
import { OpalCoordinator, responseFailure } from '../src/opal/coordinator.ts';
import { createOpalGateway } from '../src/opal/gateway.ts';
const ticket = (id, priority = 'background', stateful = false, key) => ({ id, priority, stateful, key, timeoutMs: 1000 });
const acquire = (c, ...args) => c.handle({ op: 'acquire', ticket: ticket(...args) });
const release = (c, id, rest = {}) => c.handle({ op: 'release', id, ...rest });
const url = 'https://bildungsportal.sachsen.de/opal/home';
const page = { text: '<html>OK</html>', url, status: 200 };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('global cap is two, including independent client instances', () => {
    const c = new OpalCoordinator();
    assert.equal(acquire(c, 'tab1').kind, 'grant');
    assert.equal(acquire(c, 'tab2').kind, 'grant');
    assert.equal(acquire(c, 'tab3').kind, 'wait');
    release(c, 'tab1');
    assert.equal(acquire(c, 'tab3').kind, 'grant');
});
test('user > view > background, FIFO within priority; background pauses for queued user', () => {
    const c = new OpalCoordinator();
    acquire(c, 'active', 'background', true);
    for (const [id, priority] of [['bg','background'], ['v','view'], ['u1','user'], ['u2','user']]) acquire(c, id, priority);
    release(c, 'active');
    assert.equal(acquire(c, 'bg').kind, 'wait');
    assert.equal(acquire(c, 'v', 'view').kind, 'wait');
    assert.equal(acquire(c, 'u2', 'user').kind, 'wait');
    assert.equal(acquire(c, 'u1', 'user').kind, 'grant');
    assert.equal(acquire(c, 'u2', 'user').kind, 'grant');
    release(c, 'u1'); release(c, 'u2');
    assert.equal(acquire(c, 'v', 'view').kind, 'grant');
});
test('stateful leases are exclusive, including against ordinary GETs', () => {
    const c = new OpalCoordinator();
    assert.equal(acquire(c, 's1', 'user', true).kind, 'grant');
    assert.equal(acquire(c, 's2', 'user', true).kind, 'wait');
    assert.equal(acquire(c, 'g', 'view').kind, 'wait');
    release(c, 's1');
    assert.equal(acquire(c, 's2', 'user', true).kind, 'grant');
});
test('lease expiry and queue expiry survive worker reconstruction', () => {
    let now = 0;
    const c = new OpalCoordinator(undefined, () => now);
    acquire(c, 'dead-tab', 'user', true);
    acquire(c, 'dead-waiter', 'user');
    const restarted = new OpalCoordinator(structuredClone(c.state), () => now);
    now = 3001;
    assert.equal(acquire(restarted, 'live', 'user', true).kind, 'wait');
    now = 5001;
    assert.equal(acquire(restarted, 'live', 'user', true).kind, 'grant');
    release(restarted, 'dead-tab');
    assert.equal(restarted.state.jobs.filter(j => j.active).length, 1);
});
test('session failures stop background, exponential cooldown persists, no automatic retry', () => {
    let now = 0;
    const c = new OpalCoordinator(undefined, () => now);
    acquire(c, 'a'); release(c, 'a', { failure: 'session' });
    assert.equal(acquire(c, 'b').kind, 'error');
    assert.equal(c.state.retryAt, 5000);
    now = 5000;
    acquire(c, 'c'); release(c, 'c', { failure: 'unavailable' });
    assert.equal(c.state.retryAt, 15000);
    assert.equal(acquire(new OpalCoordinator(structuredClone(c.state), () => now), 'd').kind, 'error');
});
test('a cooldown from background work never locks the user out; their success ends it', () => {
    let now = 0;
    const c = new OpalCoordinator(undefined, () => now);
    acquire(c, 'bg', 'background'); release(c, 'bg', { failure: 'session' });
    assert.equal(acquire(c, 'auto', 'background').kind, 'error', 'automatic work pauses');
    assert.equal(acquire(c, 'mine', 'user', true).kind, 'grant', 'the course the user opens still loads');
    release(c, 'mine', { page: { text: '<a href="/opal/logout">', url: 'https://bildungsportal.sachsen.de/opal/x', status: 200 } });
    assert.equal(c.state.retryAt, 0);
    assert.equal(acquire(c, 'auto2', 'background').kind, 'grant');
});
test('identical in-flight GETs share a result across clients, aborted follower does not cancel owner', () => {
    const c = new OpalCoordinator();
    acquire(c, 'a', 'view', false, url);
    assert.equal(acquire(c, 'b', 'view', false, url).kind, 'wait');
    acquire(c, 'abort', 'view', false, url); release(c, 'abort');
    release(c, 'a', { page });
    assert.deepEqual(acquire(c, 'b', 'view', false, url), { kind: 'result', page });
    assert.equal(acquire(c, 'new', 'view', false, url).kind, 'grant');
});
test('detects login forms, expired pages, Wicket redirects, 429 and 5xx; ordinary text stays valid', () => {
    assert.equal(responseFailure(url, '<input type="password">'), 'session');
    assert.equal(responseFailure(url, '<a href="/opal/logout">Abmelden</a><form><input type="password" name="enrolKey"></form>'), undefined, 'an enrolment key field on a signed-in page is not a lost session');
    assert.equal(responseFailure(url, '<a class="logout"></a><form id="loginForm"></form>'), undefined);
    assert.equal(responseFailure(url + '/login', '<h1>OPAL</h1>', 401), 'session');
    assert.equal(responseFailure(url, '<title>Page expired</title>'), 'expired');
    assert.equal(responseFailure(url, '<ajax-response><redirect><![CDATA[/opal/login]]></redirect></ajax-response>'), 'expired');
    for (const status of [429, 500, 503]) assert.equal(responseFailure(url, '', status), 'unavailable');
    assert.equal(responseFailure(url, '<p>Explain session cookies</p>'), undefined);
});
test('gateway fetch uses credentials, preserves headers, dedupes two tabs', async () => {
    const c = new OpalCoordinator();
    let finish, calls = 0;
    const fetcher = async (target, init) => {
        calls++; assert.equal(init.credentials, 'include'); assert.equal(new Headers(init.headers).get('Accept'), 'text/html');
        await new Promise(resolve => { finish = resolve; });
        return new Response(page.text);
    };
    const a = createOpalGateway(async cmd => c.handle(cmd), fetcher);
    const b = createOpalGateway(async cmd => c.handle(cmd), fetcher);
    const one = a.fetchHtml(url, { headers: { Accept: 'text/html' } });
    await tick();
    const two = b.fetchHtml(url, { headers: { Accept: 'text/html' } });
    await tick(); finish();
    assert.deepEqual(await one, page);
    assert.deepEqual(await two, page);
    assert.equal(calls, 1);
});
test('abort queued request releases its ticket without fetching', async () => {
    const c = new OpalCoordinator(); acquire(c, 'busy', 'user', true);
    const gateway = createOpalGateway(async cmd => c.handle(cmd), async () => { assert.fail('must not fetch'); });
    const controller = new AbortController();
    const request = gateway.fetchHtml(url, { signal: controller.signal });
    const rejected = assert.rejects(request, e => e.name === 'AbortError');
    await tick(); controller.abort(); await rejected;
    assert.equal(c.state.jobs.length, 1);
});
test('timeout aborts in-flight fetch and releases permit (injected timer)', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const c = new OpalCoordinator(); let signal;
    const gateway = createOpalGateway(async cmd => c.handle(cmd), async (_url, init) => { signal = init.signal; return new Promise(() => {}); });
    const request = gateway.fetchHtml(url, { timeoutMs: 100 });
    const rejected = assert.rejects(request, e => e.code === 'timeout');
    await tick(); t.mock.timers.tick(100); await rejected;
    assert.equal(signal.aborted, true); assert.equal(c.state.jobs.length, 0);
});
test('gateway reports typed session error, subsequent request backs off without fetch', async () => {
    const c = new OpalCoordinator(); let calls = 0;
    const gateway = createOpalGateway(async cmd => c.handle(cmd), async () => { calls++; return new Response('<title>Page expired</title>'); });
    await assert.rejects(gateway.fetchHtml(url), e => e.code === 'expired');
    await assert.rejects(gateway.fetchHtml(url, { priority: 'background' }), e => e.code === 'backoff' && e.retryAt > Date.now());
    assert.equal(calls, 1);
});
test('timeout also cancels queued work and pre-aborted signal never fetches', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const c = new OpalCoordinator(); acquire(c, 'busy', 'user', true);
    const gateway = createOpalGateway(async cmd => c.handle(cmd), async () => { assert.fail('must not fetch'); });
    const queued = gateway.fetchHtml(url, { timeoutMs: 200 });
    const rejected = assert.rejects(queued, e => e.code === 'timeout');
    await tick(); t.mock.timers.tick(200); await rejected;
    const controller = new AbortController(); controller.abort();
    await assert.rejects(gateway.fetchHtml(url, { signal: controller.signal }), e => e.name === 'AbortError');
    assert.equal(c.state.jobs.length, 1);
});

test('course loader uses user leases and stops on session failure', async () => {
    const { loadCourse } = await import('../src/course/loader.ts');
    const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
    const c = new OpalCoordinator(); const messages = []; let fetched = 0;
    globalThis.chrome = {
        storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
        runtime: { lastError: null, sendMessage: (message, done) => {
            messages.push(message.command);
            done(c.handle(message.command));
        } },
    };
    globalThis.fetch = async () => { fetched++; return new Response('<title>Page expired</title>'); };
    try {
        await new Promise(resolve => loadCourse('123', (_snapshot, state) => { if (state.phase === 'error') resolve(); }));
        assert.equal(fetched, 1);
        const lease = messages.find(m => m.op === 'acquire').ticket;
        assert.equal(lease.priority, 'user'); assert.equal(lease.stateful, true);
        assert.equal(acquire(c, 'background').kind, 'error');
    } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});

test('abort in-flight request cancels only its fetch and releases the lease', async () => {
    const c = new OpalCoordinator(); let activeSignal;
    const gateway = createOpalGateway(async cmd => c.handle(cmd), async (_url, init) => {
        activeSignal = init.signal;
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    });
    const controller = new AbortController();
    const request = gateway.fetchHtml(url, { signal: controller.signal });
    const rejected = assert.rejects(request, e => e.name === 'AbortError');
    await tick(); controller.abort(); await rejected;
    assert.equal(activeSignal.aborted, true); assert.equal(c.state.jobs.length, 0);
});
test('already queued background work stops when active request expires the session', () => {
    const c = new OpalCoordinator();
    acquire(c, 'user', 'user', true);
    assert.equal(acquire(c, 'waiting').kind, 'wait');
    release(c, 'user', { failure: 'session' });
    assert.equal(acquire(c, 'waiting').kind, 'error');
    assert.equal(c.state.jobs.length, 0);
});

import { createBackgroundStepper } from '../src/opal/iframe-step.ts';

test('user waits only for one 15s iframe step, never the next background section', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const c = new OpalCoordinator();
    const gateway = createOpalGateway(async cmd => c.handle(cmd));
    let removed = false;
    const step = createBackgroundStepper({ remove() { removed = true; } }, gateway);
    const first = step(() => new Promise(() => {}));
    const expired = assert.rejects(first, e => e.code === 'timeout');
    await tick();
    const start = Date.now();
    let userStarted;
    const user = gateway.run(async () => { userStarted = Date.now(); }, { priority: 'user', stateful: true });
    await tick();
    for (let i = 0; i < 150; i++) { t.mock.timers.tick(100); await tick(); }
    await expired; await tick();
    const next = step(async () => { assert.ok(userStarted !== undefined, 'user ran before next section'); });
    await tick();
    t.mock.timers.tick(100); await tick();
    await user;
    assert.ok(userStarted - start <= 15100, '15s in-flight step plus one polling tick');
    assert.equal(removed, true);
    t.mock.timers.tick(100); await next;
});

test('unreachable coordinator fails open for user/view with one local stateful operation across clients', async () => {
    const offline = async () => { throw new Error('invalidated'); };
    const a = createOpalGateway(offline), b = createOpalGateway(offline);
    let finish, active = 0, max = 0;
    const first = a.run(async () => { active++; max = Math.max(max, active); await new Promise(r => { finish = r; }); active--; }, { priority: 'user', stateful: true });
    await tick();
    const second = b.run(async () => { active++; max = Math.max(max, active); active--; }, { priority: 'view', stateful: true });
    await tick(); assert.equal(active, 1);
    finish(); await Promise.all([first, second]); assert.equal(max, 1);
    await assert.rejects(a.run(async () => assert.fail('background must not run'), { priority: 'background' }), e => e.code === 'coordinator');
});

test('nonresponding transport falls back after one second', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const gateway = createOpalGateway(() => new Promise(() => {}));
    let ran = false;
    const request = gateway.run(async () => { ran = true; }, { priority: 'user' });
    await tick(); t.mock.timers.tick(999); await tick(); assert.equal(ran, false);
    t.mock.timers.tick(1); await request; assert.equal(ran, true);
});

test('user activity pauses background and authenticated recovery clears session cooldown', () => {
    let now = 0;
    const c = new OpalCoordinator(undefined, () => now);
    acquire(c, 'expired'); release(c, 'expired', { failure: 'session' });
    c.handle({ op: 'activity' });
    assert.equal(c.state.retryAt, 5000, 'gesture alone is not successful login');
    c.handle({ op: 'activity', recovered: true });
    assert.equal(c.state.retryAt, 0);
    assert.equal(acquire(c, 'bg').kind, 'wait');
    assert.equal(acquire(c, 'user', 'user').kind, 'grant'); release(c, 'user');
    now = 1000; assert.equal(acquire(c, 'bg').kind, 'grant');
});

test('100ms waiting polls do not write storage; lease heartbeat does', async () => {
    const original = globalThis.chrome, originalNow = Date.now;
    let listener, state, writes = 0, now = 10000;
    Date.now = () => now;
    globalThis.chrome = {
        runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } } },
        storage: { local: { get: async () => state ? { opalGatewayLeasesV1: structuredClone(state) } : {}, set: async value => { writes++; state = structuredClone(value.opalGatewayLeasesV1); } } },
    };
    try {
        const { installOpalCoordinator } = await import('../src/opal/background.ts');
        installOpalCoordinator();
        const send = command => new Promise(resolve => listener({ channel: 'opal-gateway-v1', command }, { id: 'test', tab: { id: 1 }, url, frameId: 0 }, resolve));
        await send({ op: 'acquire', ticket: { ...ticket('active', 'user', true), timeoutMs: 15000 } });
        await send({ op: 'acquire', ticket: ticket('waiting', 'user') });
        const before = writes;
        for (let i = 0; i < 19; i++) { now += 100; await send({ op: 'acquire', ticket: ticket('waiting', 'user') }); }
        assert.equal(writes, before);
        now += 200; await send({ op: 'acquire', ticket: ticket('waiting', 'user') });
        assert.equal(writes, before + 1, 'one persisted liveness heartbeat after 2s');
    } finally { globalThis.chrome = original; Date.now = originalNow; }
});

test('native gestures click synchronously during cooldown; automatic actions still click on rejection', async () => {
    const { buildSync } = await import('esbuild');
    const { runInNewContext } = await import('node:vm');
    const document = new EventTarget(), attrs = new Map();
    let clicks = 0, messages = 0, now = Date.now();
    const gestures = new Map(), listen = document.addEventListener.bind(document);
    document.addEventListener = (type, listener, opts) => { if (['pointerdown', 'keydown', 'click'].includes(type)) gestures.set(type, listener); listen(type, listener, opts); };
    const target = { click() { clicks++; } };
    Object.assign(document, {
        documentElement: { getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), hasAttribute: () => false },
        getElementById: () => target, querySelectorAll: () => [], querySelector: () => null,
    });
    const window = {}; window.top = window;
    const navigator = { userActivation: { isActive: true } };
    const context = {
        Date: class extends Date { static now() { return now; } },
        document, window, navigator, Event, crypto, AbortController, URL, Headers, console: { ...console, warn() {} },
        MutationObserver: class { observe() {} disconnect() {} },
        XMLHttpRequest: class { send() {} },
        setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        chrome: { runtime: { lastError: null, sendMessage(_message, callback) { messages++; callback({ kind: 'error', code: 'backoff', retryAt: Date.now() + 5000 }); } } },
    };
    for (const entry of ['src/opal/native-bridge.ts', 'src/main-world.ts']) {
        const { outputFiles } = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'iife', target: 'es2022' });
        runInNewContext(outputFiles[0].text, context);
    }
    attrs.set('data-opal-click-target', 'login');
    document.dispatchEvent(new Event('opal-safe-click'));
    assert.equal(clicks, 1, 'gesture is executed before any coordinator response');
    await tick(); assert.equal(messages, 1, 'only activity notification, no acquire');
    navigator.userActivation.isActive = false;
    document.dispatchEvent(new Event('opal-safe-click'));
    await tick();
    assert.equal(clicks, 2, 'automatic native action is not dropped on backoff');
    delete navigator.userActivation;
    gestures.get('pointerdown')({ isTrusted: false });
    document.dispatchEvent(new Event('opal-safe-click'));
    await tick(); assert.equal(clicks, 3, 'synthetic events use automatic fail-open path');
    gestures.get('pointerdown')({ isTrusted: true });
    document.dispatchEvent(new Event('opal-safe-click'));
    assert.equal(clicks, 4, 'Firefox trusted gesture runs synchronously without userActivation');
    now += 1001;
    document.dispatchEvent(new Event('opal-safe-click'));
    await tick(); assert.equal(clicks, 5, 'expired fallback still fails open during cooldown');
});

test('requests never iterate a Headers object (Firefox content scripts cannot)', async () => {
    const realHeaders = globalThis.Headers;
    // Firefox: a page-realm Headers whose entries() iterator is not iterable.
    globalThis.Headers = class { constructor() {} has() { return false; } entries() { return {}; } };
    try {
        const c = new OpalCoordinator();
        let seen;
        const gateway = createOpalGateway(async cmd => c.handle(cmd), async (_url, init) => { seen = init.headers; return { ok: true, status: 200, url: 'https://bildungsportal.sachsen.de/opal/x', text: async () => '<a href="/opal/logout"></a>' }; });
        const page = await gateway.fetchHtml('https://bildungsportal.sachsen.de/opal/x', { priority: 'user', headers: { 'Wicket-Ajax': 'true' } });
        assert.equal(page.status, 200);
        assert.equal(seen['Wicket-Ajax'], 'true');
    } finally { globalThis.Headers = realHeaders; }
});

test('Firefox network errors, including body failures and cross-realm errors, pause automatic work',async()=>{
    for(const stage of ['fetch','body','realm']) {
        const c=new OpalCoordinator();let calls=0;
        const gateway=createOpalGateway(async command=>c.handle(command),async()=>{
            calls++;
            if(stage==='realm') throw {name:'TypeError',message:'NetworkError when attempting to fetch resource.'};
            if(stage==='fetch') throw new TypeError('NetworkError when attempting to fetch resource.');
            return {text:async()=>{throw new TypeError('NetworkError while reading response');}};
        });
        await assert.rejects(gateway.fetchHtml(url,{priority:'user',stateful:true}),error=>error.code==='unavailable');
        await assert.rejects(gateway.fetchHtml(url,{priority:'background'}),error=>error.code==='backoff');
        assert.equal(calls,1);
    }
});
