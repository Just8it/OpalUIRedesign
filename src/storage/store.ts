import { extensionStorage } from './backend.ts';
export interface Key<T> {
    name: string;
    area: 'local' | 'sync';
    default: () => T;
    normalise: (value: unknown) => T;
    migrations?: readonly string[];
}
export function key<T>(name: string, fallback: () => T, normalise: (value: unknown) => T, migrations?: readonly string[]): Key<T> {
    return { name, area: 'local', default: fallback, normalise, migrations };
}
export function family<T>(prefix: string, fallback: () => T, normalise: (value: unknown) => T) {
    return (id: string): Key<T> => {
        if (!id || /\s/.test(id)) throw new Error('Invalid storage family id');
        return key(prefix + id, fallback, normalise);
    };
}
type Changes = Record<string, chrome.storage.StorageChange>;
export interface Backend {
    read(area: Key<unknown>['area'], names: string[]): Promise<Record<string, unknown>>;
    write(area: Key<unknown>['area'], values: Record<string, unknown>): Promise<void>;
    remove(area: Key<unknown>['area'], names: string[]): Promise<void>;
    listen(cb: (changes: Changes, area: string) => void): () => void;
}
export const extensionBackend: Backend = {
    async read(area, names) {
        const api = extensionStorage()?.[area];
        if (!api) return {};
        if ('browser' in globalThis) return api.get(names);
        return new Promise((resolve, reject) => {
            const result = api.get(names, values => {
                const error = typeof chrome !== 'undefined' && chrome.runtime?.lastError;
                if (error) reject(new Error(error.message)); else resolve(values);
            });
            (result as unknown as Promise<Record<string, unknown>> | undefined)?.then(resolve, reject);
        });
    },
    async remove(area, names) { await extensionStorage()?.[area].remove(names); },
    async write(area, values) { await extensionStorage()?.[area].set(values); },
    listen(cb) {
        const event = extensionStorage()?.onChanged;
        event?.addListener(cb);
        return () => event?.removeListener(cb);
    },
};
export function createStore(backend: Backend = extensionBackend) {
    const pending = new Map<string, Promise<unknown>>();
    async function get<T>(entry: Key<T>): Promise<T> {
        const values = await backend.read(entry.area, [entry.name, ...entry.migrations ?? []]);
        const raw = values[entry.name] ?? entry.migrations?.map(name => values[name]).find(value => value !== undefined);
        return raw === undefined ? entry.default() : entry.normalise(raw);
    }
    async function set<T>(entry: Key<T>, value: T): Promise<void> {
        await backend.write(entry.area, { [entry.name]: entry.normalise(value) });
    }
    function update<T>(entry: Key<T>, fn: (value: T) => T | Promise<T>): Promise<T> {
        const name = entry.area + ':' + entry.name;
        const task = (pending.get(name) ?? Promise.resolve()).catch(() => {}).then(async () => {
            const value = await fn(await get(entry));
            await set(entry, value);
            return value;
        });
        pending.set(name, task);
        void task.finally(() => { if (pending.get(name) === task) pending.delete(name); }).catch(() => {});
        return task;
    }
    function watch<T>(entry: Key<T>, cb: (value: T) => void): () => void {
        return backend.listen((changes, area) => {
            if (area === entry.area && Object.prototype.hasOwnProperty.call(changes, entry.name)) {
                const raw = changes[entry.name].newValue;
                cb(raw === undefined ? entry.default() : entry.normalise(raw));
            }
        });
    }
    return { get, set, update, watch, remove: (entry: Key<unknown>) => backend.remove(entry.area, [entry.name]) };
}
export function memoryBackend(initial: Record<string, unknown> = {}): Backend {
    const values = { local: structuredClone(initial), sync: {} as Record<string, unknown> };
    const listeners = new Set<(changes: Changes, area: string) => void>();
    return {
        async read(area, names) { return structuredClone(Object.fromEntries(names.filter(name => name in values[area]).map(name => [name, values[area][name]]))); },
        async remove(area, names) {
            const changes: Changes = {};
            for (const name of names) {
                if (!(name in values[area])) continue;
                changes[name] = { oldValue: structuredClone(values[area][name]) };
                delete values[area][name];
            }
            if (Object.keys(changes).length) listeners.forEach(cb => cb(changes, area));
        },
        async write(area, data) {
            const changes: Changes = {};
            for (const [name, value] of Object.entries(data)) {
                changes[name] = { oldValue: values[area][name], newValue: structuredClone(value) };
                values[area][name] = structuredClone(value);
            }
            listeners.forEach(cb => cb(changes, area));
        },
        listen(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    };
}
export const store = createStore();
