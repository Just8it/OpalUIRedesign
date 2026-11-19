
import test from 'node:test';
import assert from 'node:assert/strict';
import { dateForOffset, mensaCacheKey, initMensa, getCachedMensaState, setViewDate } from '../src/mensa-store.ts';
process.env.TZ = 'Europe/Berlin';

test('local midnight, month rollover and DST day offsets', () => {
    assert.equal(dateForOffset(0, new Date('2026-03-31T22:30:00Z')), '2026-04-01');
    assert.equal(dateForOffset(-1, new Date(2026, 3, 1, 0, 30)), '2026-03-31');
    assert.equal(dateForOffset(1, new Date(2026, 2, 28, 12)), '2026-03-29');
    assert.notEqual(mensaCacheKey(1, '2026-01-01'), mensaCacheKey(4, '2026-01-01'));
    assert.notEqual(mensaCacheKey(1, '2026-01-01'), mensaCacheKey(1, '2026-01-02'));
});
test('bad HTTP and malformed data preserve good cache and dates stay isolated', async () => {
    const original = globalThis.fetch;
    const meals = [{ id: 1, name: 'Meal', category: 'Main', prices: { students: 2, employees: null, others: 4 }, notes: [] }];
    try {
        globalThis.fetch = async () => ({ ok: true, json: async () => meals });
        await initMensa(true);
        globalThis.fetch = async () => ({ ok: false, status: 500 });
        await initMensa(true);
        assert.deepEqual(getCachedMensaState().meals, meals);
        assert.equal(getCachedMensaState().error, true);
        globalThis.fetch = async () => ({ ok: true, json: async () => ({ error: 'bad' }) });
        await initMensa(true);
        assert.deepEqual(getCachedMensaState().meals, meals);
        setViewDate(1);
        assert.deepEqual(getCachedMensaState().meals, []);
        await initMensa();
        assert.equal(getCachedMensaState().error, true);
    } finally { globalThis.fetch = original; setViewDate(-1); }
});

test('meals with German price groups (current API) are read, a broken meal is dropped alone', async () => {
    const { normaliseMeal } = await import('../src/mensa-store.ts');
    const meal = normaliseMeal({ id: 1, name: 'Gyros', category: 'Hauptgericht', notes: ['enthält Knoblauch', 3], prices: { Studierende: 3.2, Bedienstete: 5.1 } });
    assert.deepEqual(meal.prices, { students: 3.2, employees: 5.1, others: null });
    assert.deepEqual(meal.notes, ['enthält Knoblauch']);
    assert.equal(normaliseMeal({ id: 2, name: 'Alt', category: 'X', notes: [], prices: { students: 2, employees: 3, others: 4 } }).prices.others, 4);
    assert.equal(normaliseMeal({ name: 'kein id' }), null);
    assert.equal(normaliseMeal({ id: 3, name: 'Ausverkauft', category: 'X', notes: [], prices: { Studierende: null } }).prices.students, null);
});
