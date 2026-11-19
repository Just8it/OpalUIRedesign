/* ━━ Course view: finding things ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Contract between the pure "find" logic (this folder) and the view.
 * The course view exists to answer four questions fast:
 *   1. Where is the current lecture's material?      -> latest()
 *   2. Where is exercise 5, and its solution?         -> match(), pairSolutions()
 *   3. What changed since I was last here?            -> latest() + CourseEntry.isNew
 *   4. Where was I?                                   -> recent()
 * Everything here is pure and works on a CourseSnapshot; only
 * history.ts touches storage.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { t } from '../../i18n/messages/course.ts';
import type { CourseEntry, CourseSection } from '../types';

/** What a file is for, from the student's point of view. */
export type EntryCategory = 'lecture' | 'exercise' | 'solution' | 'exam' | 'video' | 'other';

/** Display order and labels of the scope row. 'all' is the default scope. */
export const CATEGORY_ORDER: EntryCategory[] = ['lecture', 'exercise', 'solution', 'exam', 'video', 'other'];
export const CATEGORY_LABEL: Record<EntryCategory, string> = {
    get lecture() { return t('categoryLecture'); },
    get exercise() { return t('categoryExercise'); },
    get solution() { return t('categorySolution'); },
    get exam() { return t('categoryExam'); },
    get video() { return t('categoryVideo'); },
    get other() { return t('categoryOther'); },
};
/** Course-wide collections in the sidebar and list title: "Vorlesungen" reads as
 *  "everything of that kind", next to the lecturer's own "Vorlesung" folder. */
export const CATEGORY_PLURAL: Record<EntryCategory, string> = {
    get lecture() { return t('categoryLectures'); },
    get exercise() { return t('categoryExercises'); },
    get solution() { return t('categorySolutions'); },
    get exam() { return t('categoryExams'); },
    get video() { return t('categoryVideos'); },
    get other() { return t('categoryOtherPlural'); },
};

/** An entry together with where it lives. The unit every function below works on. */
export interface Located {
    entry: CourseEntry;
    section: CourseSection;
    category: EntryCategory;
    /** Sheet / lecture / chapter number when the title or file name has one ("Übung 05" -> 5). */
    number?: number;
}

/** One ranked hit of the course filter. */
export interface FindHit extends Located {
    /** Higher is better; only hits with score > 0 are returned. */
    score: number;
    /** [start, end) ranges in entry.title to highlight. */
    titleRanges: [number, number][];
}

/** An exercise (or other item) with the solution that belongs to it. */
export interface PairedEntry extends Located {
    solution?: CourseEntry;
}

/**
 * Functions the view imports (one module each, re-exported from ./index.ts):
 *
 *   locate(sections): Located[]
 *       Every entry of every listable section, classified and numbered, in page order.
 *
 *   categoryCounts(located): Partial<Record<EntryCategory, number>>
 *
 *   find(located, query, scope: EntryCategory | 'all'): FindHit[]
 *       Ranked, best first. Empty query with a scope returns that scope in page order (score 1).
 *
 *   pairSolutions(located): PairedEntry[]
 *       Same order as the input, minus the entries that became someone's `solution`.
 *
 *   latest(located, limit): Located[]
 *       Newest first by max(entry.modified, entry.firstSeen); entries with isNew first.
 *
 *   recent(located, opened: OpenedMap, limit): Located[]
 *       What the user opened in this course, most recent first.
 *
 *   history.ts: loadOpened(courseId): Promise<OpenedMap>
 *               recordOpened(courseId, url): Promise<OpenedMap>
 */
export type OpenedMap = Record<string, number>;
