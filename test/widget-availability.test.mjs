import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultLayout, loadLayout } from '../src/layout.ts';
import { isWidgetAvailable } from '../src/widget-availability.ts';

test('first run with favorites and either news container excludes absent native sources', () => {
    const layout = getDefaultLayout(new Set(['Bookmarks', 'Information']));
    assert.deepEqual(layout.filter(e => !e.hidden).map(e => e.widgetId),
        ['favorites', 'calendar', 'neuigkeiten', 'quickaccess', 'mensa']);
    for (const id of ['courses', 'groups', 'recent', 'institution', 'performance', 'stats'])
        assert.equal(layout.some(e => e.widgetId === id), false);
    for (const id of ['whats-new', 'deadline', 'toolbox'])
        assert.equal(layout.find(e => e.widgetId === id).hidden, true);
    assert.equal(isWidgetAvailable('neuigkeiten', new Set(['InfoMessages'])), true);
});

test('an empty inventory means detection failed and keeps the full default; stats needs both sources', () => {
    assert.deepEqual(getDefaultLayout(new Set()), getDefaultLayout());
    assert.equal(isWidgetAvailable('stats', new Set(['Bookmarks'])), false);
    assert.equal(isWidgetAvailable('stats', new Set(['Bookmarks', 'RepositoryPortletStudent'])), true);
});

test('saved layout retains geometry and visibility even when native sources are absent', async () => {
    const saved = [{ widgetId: 'courses', x: 3, y: 8, w: 7, h: 4, hidden: false }];
    const previous = globalThis.chrome;
    globalThis.chrome = { storage: { local: { get: (_, cb) => cb({ opalDashboardLayout_v4: saved }), set: async () => {} } } };
    try {
        const layout = await loadLayout(new Set(['Information']));
        assert.deepEqual(layout[0], saved[0]);
        assert.equal(layout.some(e => e.widgetId === 'favorites'), false);
    } finally { globalThis.chrome = previous; }
});

test('self-sufficient widgets stay available and registry metadata drives matching', async () => {
    const { WIDGETS } = await import('../src/widgets/index.ts');
    for (const id of ['calendar', 'quickaccess', 'mensa', 'deadline', 'toolbox', 'whats-new'])
        assert.equal(isWidgetAvailable(id, new Set(['unrelated'])), true);
    const widget = WIDGETS.get('favorites');
    const previous = widget.opalPortletOrder;
    try {
        widget.opalPortletOrder = 'TestPortlet';
        assert.equal(isWidgetAvailable('favorites', new Set(['Bookmarks'])), false);
        assert.equal(isWidgetAvailable('favorites', new Set(['TestPortlet'])), true);
    } finally { widget.opalPortletOrder = previous; }
    assert.equal(isWidgetAvailable('neuigkeiten', new Set(['unrelated'])), false);
});
