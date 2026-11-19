import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePackage, bundles } from '../build/entries.mjs';
const fixture = () => new Map([
 ['manifest.json', JSON.stringify({ action: { default_popup: 'popup/popup.html' } })],
 ['popup/popup.html', '<script type="module" src="popup.js"></script>'],
 ['popup/popup.js', "import { open } from '../dist/options-opener.js';"],
 ['dist/options-opener.js', 'export const open = () => {};'],
]);
test('options opener ships and a missing import fails loudly', () => {
 const files = fixture(); validatePackage(files);
 assert.ok(bundles.some(b => b.outfile === 'dist/options-opener.js' && b.format === 'esm'));
 files.delete('dist/options-opener.js');
 assert.throws(() => validatePackage(files), /popup\/popup.js -> ..\/dist\/options-opener.js/);
});
test('all manifest references and local HTML resources are checked', () => {
 const files = fixture();
 files.set('manifest.json', JSON.stringify({content_scripts:[{js:['missing.js'],css:['missing.css']}],background:{service_worker:'worker.js',scripts:['background.js']},web_accessible_resources:[{resources:['icons/*.png']}],options_ui:{page:'options/options.html'},icons:{16:'icon.png'}}));
 assert.throws(() => validatePackage(files), e => ['missing.js','missing.css','worker.js','background.js','icons/*.png','options/options.html','icon.png'].every(p => e.message.includes(p)));
 files.set('manifest.json', '{}');
 files.set('popup/popup.html', '<img src="/icon.png"><a href="https://example.com">external</a>');
 assert.throws(() => validatePackage(files), /icon.png/);
 files.set('icon.png',''); validatePackage(files);
});
test('wildcards, query strings, dynamic imports and options reexports resolve', () => {
 const files = fixture();
 files.set('manifest.json', JSON.stringify({web_accessible_resources:[{resources:['dist/*.js']}]}));
 files.set('options/options.js', "export { open } from '../dist/options-opener.js'; import('../dist/options-opener.js?test');");
 validatePackage(files);
 files.set('options/options.js', "import('./missing.js');");
 assert.throws(() => validatePackage(files), /missing.js/);
});
