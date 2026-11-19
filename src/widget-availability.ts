import { WIDGETS } from './widgets/index.ts';

export function isWidgetAvailable(id: string, orders: ReadonlySet<string>): boolean {
    const widget = WIDGETS.get(id);
    if (!widget || widget.requires === null) return true;
    const sources = [widget.opalPortletOrder].flat().filter(Boolean);
    return widget.requires === 'any'
        ? sources.some(order => orders.has(order))
        : sources.every(order => orders.has(order));
}

export function getAvailablePortletOrders(): Set<string> {
    return new Set(Array.from(document.querySelectorAll('[data-portlet-order]'))
        .map(el => el.getAttribute('data-portlet-order')!).filter(Boolean));
}

/** Wait for the container inventory, never for AJAX-loaded portlet contents.
 * A quiet inventory for 500 ms is enough; an empty page waits up to 4 seconds. */
export async function waitForPortletOrders(): Promise<Set<string>> {
    const started = Date.now();
    let signature = '';
    let changed = started;
    while (Date.now() - started < 4000) {
        const orders = getAvailablePortletOrders();
        const next = [...orders].sort().join('|');
        if (next !== signature) { signature = next; changed = Date.now(); }
        if (orders.size && Date.now() - changed >= 500) return orders;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return getAvailablePortletOrders();
}
