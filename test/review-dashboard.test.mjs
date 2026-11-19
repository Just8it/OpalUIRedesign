import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { getDefaultLayout } from '../src/layout.ts';
import { isStableNewFileUrl } from '../src/widgets/whats-new-helpers.ts';
// Load the pure parser without initializing the palette's browser integrations.
const source = readFileSync(new URL('../src/command-center.ts', import.meta.url), 'utf8');
const parser = source.slice(source.indexOf('export function parseCommandQuery'), source.indexOf('function findCommandActions'));
const { parseCommandQuery } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(parser)).toString('base64'));
test('commands require > and preserve the remaining filter', () => {
    assert.deepEqual(parseCommandQuery('>'), { commandMode: true, query: '' });
    assert.deepEqual(parseCommandQuery('  >  Suchindex  '), { commandMode: true, query: 'Suchindex' });
    for (const query of ['Suchindex', 'Kurs > Datei', '/f skript', '']) assert.equal(parseCommandQuery(query).commandMode, false);
});
test('new files open stable OPAL paths but reject listener and foreign URLs', () => {
    for (const url of ['/opal/auth/RepositoryEntry/12/file.pdf', 'https://bildungsportal.sachsen.de/opal/files/notes.pdf?download=1']) assert.equal(isStableNewFileUrl(url), true);
    for (const url of ['/opal/home?6-1.ILinkListener-file', 'https://example.com/opal/a.pdf', 'javascript:alert(1)', '/other/file.pdf']) assert.equal(isStableNewFileUrl(url), false);
});
test('default layout is bounded, non-overlapping, and follows the reading order', () => {
    const layout = getDefaultLayout();
    assert.deepEqual(layout.filter(e => !e.hidden).map(e => e.widgetId), ['favorites', 'courses', 'calendar', 'neuigkeiten', 'quickaccess']);
    assert.ok(layout.find(e => e.widgetId === 'favorites').h >= 5);
    for (const [i, a] of layout.entries()) {
        assert.ok(a.x >= 0 && a.y >= 0 && a.w > 0 && a.h > 0 && a.x + a.w <= 12);
        for (const b of layout.slice(i + 1)) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.widgetId} overlaps ${b.widgetId}`);
    }
});
