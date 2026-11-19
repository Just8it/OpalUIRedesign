import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import { OpalCoordinator, type Command, type Reply } from './coordinator.ts';
import { CHANNEL } from './gateway.ts';

let serial: Promise<unknown> = Promise.resolve();
/** Serialize read-modify-write, including storage completion, across messages. */
function dispatch(command: Command): Promise<Reply> {
    const task = serial.then(async () => {
        const state = await store.get(keys.gateway);
        const before = JSON.stringify(state);
        const coordinator = new OpalCoordinator(state);
        const reply = coordinator.handle(command);
        if (JSON.stringify(coordinator.state) !== before) await store.set(keys.gateway, coordinator.state);
        return reply;
    });
    serial = task.catch(() => undefined);
    return task;
}
function valid(value: unknown): value is Command {
    if (!value || typeof value !== 'object') return false;
    const c = value as Command;
    if (c.op === 'activity') return c.recovered === undefined || typeof c.recovered === 'boolean';
    if (c.op === 'release') return typeof c.id === 'string' && c.id.length <= 100;
    if (c.op !== 'acquire' || !c.ticket) return false;
    const t = c.ticket;
    return typeof t.id === 'string' && t.id.length <= 100 && ['user', 'view', 'background'].includes(t.priority)
        && typeof t.stateful === 'boolean' && Number.isFinite(t.timeoutMs) && t.timeoutMs > 0 && t.timeoutMs <= 300_000
        && (t.key === undefined || (typeof t.key === 'string' && t.key.length <= 16_384));
}
/** A departed document cannot release its persisted leases reliably. */
function releaseTab(tabId: number): void {
    const task = serial.then(async () => {
        const state = await store.get(keys.gateway);
        const jobs = state.jobs.filter(job => !job.id.startsWith(`${tabId}:`));
        if (jobs.length !== state.jobs.length) await store.set(keys.gateway, { ...state, jobs });
    });
    serial = task.catch(error => console.warn('[OPAL gateway] Tab cleanup failed:', error));
}
export function installOpalCoordinator(): void {
    chrome.tabs?.onUpdated?.addListener((tabId, changes) => {
        if (changes.status === 'loading') releaseTab(tabId);
    });
    chrome.tabs?.onRemoved?.addListener(tabId => releaseTab(tabId));
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.channel !== CHANNEL) return false;
        if (sender.id !== chrome.runtime.id || !sender.tab || !sender.url?.startsWith('https://bildungsportal.sachsen.de/opal') || !valid(message.command)) return false;
        // Bind tickets to the actual tab/frame; one tab cannot release another's permit.
        const prefix = `${sender.tab.id}:${sender.frameId ?? 0}:`;
        const command = message.command as Command;
        if (command.op === 'acquire') command.ticket.id = prefix + command.ticket.id;
        else if (command.op === 'release') command.id = prefix + command.id;
        dispatch(command).then(respond, () => respond({ kind: 'error', code: 'coordinator', retryAt: 0 }));
        return true;
    });
}
