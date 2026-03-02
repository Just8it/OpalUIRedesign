/* ━━ MAIN World Helper ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Runs in the page's JS context (world: "MAIN") so it can
 * execute clicks on javascript: hrefs without CSP violations.
 * Communicates with the content script via CustomEvents.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

document.addEventListener('opal-safe-click', ((e: CustomEvent<{ tempId: string }>) => {
    const el = document.getElementById(e.detail.tempId);
    console.log('[OPAL main-world] opal-safe-click received, tempId:', e.detail.tempId, 'element found:', !!el, el);
    if (el) {
        el.click();
        console.log('[OPAL main-world] click() called on element');
    } else {
        console.warn('[OPAL main-world] element not found by id:', e.detail.tempId);
    }
}) as EventListener);
