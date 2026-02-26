import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const sharedConfig = {
    bundle: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
    logLevel: 'info',
};

const contentConfig = {
    ...sharedConfig,
    entryPoints: ['src/main.ts'],
    outfile: 'dist/content.js',
};

const mainWorldConfig = {
    ...sharedConfig,
    entryPoints: ['src/main-world.ts'],
    outfile: 'dist/main-world.js',
};

if (isWatch) {
    const ctx1 = await context(contentConfig);
    const ctx2 = await context(mainWorldConfig);
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    console.log('[esbuild] Watching for changes...');
} else {
    await Promise.all([build(contentConfig), build(mainWorldConfig)]);
}
