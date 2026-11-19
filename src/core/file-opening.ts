import { isStableFileUrl } from './index-messages';
import { store } from '../storage/store';
import { keys } from '../storage/registry';
import type { IndexNode } from './search/types';

let downloadPreferred = false;
let downloadWatched = false;
/** "Dateien direkt herunterladen", kept in sync so a click handler can decide without waiting:
 *  a link that opens a tab must do so inside the click, or the popup blocker stops it. */
export function prefersDownload(): boolean {
    if (!downloadWatched) {
        downloadWatched = true;
        void store.get(keys.downloadFiles).then(value => { downloadPreferred = value; }).catch(() => undefined);
        store.watch(keys.downloadFiles, value => { downloadPreferred = value; });
    }
    return downloadPreferred;
}

/** False leaves external links and session-dependent OPAL links to their existing handlers.
 *  `folder: false` (course view: the file is already shown in its place) only ever downloads;
 *  without "Dateien direkt herunterladen" it answers false and the caller opens the file itself.
 *  Opening the folder from there would land on the course view again, one new tab per click. */
export async function openFile(url: string, options: { folder?: boolean } = {}): Promise<boolean> {
    if (!isStableFileUrl(url)) return false;
    const folder = options.folder ?? true;
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage({ type: 'opal-open-file', url, folder }, reply => {
                const error = chrome.runtime.lastError;
                if (error || (!reply?.ok && !reply?.direct)) console.warn('[OPAL] Datei konnte nicht geöffnet werden:', error?.message || reply?.error);
                resolve(!error && reply?.ok === true);
            });
        } catch {
            resolve(false);
        }
    });
}

export function installFileOpening(findParent: (url: string) => Promise<IndexNode | undefined>): void {
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.type !== 'opal-open-file') return false;
        if (sender.id !== chrome.runtime.id || !isStableFileUrl(message.url)) return false;
        const url = new URL(message.url, 'https://bildungsportal.sachsen.de').href;
        void store.get(keys.downloadFiles).then(async download => {
            const done = () => {
                const error = chrome.runtime.lastError;
                respond(error ? { ok: false, error: error.message } : { ok: true });
            };
            if (download) chrome.downloads.download({ url }, done);
            else if (message.folder === false) respond({ ok: false, direct: true });
            else {
                const parent = await findParent(url);
                if (!parent) { respond({ ok: false, error: 'Ordner nicht im Suchindex gefunden' }); return; }
                const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
                await store.set(keys.highlight, { title: name, url });
                chrome.tabs.create({ url: parent.url }, done);
            }
        }).catch(error => respond({ ok: false, error: String(error) }));
        return true;
    });
}
