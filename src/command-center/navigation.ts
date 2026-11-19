import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import { openFile } from '../core/file-opening';
/* Owns navigation for the command center. */

import { isStableFileUrl } from '../core/index-messages';

import { recordVisit, getNode, type IndexNode, type SearchResult } from '../core/search-engine';

/** Live accessors keep state owned by the controller current across callbacks. */
interface Context {
    confirmingClear: boolean;
    rerender: () => void;
    close: () => void;
    results: SearchResult[];
    selectedIdx: number;
    resultsEl: HTMLElement;
    input: HTMLInputElement;
    mode: CmdMode;
    enterDrillMode: (course: IndexNode) => Promise<void>;
    COMMAND_ACTIONS: CommandAction[];
    toggleRanking: () => void;
    saveToHistory: (query: string) => Promise<void>;
    isSyntheticNode: (node: IndexNode) => boolean;
}

export function createNavigation(context: Context) {
    const runAction = async (url: string): Promise<boolean> => {
        if (!url.startsWith('opal-action:')) return false;
        const id = url.slice('opal-action:'.length);
        const action = context.COMMAND_ACTIONS.find((a) => a.id === id);
        if (!action) return false;
        if (id === 'clear-search-index' && !context.confirmingClear) {
            context.confirmingClear = true;
            context.rerender();
            return true;
        }
        if (id === 'explain-ranking') {
            context.toggleRanking();
            context.rerender();
            return true;
        }
        if (id !== 'refresh-index') context.close();
        await action.run();
        return true;
    };

    const navigate = (delta: number) => {
        if (context.results.length === 0) return;
        context.confirmingClear = false;
        context.selectedIdx = Math.max(0, Math.min(context.results.length - 1, context.selectedIdx + delta));
        context.rerender();
        context.resultsEl
            .querySelectorAll<HTMLElement>('.opal-cmd-result')
            [context.selectedIdx]?.scrollIntoView({ block: 'nearest' });
    };

    const openSelected = async (folder = false) => {
        const result = context.results[context.selectedIdx];
        if (!result) return;
        const { node } = result;

        const currentQuery = context.input.value.trim();
        const isFilesOnly = currentQuery.startsWith('/f ');

        // Course in search mode → drill into it instead of navigating
        if (context.mode !== 'drill' && node.type === 'course' && !isFilesOnly) {
            await context.enterDrillMode(node);
            return;
        }

        if (await runAction(node.url)) return;

        if (currentQuery && node.type !== 'action') {
            await context.saveToHistory(currentQuery);
        }
        context.close();

        // Opening a result is a real visit. Capped so a slow background
        // never holds up the navigation.
        const timeout = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms));
        // Only files: a course or folder is counted by the page it opens
        // (indexCurrentPage), and counting here too would double it.
        if (!context.isSyntheticNode(node) && node.type === 'file') {
            await Promise.race([recordVisit(node.id, node).catch(() => false), timeout(400)]);
        }

        if (node.type === 'file' && !folder && isStableFileUrl(node.url)) {
            if (await openFile(node.url)) return;
            window.open(node.url, '_blank', 'noopener');
            return;
        }
        if (node.type === 'file' && node.parentId) {
            const parent = await Promise.race([getNode(node.parentId).catch(() => null), timeout(400)]);
            if (parent?.url) {
                await store.set(keys.highlight, { title: node.title, url: node.url });
                location.href = parent.url;
                return;
            }
        }
        location.href = node.url;
    };
    return { openSelected, navigate, runAction };
}

type CmdMode = 'home' | 'search' | 'drill';
interface CommandAction {
    id: string;
    title: string;
    subtitle: string;
    keywords: string[];
    run: () => void | Promise<void>;
}
