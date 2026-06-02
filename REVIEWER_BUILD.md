# Firefox reviewer build instructions

This source package builds the Firefox version of OPAL Redesign.

## Build environment

- Operating system used for the submitted build: Windows 11
- Required runtime: Node.js 18 or newer
- Required package manager: npm, bundled with Node.js

The submitted package was built with the dependencies pinned in `package-lock.json`.

The source-code upload package can be regenerated with:

```bash
npm run build:source:firefox
```

## Install tools and dependencies

1. Install Node.js 18 or newer from https://nodejs.org/
2. Open a terminal in this source directory.
3. Install the pinned dependencies:

```bash
npm ci
```

## Rebuild the Firefox add-on

Run:

```bash
npm run build:firefox
```

This executes `package-firefox.mjs`, which performs all build steps:

1. Bundles `src/main.ts` to `dist/content.js` with esbuild.
2. Bundles `src/main-world.ts` to `dist/main-world.js` with esbuild.
3. Builds `styles/modern.css` from `main.css` with the Tailwind CSS CLI.
4. Creates `opal-redesign-firefox.zip`.
5. Packages `manifest-firefox.json` as `manifest.json` inside the zip.

## Expected output

After the command completes, the Firefox upload artifact is:

```text
opal-redesign-firefox.zip
```

No external services or private credentials are required for the build.
