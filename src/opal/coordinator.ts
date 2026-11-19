export type Priority = 'user' | 'view' | 'background';
export type ErrorCode = 'session' | 'expired' | 'unavailable' | 'backoff' | 'timeout' | 'coordinator';
export class OpalError extends Error {
    code: ErrorCode;
    retryAt: number;
    constructor(code: ErrorCode, message: string, retryAt = 0) { super(message); this.name = 'OpalError'; this.code = code; this.retryAt = retryAt; }
}
export interface HtmlPage { text: string; url: string; status: number }
export interface Ticket { id: string; priority: Priority; stateful: boolean; timeoutMs: number; key?: string }
interface Job extends Ticket { order: number; expires: number; active: boolean; result?: HtmlPage }
export interface GatewayState { jobs: Job[]; sequence: number; failures: number; retryAt: number; userActiveUntil?: number }
export type Reply = { kind: 'wait' } | { kind: 'grant'; expires: number } | { kind: 'result'; page: HtmlPage } | { kind: 'error'; code: ErrorCode; retryAt: number };
export type Command = { op: 'activity'; recovered?: boolean } | { op: 'acquire'; ticket: Ticket } | { op: 'release'; id: string; page?: HtmlPage; failure?: ErrorCode };
export const initialState = (): GatewayState => ({ jobs: [], sequence: 0, failures: 0, retryAt: 0 });
const rank: Record<Priority, number> = { user: 0, view: 1, background: 2 };

/** Pure, clock-injected lease scheduler. The background persists every transition before replying. */
export class OpalCoordinator {
    state: GatewayState;
    private now: () => number;
    private limit: number;
    constructor(state = initialState(), now = Date.now, limit = 2) { this.state = state; this.now = now; this.limit = limit; }
    handle(command: Command): Reply {
        const now = this.now();
        this.state.jobs = this.state.jobs.filter(j => j.expires > now);
        if (command.op === 'activity') {
            this.state.userActiveUntil = now + 1000;
            if (command.recovered) { this.state.retryAt = 0; this.state.failures = 0; }
            return { kind: 'wait' };
        }
        if (command.op === 'release') {
            const job = this.state.jobs.find(j => j.id === command.id && j.active);
            if (job) {
                if (command.failure && ['session', 'expired', 'unavailable'].includes(command.failure)) {
                    this.state.failures = Math.min(10, this.state.failures + 1);
                    this.state.retryAt = now + Math.min(300_000, 5000 * 2 ** (this.state.failures - 1));
                } else if (command.page && (job.priority === 'user' || now >= this.state.retryAt)) {
                    // A page the user asked for arrived: the session works, so the pause ends.
                    if (job.priority === 'user') this.state.retryAt = 0;
                    this.state.failures = 0;
                }
                // Only callers that joined the in-flight GET receive its result; this is not a cache.
                if (job.key && command.page) for (const other of this.state.jobs) {
                    if (!other.active && other.key === job.key) {
                        other.result = command.page;
                        other.expires = now + 5000;
                    }
                }
            }
            this.state.jobs = this.state.jobs.filter(j => j.id !== command.id);
            return { kind: 'wait' };
        }
        const t = command.ticket;
        let job = this.state.jobs.find(j => j.id === t.id);
        if (job?.result) {
            this.state.jobs = this.state.jobs.filter(j => j !== job);
            return { kind: 'result', page: job.result };
        }
        if (job?.active) return { kind: 'grant', expires: job.expires };
        // During cooldown automatic work fails fast (no retry storm). What the user asked for
        // right now still runs: a failure seen by background work must not lock them out.
        if (now < this.state.retryAt && t.priority !== 'user') {
            this.state.jobs = this.state.jobs.filter(j => j.id !== t.id);
            return { kind: 'error', code: 'backoff', retryAt: this.state.retryAt };
        }
        if (!job) {
            job = { ...t, order: this.state.sequence++, active: false, expires: now + 5000 };
            this.state.jobs.push(job);
        } else if (job.expires - now < 3000) job.expires = now + 5000;
        const active = this.state.jobs.filter(j => j.active);
        const queued = this.state.jobs.filter(j => !j.active && !j.result).sort((a, b) => rank[a.priority] - rank[b.priority] || a.order - b.order);
        const next = queued.find(j => !active.some(a => a.key && a.key === j.key));
        if ((job.priority === 'background' && (queued.some(j => j.priority === 'user') || now < (this.state.userActiveUntil ?? 0))) || next !== job || active.length >= this.limit || active.some(j => j.stateful) || (job.stateful && active.length)) return { kind: 'wait' };
        job.active = true;
        job.expires = now + job.timeoutMs + 2000; // client aborts first; crashed tabs cannot keep a permit
        return { kind: 'grant', expires: job.expires };
    }
}

export function responseFailure(url: string, text: string, status = 200): ErrorCode | undefined {
    try { if (new URL(url, 'https://bildungsportal.sachsen.de').origin !== 'https://bildungsportal.sachsen.de') return 'session'; } catch { return 'session'; }
    if (status === 429 || status >= 500) return 'unavailable';
    if (status === 401 || status === 403 || /\/opal\/(?:login|shiblogin)(?:[/?;]|$)/i.test(url)) return 'session';
    // A signed-in OPAL page always carries the logout control. Pages that merely contain a
    // password field (enrolment key, protected course element) or a login form are not
    // a lost session as long as it is there.
    const signedIn = /logout/i.test(text);
    if (!signedIn && (/<input\b[^>]*type\s*=\s*["']password["']/i.test(text)
        || /<form\b[^>]*(?:login|shiblogin)|<button\b[^>]*name=["'][^"']*shibLogin/i.test(text)
        || /(?:session (?:has )?expired|sitzung (?:ist )?abgelaufen)/i.test(text))) return 'session';
    if (/(?:PageExpiredException|StalePageException|<title[^>]*>[^<]*(?:page expired|seite abgelaufen)|<h[1-3][^>]*>[^<]*(?:page expired|seite abgelaufen))/i.test(text)) return 'expired';
    if (/<redirect\b[^>]*>\s*(?:<!\[CDATA\[)?[^<]*(?:PageExpired|pageExpired|\/login|\/shiblogin)/i.test(text)) return 'expired';
    return undefined;
}
