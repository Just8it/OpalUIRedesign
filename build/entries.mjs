import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import JSZip from 'jszip';

export const bundles = [
    { entry: 'src/options/main.ts', outfile: 'options/options.js', format: 'iife' },
    { entry: 'src/popup/main.ts', outfile: 'popup/popup.js', format: 'iife' },
    { entry: 'src/early.ts', outfile: 'dist/early.js', format: 'iife' },
    { entry: 'src/main.ts', outfile: 'dist/content.js', format: 'iife' },
    { entry: 'src/main-world.ts', outfile: 'dist/main-world.js', format: 'iife' },
    { entry: 'src/background.ts', outfile: 'dist/background.js', format: 'iife' },
    { entry: 'src/extension-options.ts', outfile: 'dist/options-opener.js', format: 'esm' },
];
// Both browsers currently use identical bundles and assets; only the manifest differs.
export const staticAssets = ['styles', 'icons', 'popup', 'options', '_locales'];
export const generatedFiles = [...bundles.map(b => b.outfile), 'styles/modern.css'];
export const manifests = { chrome: 'manifest.json', firefox: 'manifest-firefox.json' };
export function buildConfigs(watch = false) {
    return bundles.map(({entry, outfile, format}) => ({
        entryPoints: [entry], outfile, format, bundle: true, target: 'es2020',
        platform: 'browser', minify: !watch, sourcemap: watch ? 'inline' : false, logLevel: 'info',
    }));
}

/** Pure validation over archive paths and contents; no filesystem access. */
export function validatePackage(files) {
    const manifest = JSON.parse(String(files.get('manifest.json')));
    const missing = [];
    function check(ref, from = 'manifest.json') {
        if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return;
        const clean = ref.split(/[?#]/)[0];
        if (!clean) return;
        const path = clean.startsWith('/') ? clean.slice(1) : posix.normalize(posix.join(from === 'manifest.json' ? '' : posix.dirname(from), clean));
        const pattern = new RegExp('^' + path.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
        if (![...files.keys()].some(name => pattern.test(name))) missing.push(from + ' -> ' + ref);
    }
    const icons = value => typeof value === 'string' ? check(value) : Object.values(value ?? {}).forEach(v => check(v));
    for (const script of manifest.content_scripts ?? []) [...(script.js ?? []), ...(script.css ?? [])].forEach(r => check(r));
    check(manifest.background?.service_worker); check(manifest.background?.page);
    (manifest.background?.scripts ?? []).forEach(r => check(r));
    for (const resources of manifest.web_accessible_resources ?? []) (typeof resources === 'string' ? [resources] : resources.resources ?? []).forEach(r => check(r));
    for (const action of [manifest.action, manifest.browser_action, manifest.page_action]) { check(action?.default_popup); icons(action?.default_icon); }
    check(manifest.options_ui?.page); check(manifest.options_page); icons(manifest.icons);
    for (const [path, contents] of files) {
        if (!/^(popup|options)\/.*\.(html|js)$/.test(path)) continue;
        const expressions = path.endsWith('.html')
            ? [/\b(?:src|href)\s*=\s*["']([^"']+)["']/g]
            : [/\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']/g, /\b(?:src|href)\s*=\s*["']([^"']+)["']/g];
        for (const expression of expressions) for (const match of String(contents).matchAll(expression)) check(match[1], path);
    }
    if (missing.length) throw new Error('Missing package references:\n' + missing.join('\n'));
}
/** Builds everything and returns the package contents (archive path -> bytes) for one browser. */
export async function collectPackage(browser) {
    await Promise.all(buildConfigs().map(config => build(config)));
    execSync('npx @tailwindcss/cli -i main.css -o styles/modern.css', {stdio: 'inherit'});
    const files = new Map([['manifest.json', readFileSync(manifests[browser])]]);
    function add(path) {
        if (statSync(path).isDirectory()) for (const name of readdirSync(path)) add(path + '/' + name);
        else files.set(path, readFileSync(path));
    }
    for (const path of [...bundles.map(b => b.outfile), ...staticAssets]) add(path);
    validatePackage(files);
    return files;
}

export async function packageBrowser(browser) {
    const files = await collectPackage(browser);
    const zip = new JSZip();
    for (const [path, data] of files) zip.file(path, data);
    const out = 'opal-redesign-' + browser + '.zip';
    writeFileSync(out, await zip.generateAsync({type:'nodebuffer', compression:'DEFLATE'}));
    console.log('Packaged ' + out);
}
