process.env.TZ = 'Europe/Berlin';

import test from 'node:test';
import assert from 'node:assert/strict';

/* chrome.storage stub, installed before the modules load */
const store = {};
globalThis.chrome = {
    storage: {
        local: {
            get: async key => Object.fromEntries((Array.isArray(key) ? key : [key]).filter(k => k in store).map(k => [k, structuredClone(store[k])])),
            set: async obj => { Object.assign(store, structuredClone(obj)); },
        },
        onChanged: { addListener() {} },
    },
};

const {
    mergeScrapedDeadlines, dismissInList, visibleScrapedDeadlines, sanitizeScrapedDeadlines, deadlineId,
    flushScrapedDeadlines, dismissScrapedDeadline, MAX_SCRAPED_DEADLINES, SCRAPED_DEADLINES_KEY, SCRAPED_DEADLINES_ENABLED_KEY,
} = await import('../src/core/deadline-store.ts');
const { collectDeadlinesFromDoc, extractMainText, toScrapedDeadlines } = await import('../src/core/deadline-collector.ts');

const NOW = Date.UTC(2026, 10, 15, 12);
const DAY = 86_400_000;
const PAGE = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/1/CourseNode/2';
const entry = (id, dueOffsetDays, extra = {}) => ({
    id, title: `Blatt ${id}`, courseId: '/opal/auth/RepositoryEntry/1', pageUrl: PAGE,
    due: new Date(NOW + dueOffsetDays * DAY).toISOString(), kind: 'deadline',
    foundAt: new Date(NOW).toISOString(), ...extra,
});

/* ── Pure logic ── */

test('merge by id never duplicates and keeps first foundAt', () => {
    const a = entry('a', 3);
    const again = { ...entry('a', 3), title: 'Neu', foundAt: new Date(NOW + DAY).toISOString() };
    const merged = mergeScrapedDeadlines([a], [again], [], NOW);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].title, 'Neu');
    assert.equal(merged[0].foundAt, a.foundAt);
});
test('re-crawl never clears dismissed', () => {
    const merged = mergeScrapedDeadlines([entry('a', 3, { dismissed: true })], [entry('a', 3)], [PAGE], NOW);
    assert.equal(merged[0].dismissed, true);
});
test('a rescanned page drops open entries no longer found, keeps dismissed ones', () => {
    const existing = [entry('a', 3), entry('b', 4, { dismissed: true }), entry('c', 5, { pageUrl: PAGE + '1' })];
    const merged = mergeScrapedDeadlines(existing, [], [PAGE], NOW);
    assert.deepEqual(merged.map(e => e.id), ['b', 'c']);
});
test('entries more than one day past due are pruned', () => {
    const merged = mergeScrapedDeadlines([entry('old', -1.5), entry('recent', -0.5), entry('soon', 1)], [], [], NOW);
    assert.deepEqual(merged.map(e => e.id), ['recent', 'soon']);
});
test('cap keeps the soonest open entries first', () => {
    const many = Array.from({ length: MAX_SCRAPED_DEADLINES + 20 }, (_, i) => entry(`e${i}`, i + 1, i < 30 ? { dismissed: true } : {}));
    const merged = mergeScrapedDeadlines(many, [], [], NOW);
    assert.equal(merged.length, MAX_SCRAPED_DEADLINES);
    assert.equal(merged.filter(e => e.dismissed).length, 10);
    assert.ok(Date.parse(merged[0].due) <= Date.parse(merged[1].due));
});
test('dismiss and visible filter', () => {
    const list = dismissInList([entry('a', 1), entry('b', 2), entry('past', -0.2)], 'a');
    assert.equal(list[0].dismissed, true);
    assert.deepEqual(visibleScrapedDeadlines(list, NOW).map(e => e.id), ['b']);
});
test('sanitize drops malformed entries', () => {
    const clean = sanitizeScrapedDeadlines([entry('a', 1), { id: 'x' }, null, { ...entry('b', 1), kind: 'party' }, { ...entry('c', 1), due: 'nope' }]);
    assert.deepEqual(clean.map(e => e.id), ['a']);
    assert.deepEqual(sanitizeScrapedDeadlines('junk'), []);
});
test('untitled deadlines keep an empty title for the widget to localize', () => {
    const found = [{ due: new Date(NOW + DAY), kind: 'deadline' }];
    const ctx = { courseId: '/opal/auth/RepositoryEntry/1', pageUrl: PAGE, pageTitle: '' };
    const [untitled] = toScrapedDeadlines(found, ctx, PAGE, new Date(NOW));
    assert.equal(untitled.title, '');
    assert.deepEqual(sanitizeScrapedDeadlines([untitled]), [untitled]);

    const [named] = toScrapedDeadlines(found, { ...ctx, pageTitle: 'OPAL - Frist' }, PAGE, new Date(NOW));
    assert.equal(named.title, 'Frist');
});

test('ids are stable and differ by day and kind', () => {
    assert.equal(deadlineId(PAGE, '2026-11-24', 'deadline'), deadlineId(PAGE, '2026-11-24', 'deadline'));
    assert.notEqual(deadlineId(PAGE, '2026-11-24', 'deadline'), deadlineId(PAGE, '2026-11-24', 'exam'));
    assert.notEqual(deadlineId(PAGE, '2026-11-24', 'deadline'), deadlineId(PAGE, '2026-11-25', 'deadline'));
});

/* ── Minimal DOM stub for the collector ── */

class Text { constructor(v) { this.nodeType = 3; this.nodeValue = v; this.parentNode = null; } }
class El {
    constructor(tag, attrs = {}, children = []) {
        this.nodeType = 1;
        this.tagName = tag.toUpperCase();
        this.attrs = attrs;
        this.id = attrs.id ?? '';
        this.parentNode = null;
        this.childNodes = children.map(c => (typeof c === 'string' ? new Text(c) : c));
        for (const c of this.childNodes) c.parentNode = this;
        const cls = (attrs.class ?? '').split(/\s+/).filter(Boolean);
        this.classList = { contains: c => cls.includes(c) };
    }
    getAttribute(n) { return n in this.attrs ? String(this.attrs[n]) : null; }
    hasAttribute(n) { return n in this.attrs; }
    matches(sel) {
        return sel.split(',').map(s => s.trim()).some(s => {
            if (s === '[id^="opal-"]') return this.id.startsWith('opal-');
            if (s === '[role="main"]') return this.attrs.role === 'main';
            if (s.startsWith('.')) return this.classList.contains(s.slice(1));
            if (s.startsWith('#')) return this.id === s.slice(1);
            return this.tagName === s.toUpperCase();
        });
    }
    closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
    querySelectorAll(sel) {
        const out = [];
        const walk = n => { for (const c of n.childNodes) if (c.nodeType === 1) { if (c.matches(sel)) out.push(c); walk(c); } };
        walk(this);
        return out;
    }
    get textContent() { return this.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); }
}
const h = (tag, attrs, ...children) => new El(tag, attrs, children);
const makeDoc = (body, title = 'Übungsblatt 3') => ({ title, body, querySelectorAll: sel => body.querySelectorAll(sel) });

/* The collector reads the real clock, so page dates are relative to today. */
const fmt = days => { const d = new Date(Date.now() + days * DAY); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
const [D9, D16, D17, D18, D19, D20, D30, D90] = [9, 16, 17, 18, 19, 20, 30, 90].map(fmt);
const page = () => makeDoc(h('body', {},
    h('nav', { class: 'menu menu-course' }, `Abgabe Blatt 9 bis ${D16}`),
    h('div', { id: 'opal-modern-ui' }, h('main', {}, `Abgabe bis ${D17}`)),
    h('div', { class: 'content-container' },
        h('h2', {}, 'Übungsblatt 3'),
        h('p', {}, 'Die Abgabe erfolgt bis ', h('strong', {}, `${D9}, 12:00 Uhr`), ' im Ordner.'),
        h('p', {}, `Klausur am ${D90}`),
        h('p', { hidden: '' }, `Abgabe bis ${D18}`),
        h('div', { style: 'display: none' }, `Abgabe bis ${D19}`),
        h('script', {}, `var abgabe = "Abgabe bis ${D20}";`),
        h('p', {}, 'Stand: 01.10.2026'),
    ),
));

test('extractMainText takes the content area and skips nav, hidden, scripts and own UI', () => {
    const text = extractMainText(page());
    assert.ok(text.includes(`Die Abgabe erfolgt bis ${D9}, 12:00 Uhr im Ordner.`));
    for (const day of [D16, D17, D18, D19, D20]) assert.ok(!text.includes(day), day);
    assert.ok(text.includes('\nKlausur am'));
});

test('collector queues, flush writes, re-collect merges, dismiss sticks', async () => {
    try {
        const ctx = { courseId: '/opal/auth/RepositoryEntry/1', courseTitle: 'Strömungslehre', pageUrl: '/opal/auth/RepositoryEntry/1/CourseNode/2#top', pageTitle: 'OPAL - Übungsblatt 3' };
        collectDeadlinesFromDoc(page(), ctx);
        await flushScrapedDeadlines();
        let saved = store[SCRAPED_DEADLINES_KEY];
        assert.equal(saved.length, 2);
        const hand = saved.find(e => e.kind === 'deadline');
        assert.equal(hand.title, 'Übungsblatt 3');
        assert.equal(hand.courseTitle, 'Strömungslehre');
        assert.equal(hand.pageUrl, PAGE);
        assert.ok(hand.description.startsWith(`Die Abgabe erfolgt bis ${D9}`));
        assert.ok(saved.some(e => e.kind === 'exam'));

        await dismissScrapedDeadline(hand.id);
        collectDeadlinesFromDoc(page(), ctx);
        collectDeadlinesFromDoc(page(), ctx);
        await flushScrapedDeadlines();
        saved = store[SCRAPED_DEADLINES_KEY];
        assert.equal(saved.length, 2);
        assert.equal(saved.find(e => e.id === hand.id).dismissed, true);

        // Disabled: nothing more is written.
        store[SCRAPED_DEADLINES_ENABLED_KEY] = false;
        collectDeadlinesFromDoc(makeDoc(h('body', {}, h('p', {}, `Abgabe bis ${D30}`))), { ...ctx, pageUrl: PAGE + '9' });
        await flushScrapedDeadlines();
        assert.equal(store[SCRAPED_DEADLINES_KEY].length, 2);
    } finally {
        delete store[SCRAPED_DEADLINES_ENABLED_KEY];
    }
});

test('collector never throws on broken input and ignores foreign urls', async () => {
    assert.doesNotThrow(() => collectDeadlinesFromDoc(null, null));
    assert.doesNotThrow(() => collectDeadlinesFromDoc({}, { courseId: '', pageUrl: '', pageTitle: '' }));
    const before = JSON.stringify(store);
    collectDeadlinesFromDoc(page(), { courseId: '', pageUrl: 'https://evil.example/opal/x', pageTitle: 'x' });
    await flushScrapedDeadlines();
    assert.equal(JSON.stringify(store), before);
});
