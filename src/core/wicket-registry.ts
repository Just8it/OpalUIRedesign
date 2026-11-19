/** Parse only Wicket's literal u/c fields; never evaluate page JavaScript. */
export function parseWicketRegistrations(script: string): { id: string; path: string }[] {
    const entries: { id: string; path: string }[] = [];
    for (const match of script.matchAll(/Wicket\.Ajax\.ajax\s*\(\s*\{([\s\S]*?)(?=Wicket\.Ajax\.ajax|$)/g)) {
        const fields = new Map<string, string>();
        for (const field of match[1].matchAll(/"(u|c)"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
            if (!fields.has(field[1])) {
                try { fields.set(field[1], JSON.parse(field[2]) as string); } catch { /* Ignore malformed literals. */ }
            }
        }
        const id = fields.get('c');
        const path = fields.get('u');
        if (id && path) entries.push({ id, path });
    }
    return entries;
}

export function matchesComponentSuffix(path: string, suffix: string): boolean {
    if (!suffix) return false;
    const normalize = (value: string) => (value.split('&')[0].split('?').pop() ?? '')
        .split('-').filter(part => !/^\d+(?:\.\d+)*$/.test(part));
    const parts = normalize(path);
    const end = normalize(suffix);
    return end.length > 0 && end.length <= parts.length && end.every((part, i) => part === parts[parts.length - end.length + i]);
}

export function pruneStaleIds(registry: Map<string, string>, exists: (id: string) => boolean): void {
    for (const id of registry.keys()) if (!exists(id)) registry.delete(id);
}
