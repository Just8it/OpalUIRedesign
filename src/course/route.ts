/* ━━ Course view: routing and synchronous page-origin flags ━━━━━━
 * Shared by early.ts (document_start, no async storage) and the
 * content script. early.js cannot wait for chrome.storage, so the
 * content script mirrors what the gate needs into the page origin's
 * localStorage / sessionStorage, which content scripts share:
 *
 *   localStorage   opalCourseView.enabled   '1' | '0'
 *   localStorage   opalCourseView.roots     {"<courseId>": "<rootNodeId>"}
 *   sessionStorage opalCourseView.original:<courseId>   '1' = user chose
 *                  OPAL's own page for the rest of this tab session
 * Every access is wrapped: storage can be blocked or throw.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export const ENABLED_MIRROR_KEY = 'opalCourseView.enabled';
export const ROOTS_KEY = 'opalCourseView.roots';
export const ORIGINAL_PREFIX = 'opalCourseView.original:';

export interface CoursePath {
    courseId: string;
    /** Node id from /CourseNode/<id>, null when the url names the course only. */
    nodeId: string | null;
    /** True when nothing follows the course or node id (no file, no sub page). */
    exact: boolean;
}

/** /opal/auth/RepositoryEntry/<id>[/CourseNode/<id>][/...]; null for any other page. */
export function parseCoursePath(pathname: string): CoursePath | null {
    const m = /^\/opal\/(?:auth|url)\/RepositoryEntry\/(\d+)(?:\/CourseNode\/(\d+))?(\/.*)?$/i.exec(pathname);
    if (!m) return null;
    const rest = m[3] ?? '';
    return { courseId: m[1], nodeId: m[2] ?? null, exact: rest === '' || rest === '/' };
}

/** The course start page: the bare course url, or its root node. A node url
 *  whose root id is unknown is NOT treated as the start page. */
export function isCourseStartPath(pathname: string, rootIdOf: (courseId: string) => string | null): boolean {
    const p = parseCoursePath(pathname);
    if (!p || !p.exact) return false;
    if (p.nodeId === null) return true;
    const root = rootIdOf(p.courseId);
    return root !== null && root === p.nodeId;
}

/* ── localStorage / sessionStorage mirrors ─────────────────────── */

export function readEnabledMirror(): boolean {
    try { return localStorage.getItem(ENABLED_MIRROR_KEY) === '1'; } catch { return false; }
}

export function writeEnabledMirror(on: boolean): void {
    try { localStorage.setItem(ENABLED_MIRROR_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}

function readRoots(): Record<string, string> {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(ROOTS_KEY) ?? '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
    } catch { return {}; }
}

export function storedRootId(courseId: string): string | null {
    const id = readRoots()[courseId];
    return typeof id === 'string' && /^\d+$/.test(id) ? id : null;
}

/** Remember a course's root node so early.js can recognise /CourseNode/<root>. */
export function rememberRootId(courseId: string, rootId: string): void {
    if (!/^\d+$/.test(courseId) || !/^\d+$/.test(rootId)) return;
    const roots = readRoots();
    if (roots[courseId] === rootId) return;
    roots[courseId] = rootId;
    const keys = Object.keys(roots);
    // A few hundred bytes at most: keep the 40 most recently added courses.
    for (const key of keys.slice(0, Math.max(0, keys.length - 40))) delete roots[key];
    try { localStorage.setItem(ROOTS_KEY, JSON.stringify(roots)); } catch { /* storage blocked */ }
}

export function prefersOriginal(courseId: string): boolean {
    try { return sessionStorage.getItem(ORIGINAL_PREFIX + courseId) === '1'; } catch { return false; }
}

export function setPrefersOriginal(courseId: string, on: boolean): void {
    try {
        if (on) sessionStorage.setItem(ORIGINAL_PREFIX + courseId, '1');
        else sessionStorage.removeItem(ORIGINAL_PREFIX + courseId);
    } catch { /* storage blocked */ }
}

/** Root node id and title from OPAL's inline menu data (var initial_data=[{...icon-root...}]). */
export function rootFromMenuScript(source: string): { id: string; title: string } | null {
    const m = /initial_data\s*=\s*\[\{"id":"id(\d+)","text":"((?:[^"\\]|\\.)*)","icon":"[^"]*\bicon-root\b/.exec(source);
    if (!m) return null;
    let text = m[2];
    try { text = JSON.parse(`"${m[2]}"`) as string; } catch { /* keep raw */ }
    const title = text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
    return { id: m[1], title };
}
