/**
 * Utility to silently fetch and add native OPAL portlets to the DOM
 * when a user enables a widget in the modern UI.
 */

/**
 * Checks if a portlet natively exists in OPAL.
 * If not, clicks the "Add Portlets" button, finds the portlet, clicks "Add",
 * and waits for it to be injected into the DOM.
 * 
 * @param portletTitle Exact native OPAL title (e.g. "Meine Termine", "Favoriten")
 * @returns Promise that resolves when the portlet is available in the DOM
 */

// USE SAFE CLICK FOR THE FUTURE CLICK EVENTS - TODO!!!

export async function ensurePortlet(portletTitle: string): Promise<boolean> {
    // 1. Check if the portlet already exists on the page
    const exists = Array.from(document.querySelectorAll('.o_portlet')).some(el => {
        const header = el.querySelector('h3.o_portlet_title');
        return header && header.textContent?.trim() === portletTitle;
    });

    if (exists) {
        console.log(`[PortletManager] Portlet "${portletTitle}" is already active.`);
        return true;
    }

    console.log(`[PortletManager] Portlet "${portletTitle}" missing. Attempting auto-add...`);

    // 2. Find the "Add Portlets" button
    const addMenuBtn = document.querySelector<HTMLButtonElement>(
        'button[title="Portlet hinzufügen"], button[title="Add portlet"]'
    );

    if (!addMenuBtn) {
        console.warn('[PortletManager] Could not find native "Add Portlets" button.');
        return false;
    }

    // 3. Click it to open the dialog
    addMenuBtn.click();

    try {
        // 4. Wait for the dialog to appear
        const dialog = await waitForDialog();

        // 5. Find the specific portlet in the dialog list
        const previews = dialog.querySelectorAll('.content-preview');
        let targetButton: HTMLButtonElement | null = null;

        for (const preview of Array.from(previews)) {
            const strongTitle = preview.querySelector('strong');
            if (strongTitle && strongTitle.textContent?.trim() === portletTitle) {
                targetButton = preview.querySelector<HTMLButtonElement>('button[title="Hinzufügen"], button[title="Add"]');
                break;
            }
        }

        if (!targetButton) {
            console.warn(`[PortletManager] Portlet "${portletTitle}" not found in add menu.`);
            // Try to close dialog gracefully
            dialog.querySelector<HTMLButtonElement>('.ui-dialog-titlebar-close')?.click();
            return false;
        }

        // 6. Click the specific "Add" button
        targetButton.click();

        // 7. Wait for the portlet to actually spawn in the DOM
        await waitForPortletSpawn(portletTitle);

        console.log(`[PortletManager] Successfully added portlet: "${portletTitle}"`);
        return true;

    } catch (error) {
        console.error(`[PortletManager] Failed to add portlet "${portletTitle}":`, error);
        // Try forcing dialog close just in case
        document.querySelector<HTMLButtonElement>('.ui-dialog-titlebar-close')?.click();
        return false;
    }
}

/**
 * Polls the DOM until the jQuery UI dialog appears
 */
function waitForDialog(timeoutMs = 5000): Promise<Element> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = () => {
            const dialog = document.querySelector('.ui-dialog[aria-describedby*="id"]');
            if (dialog && dialog.querySelector('.content-preview')) {
                resolve(dialog);
                return;
            }

            if (Date.now() - startTime > timeoutMs) {
                reject(new Error('Timeout waiting for native add portlet dialog'));
                return;
            }

            setTimeout(check, 100);
        };

        check();
    });
}

/**
 * Polls the native layout until a portlet with the correct title appears
 */
function waitForPortletSpawn(portletTitle: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = () => {
            const exists = Array.from(document.querySelectorAll('.o_portlet')).some(el => {
                const header = el.querySelector('h3.o_portlet_title');
                return header && header.textContent?.trim() === portletTitle;
            });

            if (exists) {
                resolve();
                return;
            }

            if (Date.now() - startTime > timeoutMs) {
                reject(new Error(`Timeout waiting for portlet "${portletTitle}" to spawn in DOM.`));
                return;
            }

            setTimeout(check, 100);
        };

        check();
    });
}
