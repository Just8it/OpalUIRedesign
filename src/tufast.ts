import { t } from './i18n/messages/shell.ts';

/** TUfast keeps ownership of its DOM and isolated-world listeners. */
export const RELOGIN_URL = 'https://bildungsportal.sachsen.de/opal/shiblogin?0';
const ACTION_MESSAGES = {
    openAllCoursesButton: ['Alle Kurse öffnen', 'tufastOpenCourses', 'tufastOpenCoursesHint'],
    openAllFavoritesButton: ['Alle Favoriten öffnen', 'tufastOpenFavorites', 'tufastOpenFavoritesHint'],
    closeAllTabsButton: ['Alle Tabs schließen', 'tufastCloseTabs', 'tufastCloseTabsHint'],
} as const;
export const ACTION_IDS = Object.keys(ACTION_MESSAGES) as (keyof typeof ACTION_MESSAGES)[];
export interface TufastAction { id: string; label: string; title: string; disabled: boolean }
export function hasTufast(root: ParentNode = document): boolean {
    return !!root.querySelector('.tufast-opal-header, #TUfastIcon');
}
export function tufastActions(root: ParentNode = document): TufastAction[] {
    if (!hasTufast(root)) return [];
    return ACTION_IDS.flatMap(id => {
        const el = root.querySelector<HTMLElement>('#' + id);
        if (!el) return [];
        const [nativeLabel, labelKey, titleKey] = ACTION_MESSAGES[id];
        const label = el.textContent?.trim() || id;
        return [{
            id,
            label: label === nativeLabel ? t(labelKey) : label,
            title: el.title === `${nativeLabel}. Ein TUfast-Feature.` ? t(titleKey) : el.title,
            disabled: el.style.pointerEvents === 'none' || el.style.cursor === 'not-allowed' || el.style.opacity === '0.5' || el.getAttribute('aria-disabled') === 'true',
        }];
    });
}
export function clickTufast(id: string): void {
    if (tufastActions().some(a => a.id === id && !a.disabled)) document.getElementById(id)?.click();
}
export function observeTufast(change: () => void, timeout = 15000): () => void {
    let signature = '';
    let found = hasTufast();
    let watched: Element | null = null;
    const header = new MutationObserver(() => update());
    const update = () => {
        found ||= hasTufast();
        const current = document.querySelector('.tufast-opal-header');
        if (current !== watched) {
            header.disconnect();
            watched = current;
            if (current) header.observe(current, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ['style', 'title', 'aria-disabled'] });
        }
        const next = JSON.stringify([hasTufast(), tufastActions()]);
        if (signature !== next) { signature = next; change(); }
    };
    const page = new MutationObserver(update);
    page.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => { if (!found) { page.disconnect(); header.disconnect(); } }, timeout);
    update();
    return () => { page.disconnect(); header.disconnect(); clearTimeout(timer); };
}
export function waitForTufast(timeout = 1500): Promise<boolean> {
    if (hasTufast()) return Promise.resolve(true);
    return new Promise(resolve => {
        const observer = new MutationObserver(() => { if (hasTufast()) finish(true); });
        const finish = (found: boolean) => { observer.disconnect(); clearTimeout(timer); resolve(found); };
        const timer = setTimeout(() => finish(false), timeout);
        observer.observe(document.body, { childList: true, subtree: true });
    });
}
/** A disclosure with native buttons provides Tab/Enter/Space keyboard access. */
export function bindTufastMenu(): void {
    const host = document.getElementById('opal-tufast');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = 'true';
    let open = false;
    const render = () => {
        if (!host.isConnected) { stop(); document.removeEventListener('click', outside); document.removeEventListener('keydown', escape); return; }
        host.replaceChildren();
        if (!hasTufast()) return;
        const button = document.createElement('button');
        button.className = 'opal-avatar-btn';
        button.id = 'opal-tufast-btn';
        button.title = 'TUfast';
        button.setAttribute('aria-label', 'TUfast');
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-controls', 'opal-tufast-menu');
        button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 5c2-2 5-2 5-2s0 3-2 5l-7 7-4-4zM6 11l-3 1 4-6 5-1M10 15l-1 4 6-4 1-5M5 16l-2 5 5-2"/></svg>';
        button.onclick = () => { open = !open; render(); if (open) host.querySelector<HTMLButtonElement>('#opal-tufast-menu button:not(:disabled)')?.focus(); else host.querySelector<HTMLButtonElement>('button')?.focus(); };
        host.append(button);
        if (!open) return;
        const menu = document.createElement('div');
        menu.id = 'opal-tufast-menu';
        menu.className = 'opal-user-dropdown';
        for (const action of tufastActions()) {
            const item = document.createElement('button');
            item.className = 'opal-user-dropdown-item';
            item.textContent = action.label;
            item.title = action.title;
            item.disabled = action.disabled;
            item.setAttribute('aria-disabled', String(action.disabled));
            item.onclick = () => { clickTufast(action.id); open = false; render(); host.querySelector<HTMLButtonElement>('button')?.focus(); };
            menu.append(item);
        }
        host.append(menu);
    };
    const outside = (e: Event) => { if (open && !e.composedPath().includes(host)) { open = false; render(); } };
    const escape = (e: KeyboardEvent) => { if (open && e.key === 'Escape') { open = false; render(); host.querySelector<HTMLButtonElement>('button')?.focus(); } };
    const stop = observeTufast(() => queueMicrotask(render));
    document.addEventListener('click', outside);
    document.addEventListener('keydown', escape);
}

export async function deferTufastLogin(
    quiet: (pending: boolean) => void,
    detect: () => Promise<boolean> = waitForTufast,
    delay: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 8000)),
): Promise<void> {
    if (!await detect()) return;
    quiet(true);
    await delay();
    quiet(false);
}
