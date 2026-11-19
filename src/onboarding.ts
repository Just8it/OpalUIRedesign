import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
import { openSurface, closeSurface, enter, exit, swap } from './motion';
import { bindDialogKeyboard } from './settings';
import { readFeatureChoices, applyFeatureChoices } from './features';
import { STEPS, TERMS_STEP, choose, stepDescription } from './onboarding-steps';
import { LEGAL_VERSION, PRIVACY_URL, TERMS_URL, acceptedCurrentTerms, readAcceptance, type LegalAcceptance } from './legal.ts';
import { localeTag } from './i18n/core.ts';
import { t, type ShellMessageKey } from './i18n/messages/shell.ts';

/** "Ich akzeptiere die {link}." with the link as a real anchor; translations stay plain text. */
function linkedLabel(target: HTMLElement, message: ShellMessageKey, linkText: ShellMessageKey, href: string): void {
    const [before, after = ''] = t(message).split('{link}');
    const link = document.createElement('a');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = t(linkText);
    target.replaceChildren(before, link, after);
}

let refreshDashboard: (() => Promise<void>) | undefined;
let opening = false;
export async function openOnboarding(): Promise<void> {
    if (opening || !document.getElementById('opal-modern-ui')) return;
    opening = true;
    try {
        const saved = await store.get(keys.onboarding);
        let choices = await readFeatureChoices();
        // On the very first run nothing is "the current choice" yet: no check
        // marks, and focus starts on the first answer. Reopening shows what is set.
        const seenBefore = saved !== null;
        // The terms come first until the current version is accepted; reopening the setup afterwards skips them.
        let accepted: LegalAcceptance | null = acceptedCurrentTerms(saved) ? readAcceptance(saved) : null;
        const first = accepted ? TERMS_STEP + 1 : TERMS_STEP;
        let step = first;
        let busy = false;
        const overlay = document.createElement('div');
        overlay.id = 'opal-onboarding';
        overlay.lang = localeTag();
        overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="opal-setup-title" aria-describedby="opal-setup-description"><p class="setup-progress" aria-live="polite"></p><div class="setup-step"><h2 id="opal-setup-title"></h2><p id="opal-setup-description"></p><div class="setup-consent"><label><input type="checkbox" data-consent="terms"><span></span></label><label><input type="checkbox" data-consent="privacy"><span></span></label></div><div class="setup-choices"><button type="button" data-choice="yes" class="setup-primary"></button><button type="button" data-choice="no"></button></div></div><p class="setup-error" role="alert"></p><footer><button type="button" data-back>${t('setupBack')}</button><button type="button" data-skip>${t('setupSkip')}</button></footer></section>`;
        document.body.append(overlay);
        openSurface(overlay);
        const required = <T extends HTMLElement>(selector: string): T => {
            const element = overlay.querySelector<T>(selector);
            if (!element) throw new Error(`Fehlendes Einrichtungselement: ${selector}`);
            return element;
        };
        const yes = required<HTMLButtonElement>('[data-choice="yes"]');
        const no = required<HTMLButtonElement>('[data-choice="no"]');
        const back = required<HTMLButtonElement>('[data-back]');
        const skip = required<HTMLButtonElement>('[data-skip]');
        const consent = required<HTMLElement>('.setup-consent');
        const terms = required<HTMLInputElement>('[data-consent="terms"]');
        const privacy = required<HTMLInputElement>('[data-consent="privacy"]');
        linkedLabel(required<HTMLElement>('[data-consent="terms"] + span'), 'setupAcceptTerms', 'setupTermsLink', TERMS_URL);
        linkedLabel(required<HTMLElement>('[data-consent="privacy"] + span'), 'setupAcknowledgePrivacy', 'setupPrivacyLink', PRIVACY_URL);
        const onTerms = () => step === TERMS_STEP;
        const syncConsent = () => { yes.disabled = onTerms() && !(terms.checked && privacy.checked); };
        // Unticking after going back withdraws the acceptance given a moment ago.
        terms.onchange = privacy.onchange = () => { if (!terms.checked || !privacy.checked) accepted = null; syncConsent(); };
        const progress = () => t('setupProgress', { step: step - first + 1, total: STEPS.length - first });
        const draw = () => {
            const current = STEPS[step];
            required<HTMLElement>('.setup-progress').textContent = progress();
            required<HTMLElement>('h2').textContent = t(current.title);
            required<HTMLElement>('#opal-setup-description').textContent = stepDescription(step, choices);
            yes.textContent = t(current.yes);
            no.textContent = t(current.no);
            consent.hidden = !onTerms();
            skip.hidden = onTerms();
            if (current.key === 'terms') {
                yes.removeAttribute('aria-pressed'); no.removeAttribute('aria-pressed');
                syncConsent();
                terms.focus();
            } else {
                const on = choices[current.key];
                yes.disabled = false;
                yes.setAttribute('aria-pressed', String(seenBefore && on));
                no.setAttribute('aria-pressed', String(seenBefore && !on));
                (seenBefore && !on ? no : yes).focus();
            }
            back.disabled = step === first;
        };
        const close = () => { void closeSurface(overlay, () => { release(); opening = false; }); };
        const save = async (skipped: boolean) => {
            if (busy || !accepted) return;
            busy = true;
            overlay.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
            try {
                const changed = !skipped && await applyFeatureChoices(choices);
                await Promise.all([store.set(keys.onboarding, { version: 2, [skipped ? 'skippedAt' : 'completedAt']: Date.now(), choices, accepted }), store.set(keys.reopen, false)]);
                close();
                if (changed) await refreshDashboard?.();
                if (!skipped) {
                    const status = document.createElement('div');
                    status.className = 'opal-setup-status'; status.setAttribute('role', 'status');
                    document.getElementById('opal-modern-ui')?.append(status);
                    status.textContent = t('setupSaved'); void enter(status);
                    setTimeout(() => { void exit(status).then(done => { if (done) status.remove(); }); }, 5000);
                }
            } catch {
                required<HTMLElement>('.setup-error').textContent = t('setupSaveFailed');
                overlay.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = false; });
                back.disabled = step === first;
            } finally { busy = false; }
        };
        // Leaving before the terms are accepted stores nothing: every optional feature stays off and the setup asks again next time.
        const dismiss = () => { if (accepted) void save(true); else close(); };
        const release = bindDialogKeyboard(overlay, dismiss, onTerms() ? terms : yes);
        const changeStep = (direction: -1 | 1) => {
            if (busy) return;
            busy = true;
            step += direction;
            required<HTMLElement>('.setup-progress').textContent = progress();
            void swap(required<HTMLElement>('.setup-step'), draw, direction).finally(() => { busy = false; });
        };
        back.onclick = () => changeStep(-1);
        skip.onclick = () => { void save(true); };
        const select = (value: boolean) => {
            if (busy) return;
            if (onTerms()) {
                if (!value) { close(); return; }
                if (!terms.checked || !privacy.checked) return;
                accepted = { version: LEGAL_VERSION, at: Date.now() };
                changeStep(1);
                return;
            }
            choices = choose(choices, step, value);
            if (step === STEPS.length - 1) void save(false); else changeStep(1);
        };
        yes.onclick = () => select(true); no.onclick = () => select(false);
        draw();
    } catch (error) { opening = false; console.warn('[OPAL] Einrichtung konnte nicht geöffnet werden', error); }
}
export async function startOnboarding(refresh: () => Promise<void>): Promise<void> {
    refreshDashboard = refresh;
    store.watch(keys.reopen, requested => { if (requested) void openOnboarding(); });
    const [onboarding, reopen] = await Promise.all([store.get(keys.onboarding), store.get(keys.reopen)]);
    if (!acceptedCurrentTerms(onboarding) || reopen) await openOnboarding();
}
