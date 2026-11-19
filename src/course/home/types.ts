/* ━━ Course view: landing page ("Übersicht") ━━━━━━━━━━━━━━━━━━━━
 * The course opens on a page the student arranges: a few clearly
 * separated blocks (Vorlesung, Übung, Prüfung, Angepinnt, ...). Each
 * series block knows WHERE THE STUDENT IS and shows that first.
 *
 * "Where I am" never comes from upload dates: lecturers upload weeks
 * or months ahead. It comes from the student's own progress (units
 * ticked as done) and a pointer they can move by hand.
 *
 * Contract between the pure model (this folder) and the view.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import type { CourseAnnouncement, CourseEntry } from '../types';
import type { EntryCategory } from '../find/types';

/* ── Stored state ──────────────────────────────────────────── */

/** What feeds a block. */
export type BlockSource =
    | { type: 'category'; category: EntryCategory }      // every entry of that kind, course-wide
    | { type: 'sections'; sectionIds: string[] }         // whole menu sections (node ids)
    | { type: 'folder'; sectionId: string; folderPath: string[] } // one subfolder of a section
    | { type: 'page'; sectionId: string }                // a lecturer's page (schedule, contacts), shown as a preview
    | { type: 'pinned' }
    | { type: 'announcements' };

export interface BlockConfig {
    /** Stable id: "cat:lecture", "sec:<nodeId>", "pinned", "ann", or "custom:<n>". */
    id: string;
    /** Shown in the block header; the user can rename it. */
    title: string;
    /** English generated titles are tagged. An absent tag also supports legacy German titles. Null marks a rename. */
    titleLocale?: 'en' | null;
    source: BlockSource;
    /** Index into the block colour palette (0..7): a small mark in the header, nothing else. */
    color: number;
    hidden: boolean;
    /** true = a sequence with a current position (Vorlesung, Übung); false = a plain list. */
    series: boolean;
}

/** chrome.storage.local `opalCourseHome_<courseId>`. */
export interface HomeConfig {
    version: 1;
    /** Display order. */
    blocks: BlockConfig[];
}

/** chrome.storage.local `opalCourseProgress_<courseId>`. */
export interface CourseProgress {
    /** unit key -> ms when the student ticked it. */
    done: Record<string, number>;
    /** block id -> unit key the student set as "here". Absent = first unit that is not done. */
    pointer: Record<string, string>;
    /** Entry urls. */
    pinned: string[];
}

/* ── Derived model ─────────────────────────────────────────── */

/**
 * One step of a series: "Kapitel 2 - Potentialtheorie" (a folder with its
 * files), "Übung 5" (a sheet with its solution), or a single file.
 */
export interface Unit {
    /** Stable across reloads: derived from section id + folder path, or section id + item number/url. */
    key: string;
    title: string;
    /** Sheet / chapter / lecture number when there is one. */
    number?: number;
    /** Files of the unit, the main one first. Never empty. */
    entries: CourseEntry[];
    /** Paired solutions (exercise units). */
    solutions: CourseEntry[];
    /** Where it lives, for the muted meta line: "Vorlesung" or "Übung › Aufgaben". */
    location: string;
    state: 'done' | 'current' | 'upcoming' | 'past';
    /** ms when ticked, for done units. */
    doneAt?: number;
    hasNew: boolean;
}

export interface SeriesBlock {
    kind: 'series';
    config: BlockConfig;
    /** All units in order (number, then page order). */
    units: Unit[];
    /** The unit to work on now; undefined when everything is done or the block is empty. */
    current?: Unit;
    /** The next units after `current` (at most 3). */
    next: Unit[];
    /** Units before the pointer or ticked done, most recent first. */
    earlier: Unit[];
    /** e.g. "3 von 12 erledigt". */
    progressText: string;
    doneCount: number;
}

export interface ListBlock {
    kind: 'list';
    config: BlockConfig;
    /** Plain entries in page order (pinned: in pin order). */
    entries: CourseEntry[];
    /** How many exist beyond what the block shows. */
    total: number;
}

export interface AnnouncementBlock {
    kind: 'announcements';
    config: BlockConfig;
    items: CourseAnnouncement[];
    total: number;
    /** Newer than the last visit. */
    unread: number;
}

export interface PageBlock {
    kind: 'page';
    config: BlockConfig;
    /** Sanitised page html (CourseSection.html). */
    html: string;
    /** Files linked from the page. */
    total: number;
}

export type HomeBlock = SeriesBlock | ListBlock | AnnouncementBlock | PageBlock;

export interface HomeModel {
    blocks: HomeBlock[];
    /** Blocks hidden by the user (only needed while customising). */
    hidden: BlockConfig[];
    /** Sources the user could add as a block: sections and subfolders not covered by a visible block. */
    addable: { id: string; title: string; displayTitle?: string; source: BlockSource; count: number }[];
    /** True when the course has nothing to build blocks from. */
    empty: boolean;
}

/**
 * Functions exported from ./index.ts:
 *
 *   defaultHome(snapshot, located): HomeConfig
 *       Vorlesung, Übung (series), Prüfung (list), then one list block per section that holds
 *       files of no recognised kind and has at least 3 entries (max 3 such blocks), then
 *       Angepinnt and Mitteilungen. Blocks whose source is empty are left out.
 *   normaliseHome(raw: unknown, snapshot, located): HomeConfig
 *       Validates stored config, drops sources that no longer exist, never loses user order.
 *   buildHome(args: { snapshot, located, config, progress, opened, editing }): HomeModel
 *   normaliseProgress(raw: unknown): CourseProgress
 *   toggleDone(progress, unitKey, now): CourseProgress          // ticking the current unit clears that block's manual pointer when it pointed at it
 *   setPointer(progress, blockId, unitKey | null): CourseProgress
 *   togglePin(progress, url): CourseProgress
 *   moveBlock(config, id, delta: -1 | 1): HomeConfig
 *   updateBlock(config, id, patch: Partial<Pick<BlockConfig, 'title' | 'color' | 'hidden' | 'series'>>): HomeConfig
 *   addBlock(config, source: BlockSource, title: string): HomeConfig
 *   removeBlock(config, id): HomeConfig                          // only custom / section / folder blocks; built-ins are hidden instead
 *   blockSelectionId(block: BlockConfig): string                 // the browse-list selection that shows "everything in this block" ("cat:lecture", "sec:<id>", ...)
 *   loadHome(courseId) / saveHome(courseId, config)              // storage (the only impure part, with loadProgress / saveProgress)
 *
 * `located` comes from ../find (locate()), `opened` from ../find/history.
 */
export const BLOCK_COLOR_COUNT = 8;
