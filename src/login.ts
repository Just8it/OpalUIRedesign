/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OPAL Redesign — Login Dialog
   Styled replacement for OPAL's jQuery UI login overlay.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { safeClick } from './settings';

/** Hide OPAL's jQuery UI login dialog and show a styled replacement. */
export function injectStyledLoginDialog(): void {
    if (document.getElementById('opal-login-overlay')) return;

    const shibSubmit = document.querySelector<HTMLButtonElement>('button[name*="shibLogin"]');
    const nativeSelect = document.querySelector<HTMLSelectElement>('select[name*="wayfselection"]');
    const nativeDialog = document.querySelector<HTMLElement>('.ui-dialog');

    if (!shibSubmit || !nativeSelect) return;

    // Hide the native jQuery UI dialog + its backdrop overlay (keep in DOM so safeClick still works)
    if (nativeDialog) nativeDialog.style.display = 'none';
    document.querySelectorAll<HTMLElement>('.ui-widget-overlay').forEach(el => { el.style.display = 'none'; });

    // Mirror institution options from the native select
    const options = Array.from(nativeSelect.options).map(opt =>
        `<option value="${opt.value}"${opt.selected ? ' selected' : ''}>${opt.text}</option>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.id = 'opal-login-overlay';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:10001',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:var(--color-opal-overlay)', 'backdrop-filter:blur(6px)',
    ].join(';');

    overlay.innerHTML = `
        <div style="background:var(--color-opal-surface);border:1px solid var(--color-opal-glass-border);border-radius:20px;
                    padding:2rem;width:380px;max-width:calc(100vw - 2rem);
                    box-shadow:0 32px 80px var(--color-opal-shadow)">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:1.5rem">
                <span style="font-size:1.5rem;font-weight:900;color:var(--color-opal-text);letter-spacing:-0.05em">OPAL</span>
                <div style="width:6px;height:6px;border-radius:50%;background:var(--color-opal-accent);margin-left:2px"></div>
                <span style="font-size:0.75rem;color:var(--color-opal-text-muted);margin-left:auto">Anmelden</span>
            </div>
            <p style="font-size:0.8125rem;color:var(--color-opal-text-muted);margin-bottom:1.25rem;line-height:1.5">
                Melden Sie sich mit Ihrem Hochschul-Login an.
            </p>
            <label style="display:block;font-size:0.6875rem;font-weight:700;
                          color:var(--color-opal-text-muted);text-transform:uppercase;
                          letter-spacing:0.06em;margin-bottom:0.5rem">Institution</label>
            <select id="opal-login-institution"
                    style="width:100%;background:var(--color-opal-bg);border:1px solid var(--color-opal-glass-highlight);
                           border-radius:10px;color:var(--color-opal-text);padding:0.625rem 0.875rem;font-size:0.875rem;
                           margin-bottom:1.5rem;outline:none;cursor:pointer;
                           appearance:auto;-webkit-appearance:auto">
                ${options}
            </select>
            <button id="opal-login-submit"
                    style="width:100%;background:var(--color-opal-accent);color:var(--color-opal-on-accent);border:none;border-radius:10px;
                           padding:0.8rem;font-size:0.875rem;font-weight:600;cursor:pointer;
                           letter-spacing:0.01em;transition:opacity 0.15s">
                Mit Hochschule anmelden →
            </button>
        </div>`;

    document.body.appendChild(overlay);

    const submitBtn = document.getElementById('opal-login-submit');
    submitBtn?.addEventListener('mouseover', () => { (submitBtn as HTMLElement).style.opacity = '0.85'; });
    submitBtn?.addEventListener('mouseout', () => { (submitBtn as HTMLElement).style.opacity = '1'; });
    submitBtn?.addEventListener('click', () => {
        const sel = document.getElementById('opal-login-institution') as HTMLSelectElement;
        nativeSelect.value = sel.value;
        safeClick(shibSubmit);
    });
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
