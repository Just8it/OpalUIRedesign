import { store } from './storage/store.ts';
import { keys } from './storage/registry.ts';
// First-paint gate. Never hide pages loaded by the catalog iframe indexer.
import { isCourseStartPath, parseCoursePath, prefersOriginal, readEnabledMirror, storedRootId, writeEnabledMirror } from './course/route';

(() => {
    if (window.self !== window.top) return;
    const path = location.pathname;
    const home = path.startsWith('/opal/home') || path === '/opal/' || path === '/opal';
    // Course start page: only when the mirrored switch is on and the user did
    // not pick OPAL's own page for this course in this tab.
    const course = home ? null : parseCoursePath(path);
    const courseView = !!course && readEnabledMirror() && !prefersOriginal(course.courseId)
        && isCourseStartPath(path, storedRootId);
    if (!home && !courseView) return;

    const html = document.documentElement;
    html.classList.add('opal-modern-pending');
    if (courseView) {
        html.classList.add('opal-course-pending');
        html.setAttribute('data-opal-course-active', '');
    }
    const restore = () => {
        html.classList.remove('opal-modern-pending', 'opal-course-pending');
        html.removeAttribute('data-opal-course-active');
    };
    const timer = window.setTimeout(restore, 5000);
    document.addEventListener('opal-dashboard-ready', () => window.clearTimeout(timer), { once: true });
    // Read the authoritative switches asynchronously; hiding must not wait for storage.
    try {
        void Promise.all([store.get(keys.enabled), store.get(keys.courseView)]).then(([enabled, courseEnabled]) => {
            if (!enabled) { restore(); return; }
            if (courseView && !courseEnabled) {
                writeEnabledMirror(false);
                restore();
            }
        }).catch(restore);
    } catch { restore(); }
})();
