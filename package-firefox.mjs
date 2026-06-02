/**
 * Firefox packaging script
 *
 * Builds the extension and creates a Firefox-ready zip:
 *   dist/content.js
 *   dist/main-world.js
 *   styles/...
 *   icons/...
 *   popup/...
 *   manifest.json  ← replaced with manifest-firefox.json
 *
 * Usage:  node package-firefox.mjs
 */

import { build } from 'esbuild';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, readFileSync } from 'fs';
import { resolve, join, relative } from 'path';
import { createWriteStream } from 'fs';

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

console.log('[firefox] Building JS…');
await Promise.all([
    build({ ...sharedConfig, entryPoints: ['src/main.ts'],       outfile: 'dist/content.js'    }),
    build({ ...sharedConfig, entryPoints: ['src/main-world.ts'], outfile: 'dist/main-world.js' }),
]);

/* ── Build CSS ─────────────────────────────────────────────────── */

console.log('[firefox] Building CSS…');
execSync('npx @tailwindcss/cli -i main.css -o styles/modern.css', { stdio: 'inherit' });

/* ── Create zip ────────────────────────────────────────────────── */

// Dynamic import of JSZip (works with both CommonJS and ESM)
let JSZip;
try {
    ({ default: JSZip } = await import('jszip'));
} catch {
    console.error('[firefox] jszip not found — run: npm install --save-dev jszip');
    process.exit(1);
}

const zip = new JSZip();

/** Add a file to the zip, reading it from disk. */
function addFile(zipPath, diskPath) {
    zip.file(zipPath, readFileSync(diskPath));
}

/** Recursively add a directory. */
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

// manifest (Firefox version)
addFile('manifest.json', 'manifest-firefox.json');

// JS bundles
addFile('dist/content.js',    'dist/content.js');
addFile('dist/main-world.js', 'dist/main-world.js');

// CSS
addDir('styles', 'styles');

// Icons (if the folder exists)
if (existsSync('icons')) addDir('icons', 'icons');

// Popup
if (existsSync('popup')) addDir('popup', 'popup');

// Options page
if (existsSync('options')) addDir('options', 'options');

/* ── Write zip ─────────────────────────────────────────────────── */

const outPath = 'opal-redesign-firefox.zip';
const buffer  = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
import { writeFileSync, rmSync } from 'fs';
try { rmSync(outPath); } catch { /* didn't exist */ }
writeFileSync(outPath, buffer);
console.log(`[firefox] Packaged → ${outPath}`);
