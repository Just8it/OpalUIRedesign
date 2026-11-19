import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import { openFile } from '../core/file-opening';
import type { IndexNode, SearchResult } from '../core/search-engine.ts';
import { openExtensionOptions } from '../extension-options.ts';
import { applyPageTheme as applySharedPageTheme } from '../storage/page-theme.ts';
import { initLocale, onLocaleChange } from '../i18n/index.ts';
import { t, type PageMessageKey } from '../i18n/messages/pages.ts';
import { localizePage } from '../options/localize.ts';

/**
 * popup.js — Extension popup logic
 * 
 * Persists the on/off state to storage.local and
 * reloads the active OPAL tab when toggled.
 */

const toggle = document.getElementById('toggleEnabled') as HTMLInputElement;
const toggleNote = document.getElementById('toggleNote')!;
const optionsBtn = document.getElementById('openOptions')!;

// Save state on toggle
toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    void store.set(keys.enabled, enabled).then(() => {
        // Reload the active OPAL tab to apply/remove the redesign
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.url?.includes('bildungsportal.sachsen.de/opal')) {
                if (tabs[0].id !== undefined) chrome.tabs.reload(tabs[0].id);
                toggleNote.textContent = t('popupReloading');
            }
        });
    });
});

optionsBtn.addEventListener('click', () => {
    void openExtensionOptions();
});

const searchInput = document.getElementById('search') as HTMLInputElement;
const resultsList = document.getElementById('results')!;
const resultsHeading = document.getElementById('resultsHeading')!;
let results: SearchResult[] = [];
let selected = 0;
let sequence = 0;
let searchFailed = false;
const RESULT_LABELS: Record<IndexNode['type'], PageMessageKey> = {
    file: 'popupResultFile', folder: 'popupResultFolder', course: 'popupResultCourse', action: 'popupResultAction',
};
function indexRequest<T>(request: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => chrome.runtime.sendMessage({ channel: 'opal-index', ...request }, reply => {
        const error = chrome.runtime.lastError;
        if (error || !reply?.ok) reject(new Error(error?.message || reply?.error || t('popupIndexUnavailable')));
        else resolve(reply.data);
    }));
}
function showMessage(text: string) {
    const p = document.createElement('p');
    p.className = 'popup-empty';
    p.textContent = text;
    resultsList.replaceChildren(p);
}
function renderResults() {
    resultsList.replaceChildren();
    const query = searchInput.value.trim();
    resultsHeading.hidden = searchFailed || query !== '' || !results.length;
    resultsHeading.textContent = t('popupRecents');
    if (searchFailed) { showMessage(t('popupIndexUnavailable')); return; }
    if (!results.length) { showMessage(query ? t('popupNoResults', { query }) : t('popupSearchHint')); return; }
    results.forEach((result, i) => {
        const button = document.createElement('button');
        button.className = 'search-result';
        button.setAttribute('aria-current', String(i === selected));
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = result.node.title;
        button.append(title);
        const path = document.createElement('small');
        path.textContent = [t(RESULT_LABELS[result.node.type]), ...(result.path || [])].join(' › ');
        button.append(path);
        button.addEventListener('click', event => { selected = i; void openResult(event.shiftKey); });
        resultsList.append(button);
    });
}
async function searchIndex() {
    const seq = ++sequence;
    const query = searchInput.value;
    try {
        const found = await indexRequest<SearchResult[]>(query.trim() ? { op: 'search', query, options: { limit: 12 } } : { op: 'recents', limit: 8 });
        if (seq !== sequence) return;
        results = found; selected = 0; searchFailed = false; renderResults();
    } catch {
        if (seq === sequence) { searchFailed = true; renderResults(); }
    }
}
function safeUrl(value: string | undefined) {
    try {
        const url = new URL(value ?? '', 'https://bildungsportal.sachsen.de');
        return url.origin === 'https://bildungsportal.sachsen.de' && url.pathname.startsWith('/opal/') ? url : null;
    } catch { return null; }
}
async function openResult(folder = false) {
    const node = results[selected]?.node;
    if (!node) return;
    let url = safeUrl(node.url);
    if (!url) return;
    if (node.type === 'file') {
        await indexRequest({ op: 'recordVisit', id: node.id, node }).catch(() => {});
        const stable = !url.search && !url.hash && /\.[a-z0-9]{2,8}$/i.test(url.pathname) && !/wicket|ILinkListener/i.test(url.href);
        if (stable && !folder && await openFile(url.href)) { window.close(); return; }
        if ((folder || !stable) && node.parentId) {
            const parent = await indexRequest<IndexNode | null>({ op: 'get', id: node.parentId }).catch(() => null);
            const parentUrl = safeUrl(parent?.url);
            if (parentUrl) {
                await store.set(keys.highlight, { title: node.title, url: node.url });
                url = parentUrl;
            } else return;
        } else if (!stable) return;
    }
    chrome.tabs.create({ url: url.href }, () => { void chrome.runtime.lastError; window.close(); });
}
searchInput.addEventListener('input', searchIndex);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); window.close(); }
    if (document.activeElement !== searchInput) return;
    if (event.key === 'Enter') { event.preventDefault(); void openResult(event.shiftKey); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        selected = Math.max(0, Math.min(results.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
        renderResults(); resultsList.children[selected]?.scrollIntoView({ block: 'nearest' });
    }
});
async function init() {
    try { await setup(); }
    finally { document.body.hidden = false; }
    void searchIndex();
    searchInput.focus();
}

async function setup() {
    await initLocale();
    const [enabled, theme] = await Promise.all([
        store.get(keys.enabled).catch(() => keys.enabled.default()),
        store.get(keys.theme).catch(() => undefined),
    ]);
    toggle.checked = enabled;
    applySharedPageTheme(theme);
    store.watch(keys.theme, applySharedPageTheme);
    document.getElementById('version')!.textContent = chrome.runtime.getManifest().version;
    onLocaleChange(() => {
        localizePage();
        if (toggleNote.textContent) toggleNote.textContent = t('popupReloading');
        renderResults();
    });
    localizePage();
}
void init();
