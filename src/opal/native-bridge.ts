/** DOM strings cross Firefox's isolated-world boundary; no page-supplied URL is fetched. */
import { opal, OpalError } from './gateway.ts';
import type { ErrorCode } from './coordinator.ts';
if (typeof document !== 'undefined' && window === window.top) {
    document.addEventListener('opal-gateway-user-activity', () => opal.notifyActivity());
    // A successful full-page login replaces this content script. Only authenticated
    // native controls establish recovery; seeing a login form never clears cooldown.
    const recovered = () => {
        if (!document.querySelector('a[href*="logout"], [name*="logout"], [name*="Logout"], .header-functions-user .icon-logout')) return;
        opal.notifyActivity(true);
        observer.disconnect();
    };
    const observer = new MutationObserver(recovered);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    recovered();
    document.addEventListener('opal-gateway-native-request', () => {
        const token = document.documentElement.getAttribute('data-opal-gateway-token');
        if (!token || !/^[a-z0-9-]{1,100}$/i.test(token)) return;
        const priority = document.documentElement.getAttribute('data-opal-gateway-priority') === 'user' ? 'user' : 'view';
        document.dispatchEvent(new Event('opal-gateway-native-ack'));
        let started = false;
        void opal.run(signal => new Promise<void>((resolve, reject) => {
            const root = document.documentElement;
            const cleanup = () => { document.removeEventListener('opal-gateway-native-done', done); signal.removeEventListener('abort', abort); };
            const done = () => {
                if (root.getAttribute('data-opal-gateway-token') !== token) return;
                const failure = root.getAttribute('data-opal-gateway-failure') as ErrorCode | null;
                cleanup();
                if (failure) reject(new OpalError(failure, 'OPAL native action failed')); else resolve();
            };
            const abort = () => {
                root.setAttribute('data-opal-gateway-token', token);
                document.dispatchEvent(new Event('opal-gateway-native-cancel'));
                cleanup(); reject(signal.reason);
            };
            document.addEventListener('opal-gateway-native-done', done);
            signal.addEventListener('abort', abort, { once: true });
            root.setAttribute('data-opal-gateway-token', token);
            started = true;
            document.dispatchEvent(new Event('opal-gateway-native-grant'));
        }), { priority, stateful: true }).catch(error => {
            console.warn('[OPAL gateway] Native coordination failed', error);
            if (!started) {
                document.documentElement.setAttribute('data-opal-gateway-token', token);
                document.dispatchEvent(new Event('opal-gateway-native-grant'));
            }
        });
    });
}
