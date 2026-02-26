/* ━━ Utility Functions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** Deterministic HSL colour from a string */
export function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 60%)`;
}

/** 1–2 letter initials from a title */
export function getInitials(title: string): string {
    const words = title.split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

/** Truncate with ellipsis */
export function truncate(title: string, maxLen = 60): string {
    if (title.length <= maxLen) return title;
    return title.substring(0, maxLen - 1).trim() + '\u2026';
}

/** HTML-escape text content */
export function escapeHtml(text: string): string {
    const el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
}
