// Private Firefox builds under their own add-on ID, apart from the store version.
//
//   npm run debug:firefox  builds .debug/firefox/ for about:debugging → "Load Temporary Add-on…"
//                          (pick manifest.json there). Same ID as the signed build, so it temporarily
//                          replaces it with the same saved data; a Firefox restart brings the signed one back.
//   npm run sign:firefox   signs the build on addons.mozilla.org as "unlisted" (signed, never shown in
//                          the store). The .xpi in signed/ installs permanently in normal Firefox.
//
// Signing credentials come from .secrets (gitignored, see .secrets.example) or from the environment:
//   AMO_JWT_ISSUER / AMO_JWT_SECRET  (also accepted: WEB_EXT_API_KEY / WEB_EXT_API_SECRET)
// They are passed to web-ext in-process, never on a command line, and never printed.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { collectPackage } from './build/entries.mjs';

const DEV_ID = 'opal-redesign-dev@just8it.github';
const DEV_NAME = 'OPAL Redesign (Dev)';
const DEBUG = process.argv.includes('--debug');
const SOURCE_DIR = resolve(DEBUG ? '.debug/firefox' : '.sign/firefox');
const OUT_DIR = resolve('signed');

function readSecrets() {
    const values = { ...process.env };
    if (existsSync('.secrets')) {
        for (const line of readFileSync('.secrets', 'utf8').split(/\r?\n/)) {
            const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
            if (match && !line.trimStart().startsWith('#')) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const apiKey = values.AMO_JWT_ISSUER || values.WEB_EXT_API_KEY;
    const apiSecret = values.AMO_JWT_SECRET || values.WEB_EXT_API_SECRET;
    if (!apiKey || !apiSecret) {
        console.error('Keine AMO-Zugangsdaten gefunden. Lege .secrets an (Vorlage: .secrets.example) mit AMO_JWT_ISSUER und AMO_JWT_SECRET.');
        process.exit(1);
    }
    return { apiKey, apiSecret };
}

const credentials = DEBUG ? undefined : readSecrets();

const files = await collectPackage('firefox');
const manifest = JSON.parse(String(files.get('manifest.json')));
// AMO refuses a version it has signed before; minutes since 1970 keep increasing and fit AMO's 9 digits per part.
const version = manifest.version.split('.').slice(0, 3).join('.') + '.' + Math.floor(Date.now() / 60000);
manifest.version = version;
manifest.name = DEBUG ? DEV_NAME + ' Debug' : DEV_NAME;
manifest.browser_specific_settings.gecko.id = DEV_ID;
files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

rmSync(SOURCE_DIR, { recursive: true, force: true });
for (const [path, data] of files) {
    const target = join(SOURCE_DIR, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
}

if (DEBUG) {
    console.log(`\n${manifest.name} ${version}: ${join(SOURCE_DIR, 'manifest.json')}`);
    console.log('about:debugging#/runtime/this-firefox → "Temporäres Add-on laden…" → diese manifest.json wählen.');
    console.log('Nach erneutem Bauen dort auf "Neu laden" klicken.');
} else {
    const { default: webExt } = await import('web-ext');
    mkdirSync(OUT_DIR, { recursive: true });
    console.log(`Signiere ${manifest.name} ${version} (unlisted) ...`);
    const before = new Set(readdirSync(OUT_DIR));
    await webExt.cmd.sign(
        { sourceDir: SOURCE_DIR, artifactsDir: OUT_DIR, ...credentials, channel: 'unlisted' },
        { shouldExitProgram: false },
    );
    const created = readdirSync(OUT_DIR).filter(name => name.endsWith('.xpi') && !before.has(name));
    if (!created.length) {
        console.error('Keine signierte Datei erhalten. Die Meldungen oben nennen den Grund.');
        process.exit(1);
    }
    console.log('\nFertig: ' + join(OUT_DIR, created[0]));
    console.log('In Firefox installieren: Datei ins Fenster ziehen, oder about:addons → Zahnrad → Add-on aus Datei installieren.');
}
