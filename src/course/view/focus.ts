/* Owns focus rendering and helpers. */

export function toElement(html: string): HTMLElement {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild as HTMLElement;
}

/** A stable name for a focusable element, so focus can return to "the same"
 *  control after its markup was replaced. */
export function focusKey(el: Element | null): string {
    if (!(el instanceof HTMLElement)) return '';
    const d = el.dataset;
    if (d.fk) return `fk:${d.fk}`;
    if (d.nav) return `nav:${d.nav}`;
    if (d.edit) return `edit:${d.edit}:${d.id ?? ''}`;
    if (d.sort) return `sort:${d.sort}`;
    if (d.column) return `column:${d.column}`;
    if (d.density) return `density:${d.density}`;
    if (d.editbar) return `editbar:${d.editbar}`;
    if (d.banner) return `banner:${d.banner}`;
    return el.id ? `id:${el.id}` : '';
}

export function byFocusKey(scope: ParentNode, key: string): HTMLElement | null {
    if (!key) return null;
    const at = key.indexOf(':');
    const kind = key.slice(0, at),
        value = key.slice(at + 1);
    const attr: Record<string, string> = {
        fk: 'data-fk',
        nav: 'data-nav',
        sort: 'data-sort',
        column: 'data-column',
        density: 'data-density',
        editbar: 'data-editbar',
        banner: 'data-banner',
    };
    if (kind === 'id') return scope.querySelector<HTMLElement>(`#${CSS.escape(value)}`);
    if (kind === 'edit') {
        const [action, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
        return scope.querySelector<HTMLElement>(`[data-edit="${CSS.escape(action)}"][data-id="${CSS.escape(id)}"]`);
    }
    return attr[kind] ? scope.querySelector<HTMLElement>(`[${attr[kind]}="${CSS.escape(value)}"]`) : null;
}

/** Run `change`, then put focus back on the same control if it was inside `scope`. */
export function keepFocus(scope: HTMLElement, change: () => void): void {
    const active = document.activeElement;
    const key = active && scope.contains(active) ? focusKey(active) : '';
    const input =
        key && active instanceof HTMLInputElement
            ? { value: active.value, start: active.selectionStart, end: active.selectionEnd }
            : null;
    change();
    if (key && !scope.contains(document.activeElement)) {
        const replacement = byFocusKey(scope, key);
        if (input && replacement instanceof HTMLInputElement) {
            replacement.value = input.value;
            if (input.start !== null && input.end !== null) replacement.setSelectionRange(input.start, input.end);
        }
        replacement?.focus({ preventScroll: true });
    }
}

export function isEditable(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
}
