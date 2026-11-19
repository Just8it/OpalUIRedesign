import { extensionStorage } from './backend.ts';
/** Bulk administration must preserve unknown keys during export/import and cache cleanup. */
export const storageAdmin = {
    async readAll(): Promise<Record<string, unknown>> { return await extensionStorage()?.local.get(null) ?? {}; },
    async importAll(values: Record<string, unknown>): Promise<void> { await extensionStorage()?.local.set(values); },
    async clear(): Promise<void> { await extensionStorage()?.local.clear(); },
    async remove(names: string[]): Promise<void> { await extensionStorage()?.local.remove(names); },
};
