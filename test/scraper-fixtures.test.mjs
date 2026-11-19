import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    extractCourseNodeLinksFromMarkup,
    inferExtensionFromName,
    inferExtensionFromUrl,
    readBestLinkTitle,
} from '../src/core/opal-link-parser.ts';
import { parseCourseListItems } from '../src/widgets/course-list-scraper.ts';

test('course portlet fixture extracts enrolled courses', () => {
    const html = readFileSync('test/fixtures/courses-portlet.html', 'utf8');
    const courses = parseCourseListItems(html, 'enrolled', false);

    assert.equal(courses.length, 2);
    assert.deepEqual(courses[0], {
        title: 'Mathematik 1',
        href: '/opal/auth/RepositoryEntry/1001',
        type: 'enrolled',
        moduleCode: null,
    });
    assert.equal(courses[1].title, 'Physik & Labor');
});

test('favorites fixture extracts module codes', () => {
    const html = readFileSync('test/fixtures/favorites-portlet.html', 'utf8');
    const favorites = parseCourseListItems(html, 'course', true);

    assert.equal(favorites.length, 1);
    assert.equal(favorites[0].moduleCode, 'INF-B-110');
});

test('material link fixture extracts OPAL CourseNode links from mixed attributes', () => {
    const html = readFileSync('test/fixtures/material-links.html', 'utf8');
    const links = extractCourseNodeLinksFromMarkup(
        html,
        'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/4242',
    );

    assert.deepEqual(links.map(link => link.title), ['Vorlesungsfolien', 'Uebungen', 'Pruefung']);
    assert.deepEqual(links.map(link => link.url), [
        'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/4242/CourseNode/111',
        'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/4242/CourseNode/222',
        'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/4242/CourseNode/333',
    ]);
});

test('file link helpers prefer stable OPAL metadata and infer extensions', () => {
    const href = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/1/FileResource/skript_final.PDF';

    assert.equal(readBestLinkTitle({ title: 'Skript Woche 1.pdf' }, '', href), 'Skript Woche 1.pdf');
    assert.equal(readBestLinkTitle({}, '', href), 'skript_final.PDF');
    assert.equal(inferExtensionFromUrl(href), 'pdf');
    assert.equal(inferExtensionFromName('Folien.odp'), 'odp');
});
import { matchesComponentSuffix, parseWicketRegistrations, pruneStaleIds } from '../src/core/wicket-registry.ts';

test('saved start page registrations resolve verified language-independent components', () => {
    const html = readFileSync('Startseite - OPAL mit offenen settings.htm', 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
    const entries = scripts.flatMap(parseWicketRegistrations);
    for (const suffix of ['optionsSettings', 'optionsCalendar', 'optionsProfile', 'optionsNews', 'optionsDisplaySettings', 'profileLink', 'settingsLink', 'notificationsLink', 'logoutLink']) {
        assert.ok(entries.some(entry => matchesComponentSuffix(entry.path, suffix)), suffix);
    }
    assert.ok(entries.some(entry => entry.id === 'idd9' && matchesComponentSuffix(entry.path, 'logoutLink')));
});

test('component suffixes ignore page versions and list positions but require whole components', () => {
    for (const path of ['/opal/home/?6-1.0-html-leftPortlets-1-configure&ajax=true', '/opal/home/?27-2.4-html-leftPortlets-8-configure&ajax=true']) {
        assert.ok(matchesComponentSuffix(path, 'configure'));
        assert.ok(matchesComponentSuffix(path, 'leftPortlets-configure'));
        assert.equal(matchesComponentSuffix(path, 'figure'), false);
        assert.equal(matchesComponentSuffix(path, ''), false);
    }
});

test('registration parser handles escaped strings and ignores malformed data without evaluation', () => {
    assert.deepEqual(parseWicketRegistrations('Wicket.Ajax.ajax({"c":"id1","u":"/opal/home/?1-a\\u002db&ajax=true","bh":[function(){throw 1;}]});'), [{ id: 'id1', path: '/opal/home/?1-a-b&ajax=true' }]);
    assert.deepEqual(parseWicketRegistrations('Wicket.Ajax.ajax({"c":"id1"});'), []);
});

test('pruning removes old ids after replacement and preserves current registrations', () => {
    const registry = new Map([['old', 'path'], ['new', 'path']]);
    pruneStaleIds(registry, id => id === 'new');
    assert.deepEqual([...registry], [['new', 'path']]);
    pruneStaleIds(registry, () => false);
    assert.equal(registry.size, 0);
});
