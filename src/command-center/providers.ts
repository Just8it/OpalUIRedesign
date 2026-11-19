import { changedSinceVisit, continueCourse, courseLastVisit } from './course-shortcuts.ts';
import { parseShortcut } from './materials';
import { t } from '../i18n/messages/search.ts';
/* Owns providers for the command center. */

import type { CourseItem } from '../types';
import { searchNodes, recentNodes, nodesByCourse, type IndexNode, type SearchResult } from '../core/search-engine';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    parseCommandQuery: (query: string) => { commandMode: boolean; query: string };
    viewSeq: number;
    closed: boolean;
    mode: CmdMode;
    tokens: string[];
    homeHistory: string[];
    results: SearchResult[];
    selectedIdx: number;
    rerender: () => void;
    debounce: number | undefined;
    input: HTMLInputElement;
    drillCourse: IndexNode | null;
    drillFileCount: number;
    courseId: string;
    RECENTS_LIMIT: number;
    loadHistory: () => Promise<string[]>;
    asResult: (node: IndexNode, score?: number) => SearchResult;

    findCommandActions: (query: string) => SearchResult[];
    _favorites: Map<string, CourseItem>;
    highlightTokens: (query: string) => string[];
}

export function createProviders(context: Context) {
    const showHome = async () => {
        const seq = ++context.viewSeq;
        const [recents, hist] = await Promise.all([
            recentNodes(context.RECENTS_LIMIT).catch(() => [] as SearchResult[]),
            context.loadHistory(),
        ]);
        if (seq !== context.viewSeq || context.closed) return;
        context.mode = 'home';
        context.tokens = [];
        context.homeHistory = hist;
        context.results = recents;
        context.selectedIdx = 0;
        context.rerender();
    };

    const enterDrillMode = async (course: IndexNode) => {
        const seq = ++context.viewSeq;
        clearTimeout(context.debounce);

        // Always resolve to the root RepositoryEntry — a course node may have
        // been stored with a CourseNode sub-URL as its courseId (passive indexer
        // breadcrumb edge case). Folder/file nodes are keyed on the root path.
        const cid = (() => {
            const url = course.url || '';
            try {
                const path = new URL(url, location.origin).pathname;
                const m =
                    path.match(/(\/opal\/[^/]*\/RepositoryEntry\/\d+)/i) ?? path.match(/(\/RepositoryEntry\/\d+)/i);
                return m ? m[1] : course.courseId || course.id;
            } catch {
                return course.courseId || course.id;
            }
        })();

        try {
            // Files matching current query within this course
            const rawQ = context.input.value
                .trim()
                .replace(/^\/\w\s+/, '')
                .trim();
            const [hits, folderNodes] = await Promise.all([
                rawQ ? searchNodes('/f ' + rawQ, cid, 20, { courseId: cid }) : Promise.resolve([] as SearchResult[]),
                nodesByCourse(cid, 'folder'),
            ]);
            let files = hits.filter((r) => r.node.type === 'file' && r.node.courseId === cid).slice(0, 5);

            // If no folders indexed yet, fall back to showing recently indexed files
            if (folderNodes.length === 0 && files.length === 0) {
                const allFiles = await nodesByCourse(cid, 'file', 8);
                files = allFiles.map((f) => context.asResult(f));
            }
            if (seq !== context.viewSeq || context.closed) return;

            context.drillCourse = course;
            context.mode = 'drill';
            context.selectedIdx = 0;
            context.drillFileCount = files.length;
            context.results = [...files, ...folderNodes.map((f) => context.asResult(f))];
            context.rerender();
        } catch (err) {
            console.warn('[OPAL] Course drill-down failed:', err);
        }
    };

    const runSearch = async (q: string) => {
        const seq = ++context.viewSeq;
        if (context.parseCommandQuery(q).commandMode) {
            context.mode = 'search';
            context.tokens = [];
            context.selectedIdx = 0;
            context.results = context.findCommandActions(q);
            context.rerender();
            return;
        }

        if (q.startsWith('/') && !q.startsWith('/c ') && !q.startsWith('/f ')) {
            context.mode = 'search';
            context.results = [];
            context.rerender();
            return;
        }

        const shortcut = parseShortcut(q);
        if (shortcut) {
            const courses = (await searchNodes('/c ' + shortcut.course, context.courseId, 20)).filter(r => r.node.type === 'course');
            const groups = await Promise.all(courses.map(async r => {
                const id = r.node.courseId || r.node.id;
                if (shortcut.action === 'weiter') return continueCourse(id);
                const nodes = await nodesByCourse(id, 'file');
                const visit = Math.max(await courseLastVisit(id), r.node.lastVisited);
                return nodes.filter(n => changedSinceVisit(n, Math.max(n.lastVisited, visit)));
            }));
            if (seq !== context.viewSeq || context.closed) return;
            context.results = groups.flat().map(n => context.asResult(n));
            context.mode = 'search'; context.tokens = []; context.selectedIdx = 0; context.rerender(); return;
        }
        const isCoursesOnly = q.startsWith('/c ');
        const isFilesOnly = q.startsWith('/f ');
        const displayQ = isCoursesOnly || isFilesOnly ? q.slice(3).trim() : q;

        let raw: SearchResult[];
        try {
            raw = await searchNodes(q, context.courseId, 30, { excludeCatalog: !isCoursesOnly && !isFilesOnly });
        } catch (err) {
            console.warn('[OPAL] Search failed:', err);
            raw = [];
        }
        // A newer keystroke, a drill-down or close happened meanwhile.
        if (seq !== context.viewSeq || context.closed) return;

        // ── Substring-match favorites the index may not know yet ──
        const qLower = (displayQ || q).toLowerCase();
        const rawIds = new Set(
            raw.map((r) => {
                try {
                    return new URL(r.node.url, location.origin).pathname.replace(/\/$/, '');
                } catch {
                    return '';
                }
            }),
        );
        const extraFavs: SearchResult[] = [];
        if (!isFilesOnly) {
            for (const [path, course] of context._favorites) {
                if (rawIds.has(path)) continue;
                if (course.title.toLowerCase().includes(qLower)) {
                    extraFavs.push(
                        context.asResult(
                            {
                                id: path,
                                title: course.title,
                                url: course.href,
                                type: 'course',
                                courseId: path,
                                parentId: null,
                                lastVisited: 0,
                                visitCount: 0,
                                source: 'user',
                            },
                            999,
                        ),
                    );
                }
            }
        }

        // ── Synthetic search action ───────────────────────────
        const searchAction = context.asResult({
            id: '__opal-search-action__',
            title: t('opalQuery', { query: displayQ || q }),
            url: `/opal/auth/search/finder?search_input=${encodeURIComponent(displayQ || q)}&search_button=`,
            type: 'action',
            courseId: '',
            parentId: null,
            lastVisited: 0,
            visitCount: 0,
            description: t('opalQueryHint'),
        });

        // The engine's order is the ranking. Favourites the index does not know
        // yet go first because only their title matched; commands and the OPAL
        // search come last so Enter on a typed query never runs a command.
        const ranked = raw.filter(
            (r) => r.node.type !== 'action' && (isCoursesOnly || isFilesOnly || r.node.source !== 'catalog'),
        );
        context.results = isFilesOnly ? ranked.slice(0, 8) : [...extraFavs, ...ranked].slice(0, 8).concat(searchAction);

        context.mode = 'search';
        context.tokens = context.highlightTokens(q);
        context.selectedIdx = 0;
        context.rerender();
    };
    return { showHome, enterDrillMode, runSearch };
}

type CmdMode = 'home' | 'search' | 'drill';
