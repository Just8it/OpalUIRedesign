
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, expandRecurring, getEventsForDay } from '../src/calendar-store.ts';

process.env.TZ = 'Europe/Berlin';
const parse = body => parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Lecture\r\n' + body.replaceAll('\n', '\r\n') + '\r\nEND:VEVENT\r\nEND:VCALENDAR');
const expand = (body, start = '2026-01-01', end = '2026-12-31') => expandRecurring(parse(body), new Date(start), new Date(end));

test('CRLF, folded lines, parameters and text escapes', () => {
    const [event] = parse('DTSTART;TZID=Europe/Berlin:20260323T090000\nDTEND;TZID=Europe/Berlin:20260323T100000\nDESCRIPTION:one\\,two\\;three\\nnext\n folded');
    assert.equal(event.start, '2026-03-23T08:00:00.000Z');
    assert.equal(event.description, 'one,two;three\nnextfolded');
});
test('UTC and floating dates differ by local offset', () => {
    assert.equal(parse('DTSTART:20260101T090000Z')[0].start, '2026-01-01T09:00:00.000Z');
    assert.equal(parse('DTSTART:20260101T090000')[0].start, '2026-01-01T08:00:00.000Z');
});
test('weekly BYDAY starts on matching day, counts before exclusions, crosses DST', () => {
    const events = expand('DTSTART;TZID=Europe/Berlin:20260322T090000\nDTEND;TZID=Europe/Berlin:20260322T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4\nEXDATE;TZID=Europe/Berlin:20260325T090000');
    assert.deepEqual(events.map(e => e.start), ['2026-03-23T08:00:00.000Z', '2026-03-30T07:00:00.000Z', '2026-04-01T07:00:00.000Z']);
});
test('daily interval, UTC UNTIL inclusive and no artificial 52 occurrence cap', () => {
    assert.equal(expand('DTSTART:20260101T090000Z\nRRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20260105T090000Z').length, 3);
    assert.equal(expand('DTSTART:20260101T090000Z\nRRULE:FREQ=DAILY;COUNT=60').length, 60);
});
test('weekly interval and date-only UNTIL', () => {
    const events = expand('DTSTART:20260105T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20260202');
    assert.equal(events.length, 3);
});
test('monthly skips absent month days instead of overflowing', () => {
    assert.deepEqual(expand('DTSTART:20260131T090000\nRRULE:FREQ=MONTHLY;COUNT=3').map(e => new Date(e.start).getMonth()), [0, 2, 4]);
    assert.equal(expand('DTSTART:20260101T090000\nRRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=3').length, 3);
});
test('all-day exclusive end, default single day and range overlap', () => {
    const events = expand('DTSTART;VALUE=DATE:20260130\nDTEND;VALUE=DATE:20260203', '2026-02-01', '2026-02-28');
    assert.equal(events.length, 1);
    assert.equal(getEventsForDay(events, new Date(2026, 1, 2)).length, 1);
    assert.equal(getEventsForDay(events, new Date(2026, 1, 3)).length, 0);
    const one = parse('DTSTART;VALUE=DATE:20260130');
    assert.equal(getEventsForDay(one, new Date(2026, 0, 31)).length, 0);
});
test('overnight and recurring multi-day occurrences appear once per covered day', () => {
    const events = expand('DTSTART:20260101T230000\nDTEND:20260103T010000\nRRULE:FREQ=WEEKLY;COUNT=2', '2026-01-02', '2026-01-03');
    assert.equal(getEventsForDay(events, new Date(2026, 0, 2)).length, 1);
});

test('monthly ordinal BYDAY and multiple UTC exclusions', () => {
    const events = expand('DTSTART:20260101T090000Z\nRRULE:FREQ=MONTHLY;BYDAY=1MO,-1FR;COUNT=4\nEXDATE:20260105T090000Z,20260202T090000Z');
    assert.deepEqual(events.map(e => e.start), ['2026-01-30T09:00:00.000Z', '2026-02-27T09:00:00.000Z']);
});
