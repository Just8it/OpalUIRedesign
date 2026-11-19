import { opal } from './gateway.ts';
/** Reacquire between navigations so queued user work runs before the next step. */
export function createBackgroundStepper(frame: Pick<HTMLIFrameElement, 'remove'>, gateway = opal) {
    return <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => gateway.run(async signal => {
        const abort = () => frame.remove();
        signal.addEventListener('abort', abort, { once: true });
        try { return await work(signal); }
        finally { signal.removeEventListener('abort', abort); }
    }, { priority: 'background', stateful: true, timeoutMs: 15_000 });
}
