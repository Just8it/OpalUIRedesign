/* Owns progress for the course view. */
import type { CourseLoadState } from '../types';

import { progressView } from '../render/header';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    load: CourseLoadState | null;
    progress: HTMLElement;
    progressFill: HTMLElement;
}

export function createProgress(context: Context) {
    const updateProgress = () => {
        const pv = progressView(context.load);
        context.progress.hidden = !pv.visible;
        context.progressFill.classList.toggle('is-indeterminate', !pv.determinate);
        context.progressFill.style.width = pv.determinate ? `${pv.percent}%` : '';
        if (pv.determinate && context.load) {
            context.progress.setAttribute('aria-valuemax', String(context.load.total));
            context.progress.setAttribute('aria-valuenow', String(Math.min(context.load.loaded, context.load.total)));
        } else {
            context.progress.removeAttribute('aria-valuemax');
            context.progress.removeAttribute('aria-valuenow');
        }
        if (pv.text) context.progress.setAttribute('aria-valuetext', pv.text);
        return pv;
    };
    return { updateProgress };
}
