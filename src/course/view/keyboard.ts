/* Owns keyboard for the course view. */

import { updateBlock } from '../home/index';
import type { HomeConfig } from '../home/types';

import { type HomeRenderState } from '../render/home-shared';

import { typeToFind } from '../render/find-field';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    setNavOpen: (open: boolean, focusToggle?: boolean) => void;
    setEditing: (on: boolean) => void;
    resetFind: () => void;
    homeConfig: HomeConfig | null;
    persistHome: () => void;
    homeState: HomeRenderState;
    render: () => void;
    homeBox: HTMLElement;
    navOpen: boolean;
    editing: boolean;
    query: string;
    scrollAtFocus: number | null;
    root: HTMLElement;
    findInput: HTMLInputElement;
    byFocusKey: (scope: ParentNode, key: string) => HTMLElement | null;
    isEditable: (t: EventTarget | null) => boolean;
}

export function createKeyboard(context: Context) {
    const onKey = (e: KeyboardEvent) => {
        if (e.defaultPrevented || document.getElementById('opal-cmd-overlay')) return;
        const rename = (e.target as HTMLElement)?.closest<HTMLInputElement>('[data-home-rename]');
        if (rename && (e.key === 'Enter' || e.key === 'Escape')) {
            e.preventDefault();
            // An unchanged name stays a built-in title, so it keeps following the interface language.
            if (e.key === 'Enter' && context.homeConfig && rename.value.trim() && rename.value.trim() !== rename.defaultValue.trim()) {
                context.homeConfig = updateBlock(context.homeConfig, rename.dataset.homeRename ?? '', {
                    title: rename.value.trim(),
                });
                context.persistHome();
            }
            const id = rename.dataset.homeRename ?? '';
            context.homeState.rename = '';
            context.render();
            context.byFocusKey(context.homeBox, `fk:home:rename:${id}`)?.focus({ preventScroll: true });
            return;
        }
        if (e.key === 'Escape') {
            if (context.navOpen) {
                e.preventDefault();
                context.setNavOpen(false, true);
                return;
            }
            if (context.editing) {
                e.preventDefault();
                context.setEditing(false);
                return;
            }
        }
        const editable = context.isEditable(e.target);
        if (e.key === 'Escape' && !editable && context.query.trim()) {
            e.preventDefault();
            context.resetFind();
            return;
        }
        const action = typeToFind({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, editable });
        if (!action) return;
        // The user menu and other menus keep their own keys.
        if ((e.target as Element | null)?.closest?.('#opal-user-dropdown')) return;
        e.preventDefault();
        if (!context.query.trim()) context.scrollAtFocus = context.root.scrollTop;
        context.findInput.focus({ preventScroll: true });
        if (action === 'insert') {
            const end = context.findInput.value.length;
            context.findInput.setRangeText(e.key, end, end, 'end');
            context.findInput.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            context.findInput.select();
        }
    };
    return { onKey };
}
