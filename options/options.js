const ENABLED_KEY = 'opalRedesignEnabled';
const DB_NAME = 'OpalSearchIndex';

const enabledToggle = document.getElementById('enabledToggle');
const storageCount = document.getElementById('storageCount');
const indexCount = document.getElementById('indexCount');
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

function countSearchIndex() {
    return new Promise((resolve) => {
        const req = indexedDB.open(DB_NAME);
        req.onerror = () => resolve(0);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('nodes')) {
                db.close();
                resolve(0);
                return;
            }
            const tx = db.transaction('nodes', 'readonly');
            const countReq = tx.objectStore('nodes').count();
            countReq.onsuccess = () => resolve(countReq.result);
            countReq.onerror = () => resolve(0);
            tx.oncomplete = () => db.close();
        };
    });
}

async function refreshStats() {
    const storage = await getAllStorage();
    storageCount.textContent = String(Object.keys(storage).length);
    indexCount.textContent = String(await countSearchIndex());
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
