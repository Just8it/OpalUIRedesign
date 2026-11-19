import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeCourseLink, isStableFileUrl } from '../src/core/index-messages.ts';
const root = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/123';
test('crawler stays in exact course and rejects action links and foreign origins', () => {
    assert.equal(isSafeCourseLink(root + '/CourseNode/42', root), true);
    for (const value of [root.replace('/123', '/1234') + '/CourseNode/42', root.replace('https:', 'http:'), root.replace('bildungsportal.sachsen.de', 'evil.example'), root + '/delete', root + '?action=unsubscribe', 'javascript:alert(1)']) {
        assert.equal(isSafeCourseLink(value, root), false, value);
    }
});
test('direct file opening requires a stable OPAL file path', () => {
    assert.equal(isStableFileUrl(root + '/FolderResource/notes.pdf'), true);
    for (const value of [root + '?6-1.ILinkListener-file', root + '/notes.pdf?token=abc', 'https://evil.example/notes.pdf', root + '/CourseNode/42']) {
        assert.equal(isStableFileUrl(value), false, value);
    }
});
