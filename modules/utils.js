/**
 * utils.js — Shared helpers
 */

/**
 * Generates a short color based on a string hash.
 * Used to give each course card a unique accent color.
 * @param {string} str 
 * @returns {string} HSL color string
 */
export function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 60%)`;
}

/**
 * Extracts the initials from a course title (first 2 uppercase words).
 * e.g. "Grundlagen der Elektrotechnik" → "GE"
 * @param {string} title 
 * @returns {string}
 */
export function getInitials(title) {
    const words = title.split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Shortens a title to maxLen characters with ellipsis.
 * @param {string} title 
 * @param {number} maxLen 
 * @returns {string}
 */
export function truncate(title, maxLen = 60) {
    if (title.length <= maxLen) return title;
    return title.substring(0, maxLen - 1).trim() + '…';
}

/**
 * Extracts the module code from parenthesized text at the end of a title.
 * e.g. "... (MW-MB-14)" → "MW-MB-14"
 * @param {string} title 
 * @returns {string|null}
 */
export function extractModuleCode(title) {
    const match = title.match(/\(([A-Z]{2,}-[A-Z0-9-]+(?:,\s*[A-Z]{2,}-[A-Z0-9-]+)*)\)\s*$/);
    return match ? match[1] : null;
}
