/* Owns reconcile for the course view. */

import { swap, collapse } from '../../motion';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    boxSigs: Record<string, string>;
    indicator: HTMLSpanElement;
    syncIndicator: () => void;
    table: HTMLElement;
    thead: HTMLElement;
    groupSigs: Map<string, string>;
    keepFocus: (scope: HTMLElement, change: () => void) => void;
    toElement: (html: string) => HTMLElement;
}

export function createReconcile(context: Context) {
    const setBox = (key: string, box: HTMLElement, sig: string, html: () => string): boolean => {
        if (context.boxSigs[key] === sig) return false;
        context.boxSigs[key] = sig;
        if (key === 'nav') context.indicator.remove();
        context.keepFocus(box, () => {
            const markup = html();
            const grid = key === 'home' ? box.querySelector('.opal-course-home-grid') : null;
            if (!grid || Array.from(grid.children).some((el) => !(el as HTMLElement).dataset.block)) {
                box.innerHTML = markup;
                return;
            }
            const template = document.createElement('template');
            template.innerHTML = markup;
            const next = template.content.querySelector('.opal-course-home-grid');
            if (!next) {
                box.innerHTML = markup;
                return;
            }
            const existing = new Map(Array.from(grid.children).map((el) => [(el as HTMLElement).dataset.block, el]));
            for (const fresh of Array.from(next.children)) {
                const old = existing.get((fresh as HTMLElement).dataset.block);
                if (old) {
                    existing.delete((fresh as HTMLElement).dataset.block);
                    if (old.innerHTML !== fresh.innerHTML) old.innerHTML = fresh.innerHTML;
                    old.className = fresh.className;
                    grid.append(old);
                } else grid.append(fresh);
            }
            for (const old of existing.values()) old.remove();
            for (const el of Array.from(box.children)) if (el !== grid) el.remove();
            for (const el of Array.from(template.content.children)) {
                if (el === next) continue;
                if (el.classList.contains('opal-course-home-hint')) grid.before(el);
                else grid.after(el);
            }
        });
        if (key === 'nav') context.syncIndicator();
        if (key === 'banner' && sig) {
            box.hidden = true;
            void collapse(box, true);
        }
        return true;
    };

    const reconcileGroups = (desired: { key: string; sig: string; html: () => string }[]) => {
        const existing = new Map<string, HTMLElement>();
        for (const child of Array.from(context.table.children) as HTMLElement[])
            if (child !== context.thead) existing.set(child.dataset.group ?? '', child);
        let prev: Element = context.thead;
        for (const d of desired) {
            let el = existing.get(d.key);
            existing.delete(d.key);
            if (el && context.groupSigs.get(d.key) !== d.sig) {
                const old = el;
                const fresh = context.toElement(d.html());
                const body = old.querySelector<HTMLElement>('.opal-course-group-body');
                const nextBody = fresh.querySelector<HTMLElement>('.opal-course-group-body');
                if (body && nextBody && old.querySelector('.is-skeleton') && !fresh.querySelector('.is-skeleton')) {
                    const head = old.querySelector('.opal-course-ghead');
                    const nextHead = fresh.querySelector('.opal-course-ghead');
                    if (nextHead) head?.replaceWith(nextHead);
                    void swap(body, () => {
                        if (context.groupSigs.get(d.key) === d.sig)
                            context.keepFocus(body, () => {
                                body.innerHTML = nextBody.innerHTML;
                            });
                    });
                    el = old;
                } else context.keepFocus(context.table, () => old.replaceWith(fresh));
                if (el !== old || !old.isConnected) el = fresh;
            } else if (!el) {
                el = context.toElement(d.html());
            }
            context.groupSigs.set(d.key, d.sig);
            if (prev.nextElementSibling !== el) prev.after(el);
            prev = el;
        }
        for (const [key, el] of existing) {
            context.keepFocus(context.table, () => el.remove());
            context.groupSigs.delete(key);
        }
    };
    return { setBox, reconcileGroups };
}
