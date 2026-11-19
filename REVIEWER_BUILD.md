# Firefox reviewer build

Use Node.js 22.18 or newer and npm 10 or newer. The submission is built on Windows; no private credentials or external services are required. Extract the source archive and run these commands from its root:

```sh
npm ci
npm run build:firefox
```

The second command runs `package-firefox.mjs`. `build/entries.mjs` is the shared build and package definition for both browsers. It builds these bundles with esbuild (ES2020, minified, no source maps):

| Entry | Output | Format |
| --- | --- | --- |
| src/early.ts | dist/early.js | IIFE |
| src/main.ts | dist/content.js | IIFE |
| src/main-world.ts | dist/main-world.js | IIFE |
| src/background.ts | dist/background.js | IIFE |
| src/extension-options.ts | dist/options-opener.js | ESM |

It then runs `npx @tailwindcss/cli -i main.css -o styles/modern.css`, collects the declared bundles plus `styles/`, `icons/`, `popup/`, and `options/`, and includes `manifest-firefox.json` as `manifest.json`. Before writing `opal-redesign-firefox.zip`, it validates manifest references and local HTML/JS references in popup and options files. The ESM options opener is imported by the popup.

For additional checks:

```sh
npm test
npm run typecheck
npm run build
```

`npm run build` produces the same JS and CSS without packaging. `npm run dev` watches JS and CSS; `npm run dev:js` watches all declared bundles, including the options opener.

To regenerate the reviewer source archive from a Git checkout after installing dependencies:

```sh
npm run build:source:firefox
```

This produces `opal-redesign-source-firefox.zip`, including untracked source/build modules and excluding generated bundles, generated CSS, dependencies and ZIPs. Git is required only for this source-archive command, not for rebuilding the add-on from the extracted archive. Dependencies are pinned in `package-lock.json`.
