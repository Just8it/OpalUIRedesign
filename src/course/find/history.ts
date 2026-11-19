import { store } from '../../storage/store.ts';
import { families } from '../../storage/registry.ts';
import type { OpenedMap } from './types.ts';

export function trimOpened(opened: OpenedMap, limit = 300): OpenedMap {
    return Object.fromEntries(Object.entries(opened).filter(([, time]) => Number.isFinite(time)).sort((a, b) => b[1] - a[1]).slice(0, Math.max(0, limit)));
}
export async function loadOpened(courseId: string): Promise<OpenedMap> {
    return trimOpened(await store.get(families.opened(courseId)));
}
export function recordOpened(courseId: string, url: string): Promise<OpenedMap> {
    return store.update(families.opened(courseId), opened => trimOpened({ ...opened, [url]: Date.now() }));
}
