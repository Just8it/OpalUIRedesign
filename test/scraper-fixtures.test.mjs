import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
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
