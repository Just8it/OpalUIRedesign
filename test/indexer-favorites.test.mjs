import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const output = await build({ entryPoints: ['src/indexer.ts'], bundle: true, write: false, format: 'iife', globalName: 'subject',
    plugins: [{ name: 'courses', setup(build) {
        build.onLoad({ filter: /course[\\/]loader\.ts$/ }, () => ({ contents: `
            export const courseIdFromUrl = url => url.match(/RepositoryEntry\\/(\\d+)/)?.[1] ?? '';
            export const loadCourseInBackground = async id => { globalThis.loads.push(id); return {sections:[]}; };`, loader: 'js' }));
        build.onLoad({ filter: /course[\\/]index-nodes\.ts$/ }, () => ({ contents: 'export const snapshotIndexNodes = () => [];', loader: 'js' }));
        build.onLoad({ filter: /course-matcher\.ts$/ }, () => ({ contents: 'export const matchEventToCourse = title => globalThis.matches[title];', loader: 'js' }));
        build.onLoad({ filter: /calendar-store\.ts$/ }, () => ({ contents: 'export const loadCalendarEvents = async () => globalThis.events; export const expandRecurring = events => events;', loader: 'js' }));
    } }],
});
const href = id => `https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/${id}`;
const course = id => ({ href: href(id), title: `Course ${id}` });
function setup() {
    const data = { opalActiveIndexSettings: { enabled: true } }, portlets = new Map(), messages = [];
    const context = { loads: [], matches: {}, events: [], URL, console,
        location: { origin: 'https://bildungsportal.sachsen.de' },
        document: { querySelector: selector => portlets.get(selector) ?? null },
        window: { addEventListener() {}, setInterval: () => 1, setTimeout: fn => { fn(); return 1; } },
        setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        chrome: { runtime: { sendMessage(message, cb) { messages.push(message); cb?.({ok:true, data:{written:0}}); } },
            storage: { local: { get: async () => data, set: async value => Object.assign(data, value) }, onChanged: { addListener() {} } } },
    };
    runInNewContext(output.outputFiles[0].text, context);
    return { context, data, portlets, messages, subject: context.subject };
}
const portlet = (courses, config = false) => ({
    querySelector: () => config ? {} : null,
    querySelectorAll: () => courses.map(c => ({href:c.href, textContent:c.title})),
});

test('dashboard bootstrap seeds and saves only bookmarks, even with enrolled courses present', async () => {
    const { subject, data, portlets, messages } = setup();
    portlets.set('div[data-portlet-order="Bookmarks"]', portlet([course(123)]));
    portlets.set('div[data-portlet-order="RepositoryPortletStudent"]', portlet([course(999)]));
    await subject.bootstrapFromDashboard();
    await subject.refreshFavoriteIndex();
    assert.deepEqual(JSON.parse(JSON.stringify(data.opalFavoriteSnapshot)), [course(123)]);
    assert.ok(messages.filter(m => m.op === 'upsertMany').flatMap(m => m.nodes).every(n => n.courseId.endsWith('/123')));
});

test('an empty bookmarks list clears stale courses, but absent/configuring portlets preserve the snapshot', async () => {
    const { subject, data, portlets } = setup();
    data.opalFavoriteSnapshot = [course(123)];
    await subject.bootstrapFromDashboard();
    assert.equal(data.opalFavoriteSnapshot.length, 1);
    portlets.set('div[data-portlet-order="Bookmarks"]', portlet([], true));
    await subject.bootstrapFromDashboard();
    assert.equal(data.opalFavoriteSnapshot.length, 1);
    portlets.set('div[data-portlet-order="Bookmarks"]', portlet([]));
    await subject.bootstrapFromDashboard();
    assert.equal(data.opalFavoriteSnapshot.length, 0);
});

test('calendar preloading never visits non-favorite courses, including when forced', async () => {
    const { subject, context, data } = setup();
    data.opalFavoriteSnapshot = [course(123)];
    context.events = [{title:'favorite'}, {title:'enrolled'}];
    context.matches = { favorite: {course: {...course(123), href: href(123).replace('/auth/', '/url/')}}, enrolled: {course:course(999)} };
    await subject.indexUpcomingCourses(true);
    assert.deepEqual(context.loads, ['123']);
    context.loads.length = 0;
    data.opalFavoriteSnapshot = [];
    await subject.indexUpcomingCourses(true);
    assert.deepEqual(context.loads, []);
});
