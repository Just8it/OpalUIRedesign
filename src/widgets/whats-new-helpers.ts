import { formatRelative } from '../i18n/core.ts';
import { t } from '../i18n/messages/widgets.ts';
import type { SearchResult } from '../core/search/types.ts';
export function groupNewFiles(items: SearchResult[]): Map<string, SearchResult[]> {
    const groups = new Map<string, SearchResult[]>();
    for (const item of items) {
        const course = item.path[0] || t('whatsNewOtherFiles');
        groups.set(course, [...(groups.get(course) ?? []), item]);
    }
    return groups;
}
export function relativeTime(timestamp: number, now = Date.now()): string {
    const hours = Math.max(0, Math.floor((now - timestamp) / 3600000));
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const day = new Date(timestamp); day.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - day.getTime()) / 86400000);
    if (days === 1) return formatRelative(-1, 'day');
    if (days > 1) return t('whatsNewDaysAgo', { count: days });
    return hours ? t('whatsNewHoursAgo', { count: hours }) : t('whatsNewJustNow');
}

/** Stable OPAL paths can open directly; Wicket listener URLs depend on page state. */
export function isStableNewFileUrl(value: string): boolean {
    try {
        const url = new URL(value, 'https://bildungsportal.sachsen.de');
        return url.origin === 'https://bildungsportal.sachsen.de' && url.pathname.startsWith('/opal/')
            && !/\?\d+-\d+\./.test(url.href);
    } catch { return false; }
}
