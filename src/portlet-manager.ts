import { clickNativeComponent, NATIVE_COMPONENTS } from './native-controls';
/**
 * Utility to silently activate/deactivate native OPAL portlets in the
 * background when a user shows or hides a widget in the modern UI.
 *
 * Add flow:
 * 1. Check if the portlet is already in the DOM via data-portlet-order
 * 2. If missing, open OPAL's "Add Portlets" dialog via safeClick
 * 3. Find the portlet entry in the dialog by its German UI title
 * 4. Click "Hinzufügen" and wait for the dialog to close
 *
 * Remove flow:
 * 1. Check if the portlet is in the DOM
 * 2. Find the delete button inside its header (title varies by OPAL version)
 * 3. Click it via safeClick and wait for the element to leave the DOM
 */

import { safeClick } from './settings';

/**
 * Maps OPAL data-portlet-order values → German UI title shown in the
 * "Add Portlets" dialog. These must match exactly what OPAL renders.
 * Update this map if the dialog shows different text.
 */
const PORTLET_NATIVE_TITLES: Record<string, string> = {
    'Bookmarks':                'Favoriten',
    'RepositoryPortletStudent': 'Meine Kurse',
    'Calendar':                 'Meine Termine',
    'InfoMessages':             'Kursnews',
    'EfficiencyStatements':     'Leistungsnachweis',
    'FirstStepsPortlet':        'Erste Schritte',
    'InstitutionPortlet':       'Meine Institution',   // dialog title confirmed; key may still need updating
    'Groups':                   'Meine Gruppen',
    'LastUsedRepositoryPortlet': 'Zuletzt geöffnet',
    'Information':              'Aktuelles',
};

/**
 * Titles the "Add Portlets" dialog uses when they differ from the portlet
 * heading above. Checked on the live site: the dialog entries have no
 * language-independent identifier (their Wicket path is only a list index,
 * `addPortletLv-N-addPortletButton-btn`), so the title is the only anchor.
 */
const PORTLET_DIALOG_TITLE_ALIASES: Record<string, string[]> = {
    'RepositoryPortletStudent': ['Kurse, an denen ich teilnehme'],
};

/**
 * Ensures a native OPAL portlet is active in the DOM.
 * Silently adds it via the "Add Portlets" dialog if missing.
 *
 * @param portletOrder  The data-portlet-order value (e.g. "Calendar")
 * @returns true if the portlet is (or becomes) available, false on failure
 */
export async function ensurePortlet(portletOrder: string): Promise<boolean> {
    const nativeTitle = PORTLET_NATIVE_TITLES[portletOrder];

    // Synthetic widgets (e.g. "stats") have no OPAL backing portlet — skip
    if (!nativeTitle) {
        console.log(`[PortletManager] "${portletOrder}" is synthetic, skipping auto-activation.`);
        return true;
    }

    // 1. Check if the portlet is genuinely active.
    // After "Verstecken", OPAL keeps the div[data-portlet-order] wrapper in the DOM but
    // empties it — the inner section.panel.portlet disappears. We check for that inner
    // panel so a bare empty wrapper doesn't fool us into skipping the add.
    const allOrders = () => Array.from(document.querySelectorAll('[data-portlet-order]'))
        .map(el => el.getAttribute('data-portlet-order'));

    const portletPanel = document.querySelector(
        `div[data-portlet-order="${portletOrder}"] section.panel.portlet`
    );
    if (portletPanel) {
        console.log(`[PortletManager] ✓ Portlet "${portletOrder}" already active in DOM.`);
        return true;
    }

    console.log(
        `[PortletManager] Portlet "${portletOrder}" missing — attempting to add "${nativeTitle}".`,
        `Current live orders: [${allOrders().join(', ')}]`
    );

    // 2. Find the "Add Portlets" button. If the dialog is already on screen
    // (left over from the previous add), use it instead of opening another.
    const alreadyOpen = addPortletDialogs().length > 0;
    const openedByPath = alreadyOpen || clickNativeComponent(NATIVE_COMPONENTS.addPortletDialog);
    // Structure first (checked on the live site: the header's right-hand area
    // holds the add button with a plus icon and a help dropdown), title last.
    const addMenuBtn = document.querySelector<HTMLElement>(
            '.main-header-additional .additional-right button:not(.dropdown-toggle) .icon-plus'
        )?.closest<HTMLButtonElement>('button')
        ?? document.querySelector<HTMLButtonElement>(
            'button[title="Portlet hinzufügen"], button[title="Add portlet"]'
        );

    if (!openedByPath && !addMenuBtn) {
        console.warn('[PortletManager] ✗ Could not find native "Add Portlets" button. Is user on Startseite?');
        return false;
    }

    console.log('[PortletManager] Found "Add Portlets" button, clicking...');

    // 3. Open the dialog via safeClick (bypasses CSP for Wicket AJAX links)
    if (!openedByPath && addMenuBtn) safeClick(addMenuBtn);

    try {
        // 4. Wait for the dialog to render
        console.log('[PortletManager] Waiting for Add Portlets dialog...');
        const dialog = await waitForDialog();
        console.log('[PortletManager] Dialog opened.');

        // Log all available portlet titles so mismatches are easy to spot
        const allTitles = Array.from(dialog.querySelectorAll('.content-preview strong'))
            .map(el => el.textContent?.trim())
            .filter(Boolean);
        console.log('[PortletManager] Available portlets in dialog:', allTitles);

        // 5. Find the target portlet entry by its German title
        const addedByPath = clickNativeComponent(NATIVE_COMPONENTS[`addPortlet:${portletOrder}`] ?? [], dialog);
        if (addedByPath) { await finishAdd(portletOrder, titlesFor(portletOrder)); return true; }
        const previews = dialog.querySelectorAll('.content-preview');
        let targetButton: HTMLButtonElement | null = null;

        for (const preview of Array.from(previews)) {
            const strongTitle = preview.querySelector('strong');
            const entryTitle = strongTitle?.textContent?.trim() ?? '';
            if (entryTitle === nativeTitle || (PORTLET_DIALOG_TITLE_ALIASES[portletOrder] ?? []).includes(entryTitle)) {
                targetButton = preview.querySelector<HTMLButtonElement>(
                    'button[title="Hinzufügen"], button[title="Add"]'
                );
                break;
            }
        }

        if (!targetButton) {
            console.warn(
                `[PortletManager] ✗ Could not find "${nativeTitle}" in the dialog.`,
                `Available: [${allTitles.join(', ')}]`
            );
            // Close dialog gracefully
            await closeAddPortletDialogs();
            return false;
        }

        console.log(`[PortletManager] Found "${nativeTitle}", clicking Hinzufügen...`);

        // 6. Click the "Add" button
        safeClick(targetButton);

        // 7. Wait until OPAL has taken the add, then close the dialog ourselves.
        // OPAL does not reliably close it: it re-renders the dialog with the
        // remaining portlets, which replaces the dialog element, so "the element
        // we clicked in is gone" does not mean "the dialog is closed".
        await finishAdd(portletOrder, titlesFor(portletOrder));

        console.log(`[PortletManager] ✓ Portlet "${portletOrder}" successfully added.`);
        return true;

    } catch (error) {
        console.error(`[PortletManager] ✗ Failed to add portlet "${portletOrder}":`, error);
        // Force-close whichever dialog is actually on screen
        await closeAddPortletDialogs();
        return false;
    }
}

/**
 * Silently removes a native OPAL portlet from the DOM.
 *
 * OPAL uses a Bootstrap dropdown in the portlet header with items like
 * "Verstecken" and "Konfigurieren" (no title attribute — matched by text content).
 * Flow: open the dropdown toggle → find "Verstecken" by text → safeClick it.
 *
 * @param portletOrder  The data-portlet-order value (e.g. "Calendar")
 * @returns true if the portlet is (or becomes) absent, false on failure
 */
export async function removePortlet(portletOrder: string): Promise<boolean> {
    const nativeTitle = PORTLET_NATIVE_TITLES[portletOrder];

    // Synthetic widgets have no OPAL backing portlet — nothing to remove
    if (!nativeTitle) {
        console.log(`[PortletManager] "${portletOrder}" is synthetic, skipping removal.`);
        return true;
    }

    // After "Verstecken", OPAL keeps the div wrapper but empties the inner panel.
    // Only proceed if the panel is actually rendered inside the wrapper.
    const wrapper = document.querySelector(`div[data-portlet-order="${portletOrder}"]`);
    const panelEl = wrapper?.querySelector('section.panel.portlet');

    if (!wrapper || !panelEl) {
        const allOrders = Array.from(document.querySelectorAll('[data-portlet-order]'))
            .map(el => el.getAttribute('data-portlet-order'));
        console.log(
            `[PortletManager] Portlet "${portletOrder}" wrapper absent or already empty — nothing to remove.`,
            `Live orders: [${allOrders.join(', ')}]`
        );
        return true;
    }

    console.log(`[PortletManager] Removing portlet "${portletOrder}" ("${nativeTitle}")...`);

    if (clickNativeComponent(NATIVE_COMPONENTS.hidePortlet, wrapper)) return true;

    // Step 1: Open the portlet's action dropdown.
    // OPAL uses Bootstrap 5 (Popper.js) — toggle attribute is data-bs-toggle, not data-toggle.
    const dropdownToggle = panelEl.querySelector<HTMLElement>(
        '[data-bs-toggle="dropdown"], [data-toggle="dropdown"], .dropdown-toggle'
    );

    if (!dropdownToggle) {
        console.warn(
            `[PortletManager] ✗ Could not find dropdown toggle for "${portletOrder}".`,
            `Panel HTML: ${panelEl.innerHTML.substring(0, 400)}`
        );
        return false;
    }

    console.log('[PortletManager] Opening portlet actions dropdown...');
    safeClick(dropdownToggle);

    // Step 2: Wait for "Verstecken" to appear in the dropdown, then click it.
    let versteckenLink: HTMLElement;
    try {
        versteckenLink = await waitForDropdownItem(wrapper!, 'Verstecken');
        console.log('[PortletManager] Found "Verstecken", clicking...');
    } catch (error) {
        console.warn(`[PortletManager] ✗ "Verstecken" link did not appear for "${portletOrder}":`, error);
        return false;
    }

    safeClick(versteckenLink);

    // "Verstecken" sends a Wicket AJAX request to mark the portlet hidden server-side.
    // OPAL may or may not immediately remove the DOM element — that depends on the
    // Wicket response, which can vary. Our modern UI already hides the widget
    // independently, so DOM confirmation is not needed. The click reaching the server
    // is the only thing that matters (ensures the portlet stays hidden on next load).
    console.log(`[PortletManager] ✓ Portlet "${portletOrder}" — "Verstecken" sent to OPAL server.`);
    return true;
}

/** jQuery UI dialogs that are currently shown (closed ones stay in the DOM with display:none). */
function visibleDialogs(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.ui-dialog'))
        .filter(d => getComputedStyle(d).display !== 'none');
}

/** Polls until the jQuery UI dialog appears (contains .content-preview entries) */
function waitForDialog(timeoutMs = 5000): Promise<Element> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            // OPAL leaves closed dialogs in the DOM (hidden), so only a dialog
            // that is on screen counts; take the newest one.
            const dialog = visibleDialogs().filter(d => d.querySelector('.content-preview')).pop();
            if (dialog) {
                resolve(dialog);
                return;
            }
            if (Date.now() - start > timeoutMs) {
                reject(new Error('[PortletManager] Timeout: Add Portlets dialog did not appear.'));
                return;
            }
            setTimeout(check, 100);
        };
        check();
    });
}

/**
 * Polls until a .dropdown-item with matching text appears inside portletEl.
 * OPAL dropdown items have no title attribute — matched by textContent.
 */
function waitForDropdownItem(portletEl: Element, text: string, timeoutMs = 3000): Promise<HTMLElement> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            const items = portletEl.querySelectorAll<HTMLElement>('.panel-functions .dropdown-menu a');
            // All fixture portlets put hide first, including the single-action portlet.
            if (items.length === 1 || items.length === 2) { resolve(items[0]); return; }
            for (const item of Array.from(items)) {
                if (item.textContent?.trim().toLowerCase() === text.toLowerCase()) {
                    resolve(item);
                    return;
                }
            }
            if (Date.now() - start > timeoutMs) {
                reject(new Error(`[PortletManager] Timeout: "${text}" did not appear in dropdown.`));
                return;
            }
            setTimeout(check, 100);
        };
        check();
    });
}


/** Titles under which a portlet can appear in the "Add Portlets" dialog. */
function titlesFor(portletOrder: string): string[] {
    return [PORTLET_NATIVE_TITLES[portletOrder], ...(PORTLET_DIALOG_TITLE_ALIASES[portletOrder] ?? [])].filter(Boolean);
}

/** Visible jQuery UI dialogs that are the "Add Portlets" dialog. */
function addPortletDialogs(): HTMLElement[] {
    return visibleDialogs().filter(d => d.querySelector('.content-preview'));
}

/**
 * After clicking "Hinzufügen": wait until OPAL shows the add has landed, then
 * make sure no "Add Portlets" dialog is left on screen.
 * The add has landed when the portlet is in the page, or its entry has left
 * the dialog's list, or the dialog went away by itself.
 */
async function finishAdd(portletOrder: string, titles: string[], timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    const landed = () => {
        if (document.querySelector(`div[data-portlet-order="${CSS.escape(portletOrder)}"] section.panel.portlet`)) return true;
        const dialogs = addPortletDialogs();
        if (dialogs.length === 0) return true;
        return !dialogs.some(d => Array.from(d.querySelectorAll('.content-preview strong'))
            .some(el => titles.includes(el.textContent?.trim() ?? '')));
    };
    while (!landed()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('[PortletManager] Timeout: OPAL did not confirm the added portlet.');
        }
        await new Promise(r => setTimeout(r, 150));
    }
    await closeAddPortletDialogs();
}

/** Close every visible "Add Portlets" dialog and wait until none is left. */
async function closeAddPortletDialogs(timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    let lastClicked: Element | null = null;
    while (addPortletDialogs().length > 0 && Date.now() - start < timeoutMs) {
        const closeBtn = addPortletDialogs().pop()!.querySelector<HTMLElement>('.ui-dialog-titlebar-close');
        // Click each close button once; OPAL may need a moment to react.
        if (closeBtn && closeBtn !== lastClicked) {
            safeClick(closeBtn);
            lastClicked = closeBtn;
        }
        await new Promise(r => setTimeout(r, 150));
    }
}
