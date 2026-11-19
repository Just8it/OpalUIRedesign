/** Cross-tab claims, decided by the background script, which is the single serializer in Chrome and Firefox.
 *  Storage change events reach every open OPAL tab at once, so a request that should run once has to be
 *  claimed here first. */
export type ClaimJob = 'refresh' | 'catalog' | 'preload';
export const CLAIM_TYPE = 'opal-claim';
export interface ClaimMessage { type: typeof CLAIM_TYPE; job: ClaimJob; token?: number | string; release?: boolean }

/** A job without a release inside this window (closed tab) can be claimed again. */
const LEASE_MS: Record<ClaimJob, number> = { refresh: 0, catalog: 15 * 60_000, preload: 5 * 60_000 };
/** A second tab reacting to the same storage change arrives within this window and is turned away. */
const DEDUPE_MS = 10_000;

export function isClaimMessage(value: unknown): value is ClaimMessage {
    const message = value as Partial<ClaimMessage> | null;
    return !!message && typeof message === 'object' && message.type === CLAIM_TYPE
        && (message.job === 'refresh' || message.job === 'catalog' || message.job === 'preload');
}

export function createClaims(now: () => number = Date.now) {
    const lastToken = new Map<ClaimJob, string>();
    const grantedAt = new Map<ClaimJob, number>();
    const leaseUntil = new Map<ClaimJob, number>();
    return (message: ClaimMessage): boolean => {
        const { job } = message;
        if (message.release) { leaseUntil.delete(job); return true; }
        const at = now();
        if (job === 'refresh') {
            // One grant per request token: the key holds the time of the request, so a new request has a new token.
            const token = String(message.token ?? '');
            if (!token || lastToken.get(job) === token) return false;
            lastToken.set(job, token);
            return true;
        }
        if ((leaseUntil.get(job) ?? 0) > at) return false;
        if (at - (grantedAt.get(job) ?? -Infinity) < DEDUPE_MS) return false;
        grantedAt.set(job, at);
        leaseUntil.set(job, at + LEASE_MS[job]);
        return true;
    };
}
