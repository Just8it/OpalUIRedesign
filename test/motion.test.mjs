import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const calls = [];
globalThis.__motionCalls = calls;
const mockURL =
    'data:text/javascript,' +
    encodeURIComponent(
        `export const spring = () => {}; export function animate(el, frames, options) { let done; const control = { cancel() { control.cancelled = true; }, then(cb) { done = cb; }, complete() { done(); } }; globalThis.__motionCalls.push({el, frames, options, control}); return control; }`,
    );
registerHooks({
    resolve(specifier, context, next) {
        return specifier === 'motion/mini' || specifier === 'motion'
            ? { url: mockURL, shortCircuit: true }
            : next(specifier, context);
    },
});
const media = {
    matches: false,
    addEventListener(_, fn) {
        this.change = fn;
    },
};
globalThis.matchMedia = () => media;
globalThis.getComputedStyle = () => ({
    opacity: '.45',
    getPropertyValue: (key) => (key === 'opacity' ? '.45' : 'matrix(1, 0, 0, 1, 0, 3)'),
});
const motion = await import('../src/motion.ts');
function element() {
    const values = new Map();
    return {
        isConnected: true,
        style: {
            getPropertyValue: (key) => values.get(key) ?? '',
            getPropertyPriority: () => '',
            setProperty: (key, value) => values.set(key, value),
            removeProperty: (key) => values.delete(key),
        },
    };
}
test('stagger always ends within 260ms, preserving 18ms for short lists', () => {
    assert.equal(motion.staggerDelay(1, 4), 0.018);
    for (const count of [1, 6, 12, 1000])
        assert.ok(motion.staggerDelay(count - 1, count) + motion.TIMES.enter <= 0.260001);
});
test('reduced motion applies end state synchronously without library calls, then restores CSS', async () => {
    media.matches = true;
    const el = element();
    const before = calls.length;
    const done = motion.enter(el);
    assert.equal(el.style.getPropertyValue('opacity'), '1');
    assert.equal(el.style.getPropertyValue('transform'), 'none');
    assert.equal(calls.length, before);
    await done;
    assert.equal(el.style.getPropertyValue('opacity'), '');
    media.matches = false;
});
test('interruption resolves old work as cancelled and starts from sampled current state', async () => {
    const el = element();
    el.style.setProperty('opacity', '.8');
    const first = motion.enter(el);
    const old = calls.at(-1);
    const second = motion.pop(el);
    const next = calls.at(-1);
    assert.equal(await first, false);
    assert.equal(old.control.cancelled, true);
    assert.equal(next.frames.opacity[0], '.45');
    old.control.complete(); // stale completion cannot clean up the replacement
    next.control.complete();
    assert.equal(await second, true);
    assert.equal(el.style.getPropertyValue('opacity'), '.8');
    assert.equal(el.style.getPropertyValue('transform'), '');
});
test('live reduced-motion change finishes active work and disconnected nodes are ignored', async () => {
    const el = element();
    const done = motion.enter(el);
    media.matches = true;
    media.change();
    assert.equal(await done, true);
    media.matches = false;
    const before = calls.length;
    el.isConnected = false;
    assert.equal(await motion.enter(el), false);
    assert.equal(calls.length, before);
});
test('collapse applies hidden end state synchronously under reduced motion', async () => {
    media.matches = true;
    const el = element();
    el.hidden = false;
    const done = motion.collapse(el, false);
    assert.equal(el.hidden, true);
    await done;
    motion.collapse(el, true);
    assert.equal(el.hidden, false);
    media.matches = false;
});
test('repeated reduced-motion calls in one turn do not restore temporary styles', async () => {
    media.matches = true;
    const el = element();
    await Promise.all([motion.enter(el), motion.pop(el), motion.exit(el)]);
    assert.equal(el.style.getPropertyValue('opacity'), '');
    assert.equal(el.style.getPropertyValue('transform'), '');
    media.matches = false;
});
