/* ━━ Course view: browser layout ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * The course page is a two-pane file browser: a sidebar that says
 * WHAT is shown, and one aligned list that shows it. Nothing else.
 * This file is the contract between the pure model (this folder)
 * and the view (../view.ts, ../render/*).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { CourseEntry } from '../types';
import type { EntryCategory, Located, OpenedMap } from '../find/types';

/* ── Sidebar ───────────────────────────────────────────────── */

/** What a sidebar item selects. Serialised as `id` (e.g. "all", "cat:exercise", "sec:1234"). */
export type NavKind =
    | 'home'           // the course overview (Übersicht)
    | 'all'            // every file, grouped by section
    | 'recent'         // files the user opened in this course
    | 'changed'        // new since last visit and recently changed
    | 'category'       // Vorlesungen / Übungen (with their Lösungen) / Prüfungen / Videos
    | 'upload'         // hand-in folders
    | 'group'          // a structure node: all sections below it
    | 'section'        // one section
    | 'announcements'  // the announcements, shown in the list pane
    | 'area';          // enrolment, forum, test ...: a link that opens OPAL's page

export interface NavItem {
    id: string;
    kind: NavKind;
    label: string;
    /** Files (and links) behind this item. Omitted for 'area'. */
    count?: number;
    /** 0 = top level, 1 = below a 'group'. Never deeper: deeper structure is flattened into the label. */
    depth: 0 | 1;
    /** Something new since the last visit sits behind this item. */
    hasNew?: boolean;
    category?: EntryCategory;
    /** 'area': OPAL page to open. 'section'/'group': OPAL page of the node (for "In OPAL öffnen"). */
    url?: string;
    /** Hidden by the user (shown dimmed, only while customising). */
    hidden?: boolean;
}

/** Sidebar blocks, top to bottom. `title` null = the untitled first block:
 *  Übersicht, then what a student studies (Vorlesungen, Übungen, ...).
 *  "Aktuell" holds what changed or was opened, "Kursinhalt" mirrors the
 *  lecturer's menu (with "Alle Dateien" first), "Weitere Bereiche" links out. */
export interface NavBlock {
    key: 'study' | 'activity' | 'content' | 'areas';
    title: string | null;
    items: NavItem[];
}

/* ── List ──────────────────────────────────────────────────── */

export type SortKey = 'order' | 'name' | 'type' | 'size' | 'modified';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }

export interface ListEntry {
    entry: CourseEntry;
    category: EntryCategory;
    /** Display name without the file extension (the Typ column has it). */
    name: string;
    /** `name` split for middle truncation: `head` may be cut, `tail` always stays visible. */
    head: string;
    tail: string;
    /** File name, only when it differs from the title in a way worth showing. */
    fileName?: string;
    /** "PDF", "ZIP", "Link", "Video" ... */
    type: string;
    /** Normalised: "267 KB", "1,4 MB". Empty when unknown. */
    size: string;
    sizeBytes?: number;
    /** "12.10.2026", or "heute" / "gestern" for the last two days. Empty when unknown. */
    modified: string;
    modifiedMs?: number;
    isNew: boolean;
    /** ms the user last opened it, when they did. */
    openedAt?: number;
    /** The paired solution (exercise rows only). */
    solution?: CourseEntry;
    /** Where the entry lives, for rows shown outside their section: "Vorlesung › Kapitel 2". */
    location: string;
    /** [start, end) ranges in `name` to emphasise (search). */
    ranges: [number, number][];
}

/** A run of entries under one subfolder label ('' = directly in the section). */
export interface ListFolder {
    label: string;
    entries: ListEntry[];
}

export interface ListGroup {
    /** Section node id, or a synthetic id for flat lists ("recent", "results"). */
    id: string;
    title: string;
    /** Ancestor titles of the section, for the muted prefix. */
    path: string[];
    count: number;
    /** OPAL page of the section. */
    url?: string;
    canUpload?: boolean;
    /** Why the group may be incomplete (shown as one muted line). */
    note?: string;
    state: 'loaded' | 'pending' | 'empty' | 'error';
    folders: ListFolder[];
    /** The section is a lecturer's page with text: one excerpt line, the page html behind "Mehr". */
    intro?: { excerpt: string; html: string; truncated?: boolean };
}

export interface ListModel {
    /** Heading of the list pane: "Alle Dateien", "Übung", "Treffer für „ü 5“" ... */
    title: string;
    /** "41 Dateien", "3 Treffer" ... */
    summary: string;
    /** false = one flat list without group headers (recent, changed, search results, sorted views). */
    grouped: boolean;
    /** Show the location column (entries are outside their section context). */
    showLocation: boolean;
    groups: ListGroup[];
    /** Present when nothing can be listed: a calm one-line explanation. */
    empty?: string;
}

/* ── Preferences ───────────────────────────────────────────── */

/** chrome.storage.local `opalCourseLayout` (all courses). */
export interface BrowseLayout {
    density: 'compact' | 'normal';
    columns: { type: boolean; size: boolean; modified: boolean };
    sidebar: boolean;
}

/** chrome.storage.local `opalCoursePrefs_<courseId>`. */
export interface BrowsePrefs {
    /** Section node ids in the user's order; unknown ids are ignored, new ones go last. */
    order: string[];
    hidden: string[];
    collapsed: string[];
    /** Pages whose text the student unfolded; they stay unfolded on the next visit. */
    open?: string[];
    /** Last sidebar selection, restored on the next visit. */
    selected?: string;
    sort?: Sort;
}

/**
 * Functions exported from ./index.ts:
 *
 *   buildNav(snapshot, located, opened, prefs, editing): NavBlock[]
 *   buildList(args: { snapshot, located, opened, prefs, selected: string, query: string, sort: Sort }): ListModel
 *   splitName(name: string): { head: string; tail: string }      // tail = last ~12 characters, never splits a number
 *   formatSize(sizeText: string | undefined): { text: string; bytes?: number }
 *   formatModified(ms: number | undefined, now: number): string
 *   defaultLayout(): BrowseLayout
 *   normaliseLayout(raw: unknown): BrowseLayout                  // also migrates the previous `{ columns: number, density, blocks }` shape
 *   normalisePrefs(raw: unknown, sectionIds: string[]): BrowsePrefs   // also migrates `wide` away
 *   moveSection(prefs, sectionIds, id, delta: -1 | 1): BrowsePrefs
 *
 * `located` comes from ../find (locate()), `opened` from ../find/history.
 */
export type { Located, OpenedMap };
