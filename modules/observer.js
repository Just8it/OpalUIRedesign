/**
 * observer.js — MutationObserver bridge
 * 
 * Monitors the #wrap container for Wicket's AJAX DOM replacements
 * and re-triggers the scrape → render cycle when changes occur.
 */

/**
 * Starts watching #wrap for child/subtree mutations.
 * Uses a 150ms debounce to batch rapid Wicket updates.
 * 
 * @param {Function} onChangeCallback — called after debounce when DOM changes
 * @returns {MutationObserver|null}
 */
export function initObserver(onChangeCallback) {
    const target = document.getElementById('wrap');
    if (!target) {
        console.warn('[OPAL Redesign] #wrap not found — observer not started.');
        return null;
    }

    let debounceTimer = null;

    const observer = new MutationObserver((mutations) => {
        // Ignore mutations caused by our own injected UI elements
        const isOwnMutation = mutations.every(m =>
            m.target.closest?.('#opal-modern-ui') ||
            m.target.closest?.('.opal-stitch-sidebar') ||
            m.target.closest?.('.opal-stitch-hero')
        );
        if (isOwnMutation) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(onChangeCallback, 150);
    });

    observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: false,
    });

    console.log('[OPAL Redesign] MutationObserver active on #wrap');
    return observer;
}
