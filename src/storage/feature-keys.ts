import { keys } from './registry.ts';
export const FEATURE_KEYS = {
    master: keys.enabled.name, course: keys.courseView.name,
    preload: keys.preload.name,
    deadlines: keys.deadlines.name, layout: keys.layout.name,
    onboarding: keys.onboarding.name, reopen: keys.reopen.name,
} as const;
