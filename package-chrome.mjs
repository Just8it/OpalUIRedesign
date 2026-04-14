/**
 * Chrome packaging script
 *
 * Builds the extension and creates a Chrome-ready zip:
 *   dist/content.js
 *   dist/main-world.js
 *   styles/...
 *   icons/...
 *   popup/...
 *   manifest.json  ← original Chrome MV3 manifest
 *
 * Usage:  node package-chrome.mjs
 */

import { build } from 'esbuild';
import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

/* ── Build JS ──────────────────────────────────────────────────── */

const sharedConfig = {
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
};

console.log('[chrome] Building JS…');
await Promise.all([
    build({ ...sharedConfig, entryPoints: ['src/main.ts'],       outfile: 'dist/content.js'    }),
    build({ ...sharedConfig, entryPoints: ['src/main-world.ts'], outfile: 'dist/main-world.js' }),
]);

/* ── Build CSS ─────────────────────────────────────────────────── */

console.log('[chrome] Building CSS…');
execSync('npx @tailwindcss/cli -i main.css -o styles/modern.css', { stdio: 'inherit' });

/* ── Create zip ────────────────────────────────────────────────── */

let JSZip;
try {
    ({ default: JSZip } = await import('jszip'));
} catch {
    console.error('[chrome] jszip not found — run: npm install --save-dev jszip');
    process.exit(1);
}

const zip = new JSZip();

function addFile(zipPath, diskPath) {
    zip.file(zipPath, readFileSync(diskPath));
}

function addDir(zipDir, diskDir) {
    for (const entry of readdirSync(diskDir)) {
        const diskFull = join(diskDir, entry);
        const zipFull  = zipDir ? `${zipDir}/${entry}` : entry;
        if (statSync(diskFull).isDirectory()) {
            addDir(zipFull, diskFull);
        } else {
            addFile(zipFull, diskFull);
        }
    }
}

// manifest (Chrome version)
addFile('manifest.json', 'manifest.json');

// JS bundles
addFile('dist/content.js',    'dist/content.js');
addFile('dist/main-world.js', 'dist/main-world.js');

// CSS
addDir('styles', 'styles');

// Icons
if (existsSync('icons')) addDir('icons', 'icons');

// Popup
if (existsSync('popup')) addDir('popup', 'popup');

/* ── Write zip ─────────────────────────────────────────────────── */

const outPath = 'opal-redesign-chrome.zip';
const buffer  = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
try { rmSync(outPath); } catch { /* didn't exist */ }
writeFileSync(outPath, buffer);
console.log(`[chrome] Packaged → ${outPath}`);
