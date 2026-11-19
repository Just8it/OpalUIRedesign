/* ━━ Course view: shared types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Contract between the data layer (tree.ts, parsers.ts, loader.ts)
 * and the view (view.ts, render/*). Plain data only: everything here
 * must survive JSON, because snapshots are cached.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** What a course menu node is, reduced to what the view cares about. */
export type CourseNodeKind =
    | 'root'           // course start page
    | 'structure'      // grouping node without own content (OPAL "st")
    | 'folder'         // file folder (OPAL "bc")
    | 'page'           // single HTML page, often with file links (OPAL "sp")
    | 'announcements'  // "Mitteilungen" (OPAL "info")
    | 'links'          // link list, e.g. lecture videos (OPAL "ll")
    | 'literature'     // literature list (OPAL "bib")
    | 'calendar'       // course calendar (OPAL "cal" / "calendar")
    | 'interactive';   // enrolment, tests, forum, mail form, anything unknown: only OPAL's own page can show it

export interface CourseNode {
    /** OPAL node id (digits). */
    id: string;
    title: string;
    kind: CourseNodeKind;
    /** OPAL's own type code ("bc", "sp", "iqtest", ...), kept for labels and debugging. */
    rawType: string;
    /** Stable link to OPAL's page for this node: /opal/auth/RepositoryEntry/<course>/CourseNode/<id> */
    url: string;
    children: CourseNode[];
}

export type CourseEntryKind = 'file' | 'link' | 'video';

/** One thing the student can open: a file, an external link, a video. */
export interface CourseEntry {
    kind: CourseEntryKind;
    /** Best human label: link text if the lecturer wrote one, else the file name. */
    title: string;
    /** File name from the url, when it differs from the title. */
    fileName?: string;
    url: string;
    /** Lower-case extension without dot, files only. */
    extension?: string;
    /** As OPAL shows it, e.g. "1,2 MB". Folder tables only. */
    sizeText?: string;
    /** Last change in ms. Folder tables only. */
    modified?: number;
    /** Subfolder names inside the folder node, outermost first. Empty at the top level. */
    folderPath: string[];
    /** True for links that leave OPAL. */
    external: boolean;
    /** When this entry was first seen by this browser (ms). Set by the loader. */
    firstSeen: number;
    /** New or changed since the user last opened this course view. Set by the loader. */
    isNew: boolean;
}

export type CourseSectionState =
    | 'pending'   // not fetched yet
    | 'loaded'
    | 'empty'     // fetched, nothing to list
    | 'native'    // interactive: show a row that opens OPAL's page
    | 'error';

export type CourseSectionIssue =
    | { kind: 'sectionLoadError' | 'folderBudget' | 'folderMorePages' }
    | { kind: 'folderOpenInOpal'; title: string };

/** One menu node, flattened for display. Order follows the course menu. */
export interface CourseSection {
    nodeId: string;
    title: string;
    kind: CourseNodeKind;
    rawType: string;
    /** Titles of the ancestor nodes below the course root. */
    path: string[];
    /** OPAL's page for this node (the "open original" target). */
    url: string;
    state: CourseSectionState;
    entries: CourseEntry[];
    /** Plain-text intro of a 'page' node, shortened, without markup. */
    summary?: string;
    /** For 'page' nodes: the static HTML file OPAL shows in a frame. */
    frameUrl?: string;
    /** For 'page' nodes: the lecturer's page as a safe subset (parsers.sanitizePage). */
    html?: string;
    /** The page was longer than what is kept; OPAL's page has the rest. */
    htmlTruncated?: boolean;
    /** Load issue, or a pre-i18n message from an older cached snapshot. */
    error?: CourseSectionIssue | string;
    /** Folder nodes: the student may upload here (hand-in folder). Uploading happens on OPAL's own page. */
    canUpload?: boolean;
    /** Entries are listed but more may exist in OPAL (paging or load limit reached). */
    incomplete?: boolean;
}

export interface CourseAnnouncement {
    title: string;
    /** ms, when OPAL shows a date. */
    date?: number;
    author?: string;
    /** Plain text, shortened to a few hundred characters. */
    text: string;
    /** OPAL's announcements page. */
    url: string;
}

export interface CourseSnapshot {
    /** Digits of /RepositoryEntry/<id>. */
    courseId: string;
    title: string;
    /** e.g. "Wintersemester 2026 / 2027", when the start page shows it. */
    semester?: string;
    /** Start page of the course in OPAL. */
    url: string;
    tree: CourseNode;
    sections: CourseSection[];
    announcements: CourseAnnouncement[];
    /** When the newest section fetch finished (ms). */
    fetchedAt: number;
    /** When the user last had this course view open before the current visit (ms, 0 on first visit). */
    previousVisit: number;
    /** Stored mid-load: some sections are still 'pending'. The next load continues from here. */
    partial?: boolean;
    /** When the partial snapshot was stored (ms). */
    partialAt?: number;
}

export interface CourseLoadState {
    /** 'cache': snapshot comes from storage, a refresh is running.
     *  'loading': sections are still being fetched.
     *  'done': everything fetched. 'error': the course itself could not be loaded. */
    phase: 'cache' | 'loading' | 'done' | 'error';
    loaded: number;
    total: number;
    error?: string;
    stale?: boolean;
}

export interface CourseLoadHandle {
    /** Stop fetching and stop calling back (the view was closed). */
    cancel(): void;
    /** Fetch everything again, ignoring the cache age. */
    refresh(): void;
}

/**
 * loader.ts exports:
 *
 *   export function loadCourse(
 *       courseId: string,
 *       onUpdate: (snapshot: CourseSnapshot, state: CourseLoadState) => void,
 *   ): CourseLoadHandle;
 *
 * onUpdate is called repeatedly: first with the cached snapshot if there is
 * one, then as sections arrive (throttled), and a last time with phase 'done'.
 * The snapshot object is replaced on every call; the view must not mutate it.
 *
 *   export function courseIdFromUrl(url: string): string | null;
 *   export function isCourseViewEnabled(): Promise<boolean>;   // chrome.storage.local 'opalCourseViewEnabled', default false
 *   export function setCourseViewEnabled(on: boolean): Promise<void>;
 */
export const COURSE_VIEW_ENABLED_KEY = 'opalCourseViewEnabled';
