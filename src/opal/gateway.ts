/**
 * Execute in the OPAL content origin: cookies and Firefox container/session identity
 * remain the same as the visible page. The extension background ONLY arbitrates
 * leases, persisting transitions in storage.local (also available on Firefox).
 * Polling tickets survive MV3 suspension; leases and abandoned queue entries expire.
 * User/view requests fall back to a per-tab stateful semaphore if messaging fails.
 */
import { OpalError, responseFailure, type Command, type HtmlPage, type Priority, type Reply } from './coordinator.ts';
export { OpalError } from './coordinator.ts';
export interface Options { priority?: Priority; signal?: AbortSignal; stateful?: boolean; timeoutMs?: number }
export interface FetchOptions extends Options { headers?: Record<string, string>; redirect?: RequestRedirect; method?: 'GET' | 'HEAD'; cache?: RequestCache }
export const CHANNEL = 'opal-gateway-v1';
type Transport = (command: Command) => Promise<Reply>;
const runtimeTransport: Transport = command => new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) { reject(new OpalError('coordinator', 'OPAL coordinator unavailable')); return; }
    chrome.runtime.sendMessage({ channel: CHANNEL, command }, (reply: Reply) => {
        const error = chrome.runtime.lastError;
        if (error || !reply || !['wait', 'grant', 'result', 'error'].includes(reply.kind)) reject(new OpalError('coordinator', error?.message ?? 'OPAL coordinator unavailable'));
        else resolve(reply);
    });
});
function pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
        signal.addEventListener('abort', abort, { once: true });
    });
}
let localTail: Promise<void> = Promise.resolve();
let warned = false;
export function createOpalGateway(transport: Transport = runtimeTransport, fetcher: typeof fetch = (...args) => fetch(...args)) {
    async function send(command: Command): Promise<Reply> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([Promise.resolve().then(() => transport(command)), new Promise<Reply>((_, reject) => {
                timer = setTimeout(() => reject(new OpalError('coordinator', 'OPAL coordinator did not respond')), 1000);
            })]);
        } catch (error) { throw new OpalError('coordinator', String(error)); }
        finally { clearTimeout(timer); }
    }
    async function run<T>(work: (signal: AbortSignal) => Promise<T>, options: Options = {}, key?: string, pageResult = false): Promise<T> {
        const id = crypto.randomUUID();
        const timeoutMs = Math.min(300_000, Math.max(1, options.timeoutMs ?? 30_000));
        const controller = new AbortController();
        const abort = () => controller.abort(options.signal?.reason);
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        const timer = setTimeout(() => controller.abort(new OpalError('timeout', 'OPAL request timed out')), timeoutMs);
        let page: HtmlPage | undefined, failure: import('./coordinator.ts').ErrorCode | undefined;
        let unlock: (() => void) | undefined;
        let coordinated = false;
        try {
            while (true) {
                controller.signal.throwIfAborted();
                let reply: Reply;
                try {
                    reply = await send({ op: 'acquire', ticket: { id, key, timeoutMs, priority: options.priority ?? 'view', stateful: options.stateful ?? false } });
                    if (reply.kind === 'error' && reply.code === 'coordinator') throw new OpalError('coordinator', 'OPAL coordinator unavailable');
                } catch (error) {
                    if (options.priority === 'background') throw error;
                    if (!warned) { warned = true; console.warn('[OPAL gateway] Coordinator unavailable; using local user/view queue'); }
                    const previous = localTail;
                    localTail = new Promise<void>(resolve => { unlock = resolve; });
                    // Keep our place until the predecessor finishes, even if aborted.
                    await previous;
                    controller.signal.throwIfAborted();
                    break;
                }
                controller.signal.throwIfAborted();
                if (reply.kind === 'error') throw new OpalError(reply.code, 'OPAL requests paused; session/server needs recovery', reply.retryAt);
                if (reply.kind === 'result') return reply.page as T;
                if (reply.kind === 'grant') { coordinated = true; break; }
                await pause(100, controller.signal);
            }
            // Race also bounds work implementations that neglect their signal.
            const result = await new Promise<T>((resolve, reject) => {
                const onAbort = () => reject(controller.signal.reason);
                controller.signal.addEventListener('abort', onAbort, { once: true });
                Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal); }).then(resolve, reject)
                    .finally(() => controller.signal.removeEventListener('abort', onAbort));
            });
            if (pageResult) page = result as HtmlPage;
            return result;
        } catch (error) {
            if (error instanceof OpalError) failure = error.code;
            throw error;
        } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            unlock?.();
            // Do not delay local work on another unreachable coordinator call.
            if (coordinated) await send({ op: 'release', id, page, failure }).catch(() => undefined);
            else void send({ op: 'release', id }).catch(() => undefined);
        }
    }
    return {
        run,
        notifyActivity(recovered = false): void { void send({ op: 'activity', recovered }).catch(() => undefined); },
        fetchHtml(url: string, options: FetchOptions = {}): Promise<HtmlPage> {
            const target = new URL(url, 'https://bildungsportal.sachsen.de');
            if (target.origin !== 'https://bildungsportal.sachsen.de' || !/^\/opal(?:\/|$)/.test(target.pathname) || target.username || target.password) return Promise.reject(new OpalError('coordinator', 'Invalid OPAL URL'));
            target.hash = '';
            // Plain object on purpose: in Firefox content scripts a Headers object comes from the
            // page realm and its entries() iterator is not iterable ("s.entries() is not iterable").
            const headers: Record<string, string> = {};
            for (const name of Object.keys(options.headers ?? {})) headers[name] = String(options.headers?.[name]);
            const ajax = Object.keys(headers).some(name => name.toLowerCase() === 'wicket-ajax');
            const stateful = options.stateful || /[?&](?:\d+(?:-\d+)?(?:\.|&|$)|[^=&]*I(?:Link|Behavior)Listener)|wicket:interface|wicket\/page/i.test(target.href) || ajax;
            const listener = /I(?:Link|Behavior)Listener|wicket:interface/i.test(target.href) || ajax;
            const key = options.method === 'HEAD' || listener ? undefined : JSON.stringify([target.href, Object.keys(headers).map(name => [name.toLowerCase(), headers[name]]).sort(), options.redirect ?? 'follow', options.cache ?? 'default']);
            return run(async signal => {
                let response: Response;
                let text: string;
                try {
                    response = await fetcher(target.href, { method: options.method ?? 'GET', credentials: 'include', signal, headers, redirect: options.redirect ?? 'follow', cache: options.cache });
                    text = await response.text();
                } catch (error) {
                    signal.throwIfAborted();
                    if (error instanceof TypeError || error && typeof error === 'object' && 'name' in error && error.name === 'TypeError') {
                        throw new OpalError('unavailable', `OPAL network request failed: ${String(error)}`);
                    }
                    throw error;
                }
                const failure = responseFailure(response.url || target.href, text, response.status);
                if (failure) throw new OpalError(failure, `OPAL ${failure} (${response.status})`);
                if (!response.ok) throw new Error(`OPAL HTTP ${response.status}`);
                return { text, url: response.url || target.href, status: response.status };
            }, { ...options, stateful }, key, true);
        },
    };
}
export const opal = createOpalGateway();
