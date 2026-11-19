import type { FeatureChoices } from './features';
import { t } from './i18n/messages/shell.ts';

export const STEPS = [
    { key: 'course', title: 'setupCourseTitle', text: 'setupCourseText', yes: 'setupCourseYes', no: 'setupCourseNo' },
    { key: 'preload', title: 'setupPreloadTitle', text: 'setupPreloadText', yes: 'setupPreloadYes', no: 'setupPreloadNo' },
    { key: 'news', title: 'setupNewsTitle', text: 'setupNewsText', yes: 'setupNewsYes', no: 'setupNewsNo' },
    { key: 'deadlines', title: 'setupDeadlinesTitle', text: 'setupDeadlinesText', yes: 'setupDeadlinesYes', no: 'setupDeadlinesNo' },
] as const;
export function choose(choices: FeatureChoices, step: number, value: boolean): FeatureChoices {
    if (!STEPS[step]) throw new RangeError('Unbekannter Einrichtungsschritt');
    return { ...choices, [STEPS[step].key]: value };
}
export function stepDescription(step: number, choices: FeatureChoices): string {
    return t(step === 2 && !choices.preload ? 'setupNewsTextWithoutPreload' : STEPS[step].text);
}
