export type NewsSource = 'news' | 'info' | 'announcements';
export interface Announcement {
    title: string; link?: string; dateRaw?: string; dateMs?: number;
    tag: NewsSource; sources?: NewsSource[]; source?: string; isNew?: boolean;
}
/** OPAL's feed line 'Mitteilung "AERO V 3.1-3.2" wurde von Jörg Stiller erstellt' says one thing:
 *  the subject. Split it into subject and author; any other title comes back unchanged. */
export function splitNewsTitle(title: string): { subject: string; author?: string } {
    const m = /^(?:Mitteilung|Neuigkeit|Nachricht|Message|News)\s*[„"“”'‚‘](.+)[“"”'‘’]\s+(?:wurde|was)\s+(?:von|by)\s+(.+?)\s+(?:erstellt|geändert|aktualisiert|veröffentlicht|bearbeitet|created|updated|edited|published)\.?$/i.exec(title.trim());
    return m ? { subject: m[1].trim(), author: m[2].trim() } : { subject: title.trim() };
}

export function mergeNews(items: Announcement[]): Announcement[] {
    const groups: Announcement[][] = [];
    const norm = (s: string) => s.normalize('NFKC').toLocaleLowerCase('de').replace(/\s+/g, ' ').trim();
    for (const item of items) {
        const matches = groups.filter(g => g.some(i => (item.link && i.link === item.link) || norm(i.title) === norm(item.title)));
        matches.forEach(g => groups.splice(groups.indexOf(g), 1));
        groups.push([item, ...matches.flat()]);
    }
    return groups.map(g => ({
        ...g.slice().sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0))[0],
        sources: [...new Set(g.flatMap(i => i.sources ?? [i.tag]))],
    })).sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0));
}
