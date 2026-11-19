import { isGuest } from './topbar';
import { deferTufastLogin } from './tufast';
import { openSurface, closeSurface } from './motion';
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Login Dialog
   Styled replacement for OPAL's jQuery UI login overlay.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { safeClick } from './settings';
import { escapeAttr, escapeHtml } from './utils';
import { localeTag } from './i18n/core.ts';
import { t } from './i18n/messages/shell.ts';

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

let autoLogin: Promise<void> | undefined;
/** Page loaded logged out with OPAL's dialog open: open ours, unless TUfast is about to log in.
 *  TUfast picks the institution in OPAL's own dialog; ours on top would only flash. If the page
 *  is still logged out after its grace period, the dialog opens as usual. A click on "Anmelden"
 *  never waits (it calls injectStyledLoginDialog directly). */
export function autoInjectLoginDialog(): void {
    autoLogin ??= deferTufastLogin(pending => {
        const button = document.getElementById('opal-login-btn');
        if (!button) return;
        button.textContent = t(pending ? 'loginTufastPending' : 'loginButton');
        button.setAttribute('aria-busy', String(pending));
    }).then(() => {
        if (isGuest() && document.querySelector('button[name*="shibLogin"]')) injectStyledLoginDialog();
    });
}

/** Hide OPAL's jQuery UI login dialog and show a styled replacement. */
export function injectStyledLoginDialog(): void {
    if (document.getElementById('opal-login-overlay')) return;

    const shibSubmit = document.querySelector<HTMLButtonElement>('button[name*="shibLogin"]');
    const nativeSelect = document.querySelector<HTMLSelectElement>('select[name*="wayfselection"]');
    const nativeDialog = document.querySelector<HTMLElement>('.ui-dialog');

    if (!shibSubmit || !nativeSelect) return;

    // Hide the native jQuery UI dialog + its backdrop overlay (keep in DOM so safeClick still works).
    // Remember the previous inline display values so closing our dialog can put them back.
    const hidden: Array<{ el: HTMLElement; display: string }> = [];
    const hide = (el: HTMLElement) => {
        hidden.push({ el, display: el.style.display });
        el.style.display = 'none';
    };
    if (nativeDialog) hide(nativeDialog);
    document.querySelectorAll<HTMLElement>('.ui-widget-overlay').forEach(hide);

    // Mirror institution options from the native select
    const options = Array.from(nativeSelect.options).map(opt =>
        `<option value="${escapeAttr(opt.value)}"${opt.selected ? ' selected' : ''}>${escapeHtml(opt.text)}</option>`
    ).join('');

    const previousFocus = document.activeElement as HTMLElement | null;

    const overlay = document.createElement('div');
    overlay.id = 'opal-login-overlay';
    overlay.lang = localeTag();
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:10001',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:var(--color-opal-overlay)',
    ].join(';');

    overlay.innerHTML = `
        <div class="widget-settings-modal" role="dialog" aria-modal="true" aria-labelledby="opal-login-title" aria-describedby="opal-login-desc">
            <div class="settings-modal-header">
                <div>
                    <h2 id="opal-login-title" class="settings-modal-title">${t('loginTitle')}</h2>
                    <p id="opal-login-desc" class="settings-modal-subtitle">${t('loginSubtitle')}</p>
                </div>
                <button type="button" id="opal-login-close" class="settings-close-btn" aria-label="${t('close')}">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="settings-modal-body">
                <label class="settings-field-label" for="opal-login-institution">${t('loginInstitution')}</label>
                <div class="settings-input-wrap">
                    <select id="opal-login-institution" class="settings-select-input">
                        ${options}
                    </select>
                    <svg class="settings-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
            </div>
            <div class="settings-modal-footer">
                <button type="button" id="opal-login-cancel" class="opal-btn">${t('cancel')}</button>
                <button type="button" id="opal-login-submit" class="opal-btn opal-btn-primary">${t('loginButton')}</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    openSurface(overlay);

    const dialogEl = overlay.querySelector<HTMLElement>('[role="dialog"]');
    const selectEl = overlay.querySelector<HTMLSelectElement>('#opal-login-institution');
    if (!dialogEl || !selectEl) return;
    const dialog: HTMLElement = dialogEl;
    const select: HTMLSelectElement = selectEl;

    function close(): void {
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('focusin', onFocusIn, true);
        void closeSurface(overlay, () => {
            hidden.forEach(({ el, display }) => { el.style.display = display; });
            if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        });
    }

    function onKeydown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        if (e.key !== 'Tab') return;
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !dialog.contains(active))) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
            e.preventDefault();
            first.focus();
        }
    }

    // Keep focus inside the dialog if something outside tries to take it.
    function onFocusIn(e: FocusEvent): void {
        if (!dialog.contains(e.target as Node)) select.focus();
    }

    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', onFocusIn, true);

    overlay.querySelector('#opal-login-close')?.addEventListener('click', close);
    overlay.querySelector('#opal-login-cancel')?.addEventListener('click', close);
    overlay.querySelector('#opal-login-submit')?.addEventListener('click', () => {
        nativeSelect.value = select.value;
        safeClick(shibSubmit);
    });

    select.focus();
}

/** Watch for OPAL's Wicket login dialog to appear, then style it. */
export function watchForLoginDialog(): void {
    const obs = new MutationObserver(() => {
        if (document.querySelector('button[name*="shibLogin"]')) {
            obs.disconnect();
            injectStyledLoginDialog();
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 5000); // give up after 5 s
}
