const ENABLED_KEY = 'opalRedesignEnabled';
const DB_NAME = 'OpalSearchIndex';

const enabledToggle = document.getElementById('enabledToggle');
const storageCount = document.getElementById('storageCount');
const indexCount = document.getElementById('indexCount');
const courseCount = document.getElementById('courseCount');
const folderCount = document.getElementById('folderCount');
const fileCount = document.getElementById('fileCount');
const lastIndexed = document.getElementById('lastIndexed');
const statusText = document.getElementById('statusText');
const exportBtn = document.getElementById('exportBtn');
const importFile = document.getElementById('importFile');
const clearIndexBtn = document.getElementById('clearIndexBtn');
const clearAllBtn = document.getElementById('clearAllBtn');

function setStatus(text) {
    statusText.textContent = text;
}

function getAllStorage() {
    return chrome.storage.local.get(null);
}

function deleteSearchIndex() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
    });
}

function readSearchIndexStats() {
    return new Promise((resolve) => {
        const req = indexedDB.open(DB_NAME);
        req.onerror = () => resolve({ total: 0, courses: 0, folders: 0, files: 0, lastIndexed: 0 });
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('nodes')) {
                db.close();
                resolve({ total: 0, courses: 0, folders: 0, files: 0, lastIndexed: 0 });
                return;
            }
            const tx = db.transaction('nodes', 'readonly');
            const reqCursor = tx.objectStore('nodes').openCursor();
            const stats = { total: 0, courses: 0, folders: 0, files: 0, lastIndexed: 0 };
            reqCursor.onsuccess = () => {
                const cursor = reqCursor.result;
                if (!cursor) {
                    resolve(stats);
                    return;
                }
                const node = cursor.value || {};
                stats.total += 1;
                if (node.type === 'course') stats.courses += 1;
                if (node.type === 'folder') stats.folders += 1;
                if (node.type === 'file') stats.files += 1;
                stats.lastIndexed = Math.max(stats.lastIndexed, node.indexedAt || node.lastVisited || 0);
                cursor.continue();
            };
            reqCursor.onerror = () => resolve(stats);
            tx.oncomplete = () => db.close();
        };
    });
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return '-';
    const minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'gerade eben';
    if (minutes < 60) return `vor ${minutes} Min.`;
    if (minutes < 1440) return `vor ${Math.round(minutes / 60)} Std.`;
    return `vor ${Math.round(minutes / 1440)} Tagen`;
}

async function refreshStats() {
    const storage = await getAllStorage();
    const indexStats = await readSearchIndexStats();
    storageCount.textContent = String(Object.keys(storage).length);
    indexCount.textContent = String(indexStats.total);
    courseCount.textContent = String(indexStats.courses);
    folderCount.textContent = String(indexStats.folders);
    fileCount.textContent = String(indexStats.files);
    lastIndexed.textContent = formatRelativeTime(indexStats.lastIndexed);
    enabledToggle.checked = storage[ENABLED_KEY] !== false;
}

enabledToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ [ENABLED_KEY]: enabledToggle.checked });
    setStatus(enabledToggle.checked ? 'Modern UI aktiviert' : 'Modern UI deaktiviert');
    refreshStats();
});

exportBtn.addEventListener('click', async () => {
    const data = await getAllStorage();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opal-redesign-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Einstellungen exportiert');
});

importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('Invalid settings file');
        }
        await chrome.storage.local.set(data);
        setStatus('Einstellungen importiert');
        refreshStats();
    } catch {
        setStatus('Import fehlgeschlagen');
    } finally {
        importFile.value = '';
    }
});

clearIndexBtn.addEventListener('click', async () => {
    await deleteSearchIndex();
    setStatus('Suchindex gelöscht');
    refreshStats();
});

clearAllBtn.addEventListener('click', async () => {
    if (!confirm('Alle lokalen OPAL-Redesign-Daten löschen?')) return;
    await chrome.storage.local.clear();
    await deleteSearchIndex();
    setStatus('Alle lokalen Daten gelöscht');
    refreshStats();
});

refreshStats();
