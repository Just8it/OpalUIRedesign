// Minimal Chrome DevTools Protocol client over --remote-debugging-pipe.
// No dependencies: the browser is spawned with two extra stdio pipes
// (fd 3 = browser reads commands, fd 4 = browser writes replies), messages
// are JSON terminated by a NUL byte. Sessions use flat mode (sessionId).

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

export const BROWSERS = {
    chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
};

export function findBrowser(preferred) {
    const order = [preferred, process.env.E2E_BROWSER, 'chrome', 'edge'].filter(Boolean);
    for (const key of order) {
        const p = BROWSERS[key] || key;
        if (p && fs.existsSync(p)) return { name: BROWSERS[key] ? key : 'custom', path: p };
    }
    throw new Error('No Chromium browser found (set E2E_BROWSER to a chrome.exe/msedge.exe path)');
}

export class Browser extends EventEmitter {
    constructor(proc) {
        super();
        this.proc = proc;
        this.nextId = 1;
        this.pending = new Map();
        this.buffer = '';
        this.closed = false;
        this.stderr = '';
        this.out = proc.stdio[3];
        const input = proc.stdio[4];
        input.setEncoding('utf8');
        input.on('data', chunk => this.#onData(chunk));
        proc.stderr?.on('data', d => { this.stderr = (this.stderr + d).slice(-20000); });
        proc.on('exit', code => {
            this.closed = true;
            for (const { reject, method } of this.pending.values()) reject(new Error(`browser exited (${code}) during ${method}`));
            this.pending.clear();
            this.emit('exit', code);
        });
    }

    static async launch({ executable, args = [], userDataDir }) {
        const fullArgs = [
            '--remote-debugging-pipe',
            `--user-data-dir=${userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-sync',
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-default-apps',
            '--metrics-recording-only',
            '--password-store=basic',
            ...args,
            'about:blank',
        ];
        const proc = spawn(executable, fullArgs, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
        const b = new Browser(proc);
        await b.send('Browser.getVersion', {}, null, 15000);
        return b;
    }

    #onData(chunk) {
        this.buffer += chunk;
        let idx;
        while ((idx = this.buffer.indexOf('\0')) >= 0) {
            const raw = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);
            let msg;
            try { msg = JSON.parse(raw); } catch { continue; }
            if (msg.id && this.pending.has(msg.id)) {
                const p = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                clearTimeout(p.timer);
                if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ' ' + msg.error.data : ''}`));
                else p.resolve(msg.result);
            } else if (msg.method) {
                this.emit('event', msg);
                this.emit(msg.method, msg.params, msg.sessionId);
                if (msg.sessionId) this.emit(`${msg.sessionId}:${msg.method}`, msg.params);
            }
        }
    }

    send(method, params = {}, sessionId = null, timeout = 30000) {
        if (this.closed) return Promise.reject(new Error('browser closed'));
        const id = this.nextId++;
        const msg = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
            }, timeout);
            this.pending.set(id, { resolve, reject, method, timer });
            this.out.write(JSON.stringify(msg) + '\0');
        });
    }

    session(sessionId) {
        return new Session(this, sessionId);
    }

    async attach(targetId) {
        const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
        return this.session(sessionId);
    }

    waitForEvent(method, predicate = () => true, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const handler = (params, sessionId) => {
                if (!predicate(params, sessionId)) return;
                clearTimeout(timer);
                this.off(method, handler);
                resolve(params);
            };
            const timer = setTimeout(() => {
                this.off(method, handler);
                reject(new Error(`timeout waiting for ${method}`));
            }, timeout);
            this.on(method, handler);
        });
    }

    async close() {
        if (this.closed) return;
        try { await this.send('Browser.close', {}, null, 5000); } catch { /* ignore */ }
        await new Promise(r => { if (this.closed) r(); else { this.proc.once('exit', r); setTimeout(r, 5000); } });
        if (!this.closed) try { this.proc.kill(); } catch { /* ignore */ }
    }
}

export class Session {
    constructor(browser, id) {
        this.browser = browser;
        this.id = id;
    }
    send(method, params = {}, timeout) {
        return this.browser.send(method, params, this.id, timeout);
    }
    on(method, handler) {
        this.browser.on(`${this.id}:${method}`, handler);
    }
    off(method, handler) {
        this.browser.off(`${this.id}:${method}`, handler);
    }
    waitFor(method, predicate = () => true, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const handler = params => {
                if (!predicate(params)) return;
                clearTimeout(timer);
                this.off(method, handler);
                resolve(params);
            };
            const timer = setTimeout(() => {
                this.off(method, handler);
                reject(new Error(`timeout waiting for ${method}`));
            }, timeout);
            this.on(method, handler);
        });
    }
    /** Runtime.evaluate with awaitPromise + returnByValue; throws on exceptions. */
    async eval(expression, { contextId, timeout = 30000 } = {}) {
        const params = { expression, awaitPromise: true, returnByValue: true, userGesture: true };
        if (contextId) params.contextId = contextId;
        const r = await this.send('Runtime.evaluate', params, timeout);
        if (r.exceptionDetails) {
            const d = r.exceptionDetails;
            throw new Error(`eval failed: ${d.exception?.description || d.text}`);
        }
        return r.result.value;
    }
}

export function describeException(details) {
    if (!details) return '';
    const desc = details.exception?.description || details.exception?.value || details.text || '';
    const where = details.url ? ` @ ${details.url}:${details.lineNumber + 1}:${details.columnNumber + 1}` : '';
    return `${desc}${where}`.slice(0, 600);
}

export function formatConsole(params) {
    const text = (params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
    const frame = params.stackTrace?.callFrames?.[0];
    const where = frame ? ` @ ${frame.url}:${frame.lineNumber + 1}` : '';
    return `[${params.type}] ${text}${where}`.slice(0, 600);
}
