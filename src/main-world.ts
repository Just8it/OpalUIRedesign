import { responseFailure } from './opal/coordinator';
/* ━━ MAIN World Helper ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Runs in the page's JS context (world: "MAIN") so it can
 * execute clicks on javascript: hrefs without CSP violations.
 * The content script passes the target ID through a DOM attribute because
 * Firefox blocks direct access to CustomEvent.detail objects across worlds.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { matchesComponentSuffix, parseWicketRegistrations, pruneStaleIds } from './core/wicket-registry';

const registry = new Map<string, string>();
const debugEnabled = () => document.documentElement.hasAttribute('data-opal-wicket-debug');
const prune = () => pruneStaleIds(registry, id => document.getElementById(id) !== null);
function record(id: string, path: string): void {
    registry.set(id, path);
    if (debugEnabled()) console.log('[OPAL Wicket]', id, path, document.getElementById(id)?.textContent?.trim() ?? '(not mounted yet)');
}

type AjaxFunction = (...args: unknown[]) => unknown;
const wicket = (window as Window & { Wicket?: { Ajax?: { ajax?: AjaxFunction; redirect?: AjaxFunction } } }).Wicket;
const courseOwnsPage = () => window === window.top && document.documentElement.hasAttribute('data-opal-course-active');
if (wicket?.Ajax?.ajax) {
    const original = wicket.Ajax.ajax;
    wicket.Ajax.ajax = function (this: unknown, ...args: unknown[]): unknown {
        try {
            const attrs = args[0] as { c?: string; u?: string } | undefined;
            // Native Wicket timers have no component target. Their old page version
            // can redirect the visible document while the course loader fetches newer pages.
            if (courseOwnsPage() && typeof attrs?.u === 'string' && !attrs.c) return;
            prune();
            if (typeof attrs?.c === 'string' && typeof attrs.u === 'string') record(attrs.c, attrs.u);
        } catch { /* Bookkeeping must never affect Wicket. */ }
        return original.apply(this, args);
    };
}
if (wicket?.Ajax?.redirect) {
    const original = wicket.Ajax.redirect;
    wicket.Ajax.redirect = function (this: unknown, ...args: unknown[]): unknown {
        if (courseOwnsPage() && typeof args[0] === 'string') {
            try {
                const target = new URL(args[0], location.href);
                const course = /\/RepositoryEntry\/(\d+)(?:\/|$)/.exec(location.pathname)?.[1];
                if (course && target.origin === location.origin
                    && /\/RepositoryEntry\/(\d+)(?:\/|$)/.exec(target.pathname)?.[1] === course) return;
            } catch { /* Invalid addresses keep Wicket's own handling. */ }
        }
        return original.apply(this, args);
    };
}
for (const script of document.querySelectorAll('script:not([src])')) {
    for (const entry of parseWicketRegistrations(script.textContent ?? '')) record(entry.id, entry.path);
}
prune();
// AJAX replacement can remove nodes without registering a new control.
new MutationObserver(prune).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('opal-wicket-dump', () => {
    prune();
    for (const [id, path] of registry) console.log('[OPAL Wicket]', id, path, document.getElementById(id)?.textContent?.trim());
});
document.addEventListener('opal-component-click', () => {
    const root = document.documentElement;
    root.setAttribute('data-opal-component-found', 'false');
    try {
        const request = JSON.parse(root.getAttribute('data-opal-component-request') ?? '{}') as { suffixes?: string[]; scope?: string };
        if (!Array.isArray(request.suffixes)) return;
        const scope = request.scope ? [...document.querySelectorAll('[data-opal-component-scope]')].find(el => el.getAttribute('data-opal-component-scope') === request.scope) : document;
        if (!scope) return;
        prune();
        for (const suffix of request.suffixes) for (const [id, path] of registry) {
            const element = document.getElementById(id);
            if (element?.isConnected && scope.contains(element) && matchesComponentSuffix(path, suffix)) {
                root.setAttribute('data-opal-component-found', 'true');
                gatewayClick(element);
                return;
            }
        }
    } catch { /* Missing bridge data must leave fallback behavior available. */ }
});

document.addEventListener('opal-safe-click', (() => {
    const tempId = document.documentElement.getAttribute('data-opal-click-target');
    if (!tempId) return;
    const el = document.getElementById(tempId);
    if (el) gatewayClick(el);
}) as EventListener);

let trustedGestureAt = -Infinity;
for (const type of ['pointerdown', 'keydown', 'click']) document.addEventListener(type, event => {
    if (event.isTrusted) trustedGestureAt = Date.now();
}, true);
const hasGesture = () => navigator.userActivation?.isActive ?? (Date.now() - trustedGestureAt <= 1000);

/** Indexer frames are scheduled by their caller, one bounded step at a time. */
function gatewayClick(element: HTMLElement): void {
    if (window !== window.top) { element.click(); return; }
    const root = document.documentElement;
    if (hasGesture()) {
        document.dispatchEvent(new Event('opal-gateway-user-activity'));
        element.click();
        return;
    }
    const token = crypto.randomUUID();
    let started = false;
    const grant = () => {
        if (root.getAttribute('data-opal-gateway-token') !== token) return;
        if (started) return;
        started = true;
        clearTimeout(expire);
        document.removeEventListener('opal-gateway-native-grant', grant);
        // Track completion, not a fixed delay: Wicket may replace several components.
        const original = XMLHttpRequest.prototype.send;
        let pending = 0, quiet = Date.now(), failure = '', finished = false;
        const requests = new Set<XMLHttpRequest>();
        const wrapped: typeof original = function (this: XMLHttpRequest, body) {
            pending++; requests.add(this);
            this.addEventListener('loadend', () => {
                requests.delete(this); pending--; quiet = Date.now();
                try { failure ||= responseFailure(this.responseURL, this.responseType === '' || this.responseType === 'text' ? this.responseText : '', this.status) ?? ''; } catch { /* non-text response */ }
            }, { once: true });
            try { original.call(this, body); } catch (error) { pending--; throw error; }
        };
        XMLHttpRequest.prototype.send = wrapped;
        const startedAt = Date.now();
        const cancel = () => {
            if (root.getAttribute('data-opal-gateway-token') === token) { failure ||= 'timeout'; finish(); }
        };
        const finish = () => {
            if (finished) return;
            finished = true;
            // Native traffic may include a new user gesture; never cancel it.
            document.removeEventListener('opal-gateway-native-cancel', cancel);
            clearInterval(timer);
            if (XMLHttpRequest.prototype.send === wrapped) XMLHttpRequest.prototype.send = original;
            root.setAttribute('data-opal-gateway-token', token);
            root.setAttribute('data-opal-gateway-failure', failure);
            document.dispatchEvent(new Event('opal-gateway-native-done'));
        };
        document.addEventListener('opal-gateway-native-cancel', cancel);
        const timer = setInterval(() => {
            if (Date.now() - startedAt >= 29_000) { failure ||= 'timeout'; finish(); }
            else if (!pending && Date.now() - quiet >= 300) finish();
        }, 100);
        try { element.click(); } catch { finish(); }
    };
    const expire = setTimeout(() => {
        root.setAttribute('data-opal-gateway-token', token);
        grant(); // A missing content bridge must never swallow an automatic action.
    }, 1500);
    document.addEventListener('opal-gateway-native-ack', () => clearTimeout(expire), { once: true });
    document.addEventListener('opal-gateway-native-grant', grant);
    root.setAttribute('data-opal-gateway-token', token);
    root.setAttribute('data-opal-gateway-priority', hasGesture() ? 'user' : 'view');
    document.dispatchEvent(new Event('opal-gateway-native-request'));
}
