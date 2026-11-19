import { build, context } from 'esbuild';
import { buildConfigs } from './build/entries.mjs';
const watch = process.argv.includes('--watch');
await Promise.all(buildConfigs(watch).map(async config => {
    if (watch) await (await context(config)).watch();
    else await build(config);
}));
if (watch) console.log('[esbuild] Watching for changes...');
