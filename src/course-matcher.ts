/* ━━ Course Matcher ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Uses Fuse.js to fuzzy-match calendar event titles against
 * the user's favorites / enrolled courses.
 *
 * Returns a stable color per matched course so all events
 * from the same lecture share a colour in the calendar.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import Fuse from 'fuse.js';
import type { CourseItem } from './types';

/* ── Colour palette (same as calendar default) ─────────────── */

export const COURSE_GRADIENTS = [
    ['#4f46e5', '#7c3aed'], // indigo → violet
    ['#059669', '#0d9488'], // emerald → teal
    ['#e11d48', '#ea580c'], // rose → orange
    ['#2563eb', '#0891b2'], // blue → cyan
    ['#c026d3', '#db2777'], // fuchsia → pink
    ['#d97706', '#ea580c'], // amber → orange
    ['#7c3aed', '#6366f1'], // violet → indigo
    ['#0891b2', '#059669'], // cyan → emerald
];

/* ── Types ─────────────────────────────────────────────────── */

export interface CourseMatch {
    course: CourseItem;
    color: string;
    score: number; // 0 = perfect match, 1 = no match
}

/* ── Matching engine ───────────────────────────────────────── */

let fuse: Fuse<CourseItem> | null = null;
let currentCourses: CourseItem[] = [];
let currentThreshold = 0.4;
let colorMap: Map<string, string> = new Map(); // courseTitle → color
let matchCache: Map<string, CourseMatch | null> = new Map(); // eventTitle → match

/** Update the Fuse.js threshold (called when user changes the slider) */
export function setMatchThreshold(threshold: number): void {
    if (threshold === currentThreshold) return;
    currentThreshold = threshold;
    matchCache.clear();
    // Rebuild index with new threshold
    if (currentCourses.length > 0) {
        updateCourseIndex(currentCourses);
    }
}

/** Re-index the matcher when courses/favorites change */
export function updateCourseIndex(courses: CourseItem[]): void {
    currentCourses = courses;

    // Assign stable colors based on course order
    colorMap.clear();
    courses.forEach((c, i) => {
        // Use the primary (first) color of the gradient for calendar dots
        colorMap.set(c.title, COURSE_GRADIENTS[i % COURSE_GRADIENTS.length][0]);
    });

    // Build Fuse index with weighted keys
    fuse = new Fuse(courses, {
        keys: [
            { name: 'moduleCode', weight: 3 },   // module codes are most reliable
            { name: 'title', weight: 1 },         // full title as fallback
        ],
        threshold: currentThreshold,
        includeScore: true,
        ignoreLocation: true, // search entire string, not just beginning
        minMatchCharLength: 3,
    });

    // Clear match cache since courses changed
    matchCache.clear();
}

/** Find the best matching course for a calendar event title */
export function matchEventToCourse(eventTitle: string): CourseMatch | null {
    if (!fuse || currentCourses.length === 0) return null;

    // Check cache first
    if (matchCache.has(eventTitle)) {
        return matchCache.get(eventTitle)!;
    }

    // Try fuzzy match with Fuse.js
    const results = fuse.search(eventTitle);

    let match: CourseMatch | null = null;

    if (results.length > 0 && results[0].score !== undefined) {
        const best = results[0];
        // Only accept matches below the threshold (Fuse already filters, but double-check)
        if (best.score! < currentThreshold + 0.1) {
            match = {
                course: best.item,
                color: colorMap.get(best.item.title) || COURSE_GRADIENTS[0][0],
                score: best.score!,
            };
        }
    }

    // Cache the result (including null for misses)
    matchCache.set(eventTitle, match);
    return match;
}

/** Get a color for a calendar event, preferring course match */
export function getEventCourseColor(eventTitle: string): string | null {
    const match = matchEventToCourse(eventTitle);
    return match ? match.color : null;
}

/** Clear the match cache (e.g. when ICS events change) */
export function clearMatchCache(): void {
    matchCache.clear();
}
