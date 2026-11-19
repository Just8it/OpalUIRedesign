import { onLocaleChange } from '../i18n/core.ts';
import { t, type PageMessageKey } from '../i18n/messages/pages.ts';

/** Styled confirmation for the options page: a native modal dialog, so Escape cancels, focus stays inside and returns
 *  to the button that opened it. Mirrors confirmDialog of the dashboard (src/settings.ts), which needs the OPAL page. */
export function confirmDialog(o: { title: PageMessageKey; message: PageMessageKey; confirmLabel: PageMessageKey; danger?: boolean }): Promise<boolean> {
    return new Promise(resolve => {
        const opener = document.activeElement as HTMLElement | null;
        const dialog = document.createElement('dialog');
        dialog.className = 'opal-dialog';
        dialog.setAttribute('aria-labelledby', 'opal-dialog-title');
        dialog.setAttribute('aria-describedby', 'opal-dialog-text');
        const title = document.createElement('h2');
        title.id = 'opal-dialog-title';
        const text = document.createElement('p');
        text.id = 'opal-dialog-text';
        const footer = document.createElement('div');
        footer.className = 'opal-dialog-footer';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'opal-btn';
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = `opal-btn ${o.danger ? 'opal-btn-danger' : 'opal-btn-primary'}`;
        const render = () => {
            title.textContent = t(o.title);
            text.textContent = t(o.message);
            cancel.textContent = t('optionsCancel');
            confirm.textContent = t(o.confirmLabel);
        };
        render();
        const stop = onLocaleChange(render);
        footer.append(cancel, confirm);
        dialog.append(title, text, footer);
        let answer = false;
        confirm.addEventListener('click', () => { answer = true; dialog.close(); });
        cancel.addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
        dialog.addEventListener('close', () => { stop(); dialog.remove(); opener?.focus(); resolve(answer); });
        document.body.append(dialog);
        dialog.showModal();
        cancel.focus();
    });
}
