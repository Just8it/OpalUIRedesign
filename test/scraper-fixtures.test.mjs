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
