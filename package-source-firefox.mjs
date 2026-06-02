/**
 * Firefox source package script for Mozilla reviewers.
 *
 * Creates a source-code zip with POSIX-style archive paths. PowerShell's
 * Compress-Archive writes Windows backslashes in entry names, which AMO rejects.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';

let JSZip;
try {
    ({ default: JSZip } = await import('jszip'));
} catch {
    console.error('[source] jszip not found - run: npm ci');
    process.exit(1);
}

const outPath = 'opal-redesign-source-firefox.zip';
const zip = new JSZip();

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

const extraFiles = ['REVIEWER_BUILD.md'];
const files = new Set([...trackedFiles, ...extraFiles]);

function shouldInclude(file) {
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    if (file === 'styles/modern.css') return false;
    if (file.startsWith('dist/')) return false;
    if (file.startsWith('node_modules/')) return false;
    if (/\.zip$/i.test(file)) return false;
    return true;
}

for (const file of [...files].sort()) {
    if (!shouldInclude(file)) continue;
    zip.file(file.replaceAll('\\', '/'), readFileSync(file));
}

const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
});

try { rmSync(outPath); } catch { /* file did not exist */ }
writeFileSync(outPath, buffer);
console.log(`[source] Packaged -> ${outPath}`);
