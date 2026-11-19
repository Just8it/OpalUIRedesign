/* Owns edit mode for the course view. */

import { t } from '../../i18n/messages/course.ts';
import { type BrowseLayout } from '../browse/index';

import { renderEditBar } from '../render/edit-bar';
import { editModeButtons } from '../../topbar';

import { enter, exit, collapse } from '../../motion';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    editBar: HTMLElement;
    layout: BrowseLayout;
    root: HTMLElement;
    editing: boolean;
    selected: string;
    render: () => void;
    announce: (text: string, delay?: number) => void;
    paneTitle: HTMLElement;
    keepFocus: (scope: HTMLElement, change: () => void) => void;
    toElement: (html: string) => HTMLElement;
}

export function createEditMode(context: Context) {
    const renderEditBarNow = () =>
        context.keepFocus(context.editBar, () => {
            context.editBar.innerHTML = renderEditBar(context.layout);
        });

    const setTopbarEditing = (on: boolean) => {
        context.root.querySelector('#opal-edit-actions')?.remove();
        const actions = context.root.querySelector('#opal-topbar-actions');
        if (on && actions) actions.prepend(context.toElement(editModeButtons()));
        const label = context.root.querySelector('#opal-user-dropdown [data-action="customize"] span');
        if (label) label.textContent = on ? t('editDoneAction') : t('customizeCourse');
    };

    const setEditing = (on: boolean) => {
        if (on === context.editing) return;
        const hadFocus =
            context.editBar.contains(document.activeElement) ||
            !!document.activeElement?.closest('.opal-course-nav-tools, .opal-course-home-editor, #opal-edit-actions');
        context.editing = on;
        context.root.classList.toggle('is-course-editing', on);
        setTopbarEditing(on);

        if (on) {
            context.selected = 'home';
            renderEditBarNow();
            context.editBar.hidden = true;
            void collapse(context.editBar, true);
            context.render();
            for (const tools of context.root.querySelectorAll<HTMLElement>(
                '.opal-course-nav-tools, .opal-course-home-editor',
            ))
                void enter(tools);
            context.root.querySelector<HTMLElement>('#opal-edit-toggle')?.focus({ preventScroll: true });
            context.announce(t('editStarted'));
        } else {
            void collapse(context.editBar, false);
            void Promise.all(
                [...context.root.querySelectorAll<HTMLElement>('.opal-course-nav-tools, .opal-course-home-editor')].map(
                    exit,
                ),
            ).then(() => {
                if (!context.editing) context.render();
            });
            if (hadFocus)
                (context.root.querySelector<HTMLElement>('#opal-user-btn') ?? context.paneTitle).focus({
                    preventScroll: true,
                });
            context.announce(t('editEnded'));
        }
    };
    return { renderEditBarNow, setTopbarEditing, setEditing };
}
