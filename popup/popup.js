/**
 * popup.js — Extension popup logic
 * 
 * Persists the on/off state to chrome.storage.local and
 * reloads the active OPAL tab when toggled.
 */

const toggle = document.getElementById('toggleEnabled');

// Load saved state
chrome.storage.local.get(['opalRedesignEnabled'], (result) => {
    toggle.checked = result.opalRedesignEnabled !== false; // default: on
});

// Save state on toggle
toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ opalRedesignEnabled: enabled }, () => {
        // Reload the active OPAL tab to apply/remove the redesign
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.url?.includes('bildungsportal.sachsen.de/opal')) {
                chrome.tabs.reload(tabs[0].id);
            }
        });
    });
});
