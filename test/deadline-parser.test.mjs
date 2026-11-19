process.env.TZ = 'Europe/Berlin';

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeadlines, hasDateLikeText } from '../src/core/deadline-parser.ts';

const NOW = new Date(2026, 10, 15, 12, 0); // 15.11.2026 12:00 local
const parse = (text, now = NOW) => parseDeadlines(text, now);
const local = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const one = (text, now = NOW) => {
    const found = parse(text, now);
    assert.equal(found.length, 1, `expected one deadline in: ${text} got ${JSON.stringify(found)}`);
    return { ...found[0], at: local(found[0].due) };
};

/* ── Formats ── */

test('dd.mm.yyyy defaults to 23:59 local', () => {
    const d = one('Abgabe: 24.11.2026');
    assert.equal(d.at, '2026-11-24 23:59');
    assert.equal(d.kind, 'deadline');
    assert.equal(d.hasTime, false);
});
test('dd.mm.yy', () => assert.equal(one('Abgabetermin 24.11.26').at, '2026-11-24 23:59'));
test('date with time', () => assert.equal(one('Abgabefrist 24.11.2026 18:00').at, '2026-11-24 18:00'));
test('date, time Uhr', () => {
    const d = one('Die Abgabe ist am 24.11.2026, 12:30 Uhr.');
    assert.equal(d.at, '2026-11-24 12:30');
    assert.equal(d.hasTime, true);
});
test('date um 12 Uhr and 23.59 Uhr', () => {
    assert.equal(one('Einreichung bis 24.11.2026 um 12 Uhr').at, '2026-11-24 12:00');
    assert.equal(one('Einreichung bis 24.11.2026 23.59 Uhr').at, '2026-11-24 23:59');
});
test('24:00 becomes 23:59', () => assert.equal(one('Abgabe bis 24.11.2026 24:00 Uhr').at, '2026-11-24 23:59'));
test('long month name', () => assert.equal(one('Abgabe bis 24. November 2026').at, '2026-11-24 23:59'));
test('abbreviated month name with dot', () => assert.equal(one('Abgabe bis 24. Nov. 2026, 10:00 Uhr').at, '2026-11-24 10:00'));
test('März with umlaut', () => assert.equal(one('Abgabe bis 3. März 2027').at, '2027-03-03 23:59'));
test('English month first', () => assert.equal(one('Submission deadline: November 24, 2026 at 11:59 pm').at, '2026-11-24 23:59'));
test('ISO date and ISO with time', () => {
    assert.equal(one('Deadline 2026-11-24').at, '2026-11-24 23:59');
    assert.equal(one('Deadline 2026-11-24T14:00').at, '2026-11-24 14:00');
});
test('bis dd.mm. infers the next occurrence', () => {
    assert.equal(one('Abgabe bis 24.11.').at, '2026-11-24 23:59');
    assert.equal(one('Abgabe bis 01.03.').at, '2027-03-01 23:59');
});
test('bis dd.mm. with time', () => assert.equal(one('Abgabe bis 24.11. 23:59 Uhr').at, '2026-11-24 23:59'));
test('weekday abbreviation before the date does not split the sentence', () => {
    assert.equal(one('Abgabe bis Mo. 24.11.2026').at, '2026-11-24 23:59');
});

/* ── Year inference around New Year ── */

test('year inference in late December points into January', () => {
    const dec = new Date(2026, 11, 28, 10, 0);
    assert.equal(one('Abgabe bis 05.01.', dec).at, '2027-01-05 23:59');
    assert.equal(one('Abgabe bis 30.12.', dec).at, '2026-12-30 23:59');
});
test('year inference in early January', () => {
    const jan = new Date(2027, 0, 3, 10, 0);
    assert.equal(one('Abgabe bis 10.01.', jan).at, '2027-01-10 23:59');
    assert.equal(one('Abgabe bis 28.12.', jan).at, '2027-12-28 23:59');
});
test('today without a year still counts', () => assert.equal(one('Abgabe bis 15.11.').at, '2026-11-15 23:59'));

/* ── Keyword families ── */

const KEYWORDS = [
    'Abgabe 24.11.2026',
    'Abgabetermin: 24.11.2026',
    'Abgabefrist: 24.11.2026',
    'Abgabe bis 24.11.2026',
    'Einreichung am 24.11.2026',
    'Bitte bis 24.11.2026 einreichen.',
    'Frist: 24.11.2026',
    'Deadline: 24.11.2026',
    'Die Hausarbeit ist am 24.11.2026 fällig.',
    'The report is due 24.11.2026',
    'Spätestens am 24.11.2026',
    'Lösungen bis zum 24.11.2026 hochladen',
    'Die Bearbeitungsfrist endet am 24.11.2026.',
];
for (const text of KEYWORDS) {
    test(`deadline keyword: ${text}`, () => {
        const d = one(text);
        assert.equal(d.kind, 'deadline');
        assert.equal(d.at, '2026-11-24 23:59');
    });
}

test('enrolment keywords are their own kind', () => {
    for (const text of ['Die Einschreibung endet am 20.11.2026.', 'Einschreibefrist: 20.11.2026', 'Einschreibung bis 20.11.2026 möglich.']) {
        const d = one(text);
        assert.equal(d.kind, 'enrolment', text);
        assert.equal(d.at, '2026-11-20 23:59');
    }
});
test('exam only with an explicit keyword', () => {
    assert.equal(one('Die Klausur am 10.02.2027 beginnt um 9 Uhr.').kind, 'exam');
    assert.equal(one('Prüfung am 10.02.2027, 08:00 Uhr').at, '2027-02-10 08:00');
    assert.equal(one('Die Modulprüfung findet am 10.02.2027 statt.').kind, 'exam');
    assert.deepEqual(parse('Die Klausurvorbereitung ist sehr wichtig. Treffen 10.02.2027.'), []);
});

/* ── Ranges ── */

test('Bearbeitungszeitraum range takes the end date', () => {
    const d = one('Bearbeitungszeitraum: 16.11.2026 bis 30.11.2026, 12:00 Uhr');
    assert.equal(d.at, '2026-11-30 12:00');
});
test('dash range and vom ... bis zum', () => {
    assert.equal(one('Abgabezeitraum 16.11.2026 – 27.11.2026').at, '2026-11-27 23:59');
    assert.equal(one('Einreichung vom 16.11. bis zum 27.11.2026').at, '2026-11-27 23:59');
});

/* ── Negatives ── */

test('date without a keyword is not a deadline', () => {
    assert.deepEqual(parse('Die Vorlesung am 24.11.2026 fällt aus.'.replace('fällt aus', 'findet statt')), []);
    assert.deepEqual(parse('Termin: 24.11.2026 im Hörsaal 3'), []);
});
test('keyword too far away or in another sentence', () => {
    assert.deepEqual(parse('Die Abgabe erfolgt elektronisch. Am 24.11.2026 gibt es eine Sprechstunde.'), []);
    const filler = ' Weitere Hinweise zur Organisation der Übung finden Sie im Kursbereich unter Materialien';
    assert.deepEqual(parse(`Abgabe${filler} am 24.11.2026`), []);
});
test('past dates are ignored', () => {
    assert.deepEqual(parse('Abgabe bis 01.11.2026'), []);
    assert.deepEqual(parse('Abgabe bis 24.11.2025'), []);
});
test('Stand and other metadata dates are ignored even near a keyword', () => {
    assert.deepEqual(parse('Stand: 01.12.2026'), []);
    assert.deepEqual(parse('Abgabehinweise (Stand: 01.12.2026)'), []);
    assert.deepEqual(parse('Abgabeordner, zuletzt geändert am 01.12.2026'), []);
    assert.deepEqual(parse('Abgabe ab 01.12.2026 möglich'), []);
});
test('phone and version numbers that look like dates', () => {
    assert.deepEqual(parse('Fragen zur Abgabe: Tel. 0351 463-12345 oder 12.34.56'), []);
    assert.deepEqual(parse('Abgabe mit Software Version 1.12.2026'), []);
    assert.deepEqual(parse('Abgabe mit Version v2.11.26'), []);
    assert.deepEqual(parse('Abgabe: Paket 1.2.3.4 installieren'), []);
    assert.deepEqual(parse('Abgabe in Raum 24.11.2026.3'), []);
});
test('impossible dates are ignored', () => {
    assert.deepEqual(parse('Abgabe bis 31.02.2027'), []);
    assert.deepEqual(parse('Abgabe bis 12.13.2026'), []);
});

/* ── Dedupe and description ── */

test('one deadline per day and kind, explicit time preferred', () => {
    const found = parse('Abgabe bis 24.11.2026. Nochmals: Abgabe bis 24.11.2026, 18:00 Uhr. Klausur am 24.11.2026.');
    assert.equal(found.length, 2);
    assert.equal(local(found.find(f => f.kind === 'deadline').due), '2026-11-24 18:00');
    assert.ok(found.some(f => f.kind === 'exam'));
});
test('several deadlines in one text, sorted', () => {
    const found = parse('Übungsblatt 2: Abgabe bis 01.12.2026.\nÜbungsblatt 1: Abgabe bis 24.11.2026.');
    assert.deepEqual(found.map(f => local(f.due)), ['2026-11-24 23:59', '2026-12-01 23:59']);
});
test('description is the sentence, shortened', () => {
    const d = one('Allgemeines zur Übung. Die Abgabe des Protokolls erfolgt bis 24.11.2026 im OPAL-Ordner. Danach keine Annahme.');
    assert.equal(d.sentence, 'Die Abgabe des Protokolls erfolgt bis 24.11.2026 im OPAL-Ordner.');
    const long = one(`Abgabe bis 24.11.2026 ${'sehr lange Erläuterung '.repeat(20)}`);
    assert.ok(long.sentence.length <= 160);
    assert.ok(long.sentence.endsWith('…'));
});
test('hasDateLikeText pre-check', () => {
    assert.equal(hasDateLikeText('Keine Termine hier'), false);
    assert.equal(hasDateLikeText('bis 24.11.'), true);
    assert.equal(hasDateLikeText('2026-11-24'), true);
    assert.equal(hasDateLikeText('24. November'), true);
});
test('garbage input never throws', () => {
    assert.deepEqual(parseDeadlines('', NOW), []);
    assert.doesNotThrow(() => parseDeadlines('Abgabe '.repeat(10000) + '1.1.'.repeat(5000), NOW));
});
