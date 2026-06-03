/* ━━ MAIN World Helper ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Runs in the page's JS context (world: "MAIN") so it can
 * execute clicks on javascript: hrefs without CSP violations.
 * The content script passes the target ID through a DOM attribute because
 * Firefox blocks direct access to CustomEvent.detail objects across worlds.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

document.addEventListener('opal-safe-click', (() => {
    const tempId = document.documentElement.getAttribute('data-opal-click-target');
    if (!tempId) return;
    const el = document.getElementById(tempId);
    if (el) el.click();
}) as EventListener);
