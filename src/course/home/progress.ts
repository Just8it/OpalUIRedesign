import type { CourseProgress } from './types.ts';

export function normaliseProgress(raw: unknown): CourseProgress {
    const value = raw && typeof raw === 'object' ? raw as Partial<CourseProgress> : {};
    const done = Object.fromEntries(Object.entries(value.done && typeof value.done === 'object' ? value.done : {})
        .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0).sort((a, b) => b[1] - a[1]).slice(0, 2000));
    const pointer = Object.fromEntries(Object.entries(value.pointer && typeof value.pointer === 'object' ? value.pointer : {}).filter(([, v]) => typeof v === 'string'));
    const pinned = Array.isArray(value.pinned) ? [...new Set(value.pinned.filter((v): v is string => typeof v === 'string'))].slice(0, 200) : [];
    return { done, pointer, pinned };
}
export function toggleDone(progress: CourseProgress, unitKey: string, now: number): CourseProgress {
    const done = { ...progress.done }, pointer = { ...progress.pointer };
    if (Object.prototype.hasOwnProperty.call(done, unitKey)) delete done[unitKey];
    else {
        done[unitKey] = now;
        for (const id of Object.keys(pointer)) if (pointer[id] === unitKey) delete pointer[id];
    }
    return { ...progress, done, pointer };
}
export function setPointer(progress: CourseProgress, blockId: string, unitKey: string | null): CourseProgress {
    const pointer = { ...progress.pointer };
    if (unitKey === null) delete pointer[blockId]; else pointer[blockId] = unitKey;
    return { ...progress, pointer };
}
export function togglePin(progress: CourseProgress, url: string): CourseProgress {
    return { ...progress, pinned: progress.pinned.includes(url) ? progress.pinned.filter(u => u !== url) : [url, ...progress.pinned].slice(0, 200) };
}
