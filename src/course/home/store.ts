import { store } from '../../storage/store.ts';
import { families } from '../../storage/registry.ts';
import type { CourseSnapshot } from '../types.ts';
import type { Located } from '../find/types.ts';
import type { CourseProgress, HomeConfig } from './types.ts';
import { normaliseHome } from './config.ts';
import { normaliseProgress } from './progress.ts';

export async function loadHome(courseId: string, snapshot?: CourseSnapshot, located?: Located[]): Promise<HomeConfig> {
    return normaliseHome(await store.get(families.home(courseId)), snapshot, located);
}
export async function saveHome(courseId: string, config: HomeConfig): Promise<void> {
    await store.set(families.home(courseId), normaliseHome(config));
}
export async function loadProgress(courseId: string): Promise<CourseProgress> {
    return normaliseProgress(await store.get(families.courseProgress(courseId)));
}
export async function saveProgress(courseId: string, progress: CourseProgress): Promise<void> {
    await store.set(families.courseProgress(courseId), normaliseProgress(progress));
}
