import type { FeatureChoices } from './features';
import { t } from './i18n/messages/shell.ts';

/** The setup opens with the terms; every feature after it starts switched off until the user says yes. */
export const TERMS_STEP = 0;
export const STEPS = [
    { key: 'terms', title: 'setupTermsTitle', text: 'setupTermsText', yes: 'setupTermsYes', no: 'setupTermsNo' },
    { key: 'course', title: 'setupCourseTitle', text: 'setupCourseText', yes: 'setupCourseYes', no: 'setupCourseNo' },
    { key: 'preload', title: 'setupPreloadTitle', text: 'setupPreloadText', yes: 'setupPreloadYes', no: 'setupPreloadNo' },
    { key: 'news', title: 'setupNewsTitle', text: 'setupNewsText', yes: 'setupNewsYes', no: 'setupNewsNo' },
    { key: 'deadlines', title: 'setupDeadlinesTitle', text: 'setupDeadlinesText', yes: 'setupDeadlinesYes', no: 'setupDeadlinesNo' },
    { key: 'mensa', title: 'setupMensaTitle', text: 'setupMensaText', yes: 'setupMensaYes', no: 'setupMensaNo' },
] as const;
export type FeatureStep = Exclude<(typeof STEPS)[number]['key'], 'terms'>;
export function choose(choices: FeatureChoices, step: number, value: boolean): FeatureChoices {
    const current = STEPS[step];
    if (!current || current.key === 'terms') throw new RangeError('Unbekannter Einrichtungsschritt');
    return { ...choices, [current.key]: value };
}
export function stepDescription(step: number, choices: FeatureChoices): string {
    const current = STEPS[step];
    return t(current?.key === 'news' && !choices.preload ? 'setupNewsTextWithoutPreload' : current.text);
}
