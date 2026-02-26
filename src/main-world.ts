/* ━━ MAIN World Helper ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Runs in the page's JS context (world: "MAIN") so it can
 * execute clicks on javascript: hrefs without CSP violations.
 * Communicates with the content script via CustomEvents.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

document.addEventListener('opal-safe-click', ((e: CustomEvent<{ tempId: string }>) => {
    const el = document.getElementById(e.detail.tempId);
    if (el) el.click();
}) as EventListener);
