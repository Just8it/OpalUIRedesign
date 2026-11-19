import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
import { openSurface, closeSurface, enter, exit, swap } from './motion';
import { bindDialogKeyboard } from './settings';
import { readFeatureChoices, applyFeatureChoices } from './features';
import { STEPS, choose, stepDescription } from './onboarding-steps';
import { localeTag } from './i18n/core.ts';
import { t } from './i18n/messages/shell.ts';

let refreshDashboard: (() => Promise<void>) | undefined;
let opening = false;
export async function openOnboarding(): Promise<void> {
    if (opening || !document.getElementById('opal-modern-ui')) return;
    opening = true;
    try {
        let choices = await readFeatureChoices();
        // On the very first run nothing is "the current choice" yet: no check
        // marks, and focus starts on the recommended answer. Reopening shows what is set.
        const seenBefore = (await store.get(keys.onboarding))?.version === 1;
        let step = 0;
        let busy = false;
        const overlay = document.createElement('div');
        overlay.id = 'opal-onboarding';
        overlay.lang = localeTag();
        overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="opal-setup-title" aria-describedby="opal-setup-description"><p class="setup-progress" aria-live="polite"></p><div class="setup-step"><h2 id="opal-setup-title"></h2><p id="opal-setup-description"></p><div class="setup-choices"><button type="button" data-choice="yes" class="setup-primary"></button><button type="button" data-choice="no"></button></div></div><p class="setup-error" role="alert"></p><footer><button type="button" data-back>${t('setupBack')}</button><button type="button" data-skip>${t('setupSkip')}</button></footer></section>`;
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
        const draw = () => {
            const current = STEPS[step];
            required<HTMLElement>('.setup-progress').textContent = t('setupProgress', { step: step + 1, total: STEPS.length });
            required<HTMLElement>('h2').textContent = t(current.title);
            required<HTMLElement>('#opal-setup-description').textContent = stepDescription(step, choices);
            yes.textContent = t(current.yes);
            no.textContent = t(current.no);
            yes.setAttribute('aria-pressed', String(seenBefore && choices[current.key]));
            no.setAttribute('aria-pressed', String(seenBefore && !choices[current.key]));
            back.disabled = step === 0;
            (seenBefore && !choices[current.key] ? no : yes).focus();
        };
        const close = () => { void closeSurface(overlay, () => { release(); opening = false; }); };
        const save = async (skip: boolean) => {
            if (busy) return;
            busy = true;
            overlay.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
            try {
                const changed = !skip && await applyFeatureChoices(choices);
                await Promise.all([store.set(keys.onboarding, { version: 1, [skip ? 'skippedAt' : 'completedAt']: Date.now(), choices }), store.set(keys.reopen, false)]);
                close();
                if (changed) await refreshDashboard?.();
                if (!skip) {
                    const status = document.createElement('div');
                    status.className = 'opal-setup-status'; status.setAttribute('role', 'status');
                    document.getElementById('opal-modern-ui')?.append(status);
                    status.textContent = t('setupSaved'); void enter(status);
                    setTimeout(() => { void exit(status).then(done => { if (done) status.remove(); }); }, 5000);
                }
            } catch {
                required<HTMLElement>('.setup-error').textContent = t('setupSaveFailed');
                overlay.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = false; });
                back.disabled = step === 0;
            } finally { busy = false; }
        };
        const release = bindDialogKeyboard(overlay, () => { void save(true); }, yes);
        const changeStep = (direction: -1 | 1) => {
            if (busy) return;
            busy = true;
            step += direction;
            required<HTMLElement>('.setup-progress').textContent = t('setupProgress', { step: step + 1, total: STEPS.length });
            void swap(required<HTMLElement>('.setup-step'), draw, direction).finally(() => { busy = false; });
        };
        back.onclick = () => changeStep(-1);
        required<HTMLButtonElement>('[data-skip]').onclick = () => { void save(true); };
        const select = (value: boolean) => { if (busy) return; choices = choose(choices, step, value); if (step === STEPS.length - 1) void save(false); else changeStep(1); };
        yes.onclick = () => select(true); no.onclick = () => select(false);
        draw();
    } catch (error) { opening = false; console.warn('[OPAL] Einrichtung konnte nicht geöffnet werden', error); }
}
export async function startOnboarding(refresh: () => Promise<void>): Promise<void> {
    refreshDashboard = refresh;
    store.watch(keys.reopen, requested => { if (requested) void openOnboarding(); });
    const [onboarding, reopen] = await Promise.all([store.get(keys.onboarding), store.get(keys.reopen)]);
    if (onboarding?.version !== 1 || reopen) await openOnboarding();
}
