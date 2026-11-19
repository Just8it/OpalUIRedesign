import { animate } from 'motion/mini';
import { spring } from 'motion';

// Seconds throughout (Motion's animate API). No independent transform engine.
export const TIMES = {
    enter: 0.16,
    exit: 0.1,
    pop: 0.14,
    backdrop: 0.12,
    out: 0.08,
    swap: 0.12,
    press: 0.08,
    collapse: 0.16,
  indicator: 0.2,
  stagger: 0.018,
  staggerWindow: 0.1,
} as const;
export const EASE = 'easeOut' as const;
type Frames = Record<string, (string | number)[]>;
type Run = { cancel: () => void; finish: () => void };
const running = new WeakMap<HTMLElement, Run>();
const active = new Set<Run>();
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = () => media?.matches ?? true;
media?.addEventListener('change', () => {
    if (reducedMotion()) [...active].forEach((run) => run.finish());
});
export const staggerDelay = (index: number, count: number) => index * Math.min(TIMES.stagger, TIMES.staggerWindow / Math.max(1, count - 1));

/** False means superseded: callers must not remove or replace that element. */
function run(el: HTMLElement, frames: Frames, duration: number, delay = 0, springy = false): Promise<boolean> {
    if (!el.isConnected) return Promise.resolve(false);
    const previous = running.get(el);
    const current = getComputedStyle(el);
    const from = Object.fromEntries(Object.keys(frames).map((key) => [key, current.getPropertyValue(key)]));
    previous?.cancel();
    const saved = Object.keys(frames).map((key) => [
        key,
        el.style.getPropertyValue(key),
        el.style.getPropertyPriority(key),
    ]);
    if (reducedMotion()) {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            saved.forEach(([key, value, priority]) =>
                value ? el.style.setProperty(key, value, priority) : el.style.removeProperty(key),
            );
            if (running.get(el) === task) running.delete(el);
        };
        const task: Run = { cancel: finish, finish };
        running.set(el, task);
        Object.entries(frames).forEach(([key, values]) => el.style.setProperty(key, String(values[values.length - 1])));
        queueMicrotask(finish);
        return Promise.resolve(true);
    }
    const keyframes = Object.fromEntries(
        Object.entries(frames).map(([key, values]) => [
            key,
            previous ? [from[key], values[values.length - 1]] : values,
        ]),
    );
    return new Promise((resolve) => {
        const animation = animate(el, keyframes, {
            duration,
            delay,
            ease: EASE,
            ...(springy ? { type: spring, bounce: 0 } : {}),
        });
        let settled = false;
        const settle = (finished: boolean) => {
            if (settled) return;
            settled = true;
            animation.cancel();
            saved.forEach(([key, value, priority]) =>
                value ? el.style.setProperty(key, value, priority) : el.style.removeProperty(key),
            );
            if (running.get(el) === task) running.delete(el);
            active.delete(task);
            resolve(finished);
        };
        const task: Run = { cancel: () => settle(false), finish: () => settle(true) };
        running.set(el, task);
        active.add(task);
        void animation.then(() => settle(true));
    });
}
export function enter(el: HTMLElement) {
    return run(el, { opacity: [0, 1], transform: ['translateY(6px)', 'none'] }, TIMES.enter);
}
export function exit(el: HTMLElement) {
    const current = getComputedStyle(el);
    return run(
        el,
        { opacity: [current.opacity, 0], transform: [current.transform || 'none', current.transform || 'none'] },
        TIMES.exit,
    );
}
export function fade(el: HTMLElement) {
    return run(el, { opacity: [0, 1] }, TIMES.backdrop);
}
export function pop(el: HTMLElement) {
    return run(el, { opacity: [0, 1], transform: ['scale(.98)', 'none'] }, TIMES.pop);
}
export function staggerIn(els: Iterable<HTMLElement>) {
    const items = [...els];
    return Promise.all(
        items.map((el, i) =>
            run(
                el,
                { opacity: [0, 1], transform: ['translateY(6px)', 'none'] },
                TIMES.enter,
                staggerDelay(i, items.length),
            ),
        ),
    );
}
const swaps = new WeakMap<HTMLElement, { height: string }>();
export async function swap(el: HTMLElement, render: () => void, direction: -1 | 0 | 1 = 0) {
    if (!el.isConnected) return;
    const token = { height: swaps.get(el)?.height ?? el.style.minHeight };
    swaps.set(el, token);
    if (reducedMotion()) {
        running.get(el)?.cancel();
        render();
        el.style.minHeight = token.height;
        swaps.delete(el);
        return;
    }
    if (!(await run(el, { opacity: [1, 0] }, TIMES.out)) || swaps.get(el) !== token || !el.isConnected) return;
    el.style.minHeight = `${el.getBoundingClientRect().height}px`;
    render();
    await run(el, { opacity: [0, 1], transform: [`translateX(${direction * 8}px)`, 'none'] }, TIMES.swap);
    if (swaps.get(el) === token) {
        el.style.minHeight = token.height;
        swaps.delete(el);
    }
}
const collapses = new WeakMap<HTMLElement, { overflow: string }>();
export async function collapse(el: HTMLElement, open: boolean) {
    if (!el.isConnected) return;
    if (reducedMotion()) {
        running.get(el)?.cancel();
        el.hidden = !open;
        return;
    }
    const height = el.hidden ? 0 : el.getBoundingClientRect().height;
    el.hidden = false;
    const token = { overflow: collapses.get(el)?.overflow ?? el.style.overflow };
    collapses.set(el, token);
    el.style.overflow = 'hidden';
    const done = await run(el, { height: [`${height}px`, `${open ? el.scrollHeight : 0}px`] }, TIMES.collapse);
    if (done) el.hidden = !open;
    if (collapses.get(el) === token) {
        el.style.overflow = token.overflow;
        collapses.delete(el);
    }
}
export function slideIndicator(el: HTMLElement, rect: Pick<DOMRect, 'x' | 'y'>, commit: () => void = () => {}) {
    if (!el.isConnected) return Promise.resolve(false);
    const before = el.getBoundingClientRect();
    // Commit the selection's CSS class/layout before FLIP; this helper leaves no layout styles.
    commit();
    return run(el, { transform: [`translate(${before.x - rect.x}px, ${before.y - rect.y}px)`, 'none'] }, TIMES.indicator, 0, true);
}
const roots = new WeakSet<HTMLElement>();
/** Delegated once per overlay root, including controls inserted later. */
export function pressable(root: HTMLElement) {
    if (!root.isConnected || roots.has(root)) return;
    roots.add(root);
    let pressed: HTMLElement | null = null;
    const release = () => {
        if (!pressed) return;
        const el = pressed;
        pressed = null;
        el.classList.remove('opal-motion-pressed');
        void run(el, { transform: ['scale(.98)', 'none'] }, TIMES.press);
    };
    const start = (event: Event) => {
        if (event instanceof PointerEvent && (event.button !== 0 || !event.isPrimary)) return;
        const el = (event.target as Element).closest<HTMLElement>(
            'button, .opal-btn, .opal-btn-primary, [role="button"], .opal-row',
        );
        if (!el || !root.contains(el) || el.matches(':disabled') || reducedMotion()) return;
        release();
        pressed = el;
        el.classList.add('opal-motion-pressed');
        void run(el, { transform: ['none', 'scale(.98)'] }, TIMES.press);
    };
    root.addEventListener('pointerdown', start);
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    root.addEventListener('pointerleave', release);
    root.addEventListener('focusout', release);
    root.addEventListener('keydown', (e) => {
        if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) start(e);
    });
    root.addEventListener('keyup', (e) => {
        if (e.key === 'Enter' || e.key === ' ') release();
    });
}
export function openSurface(
    root: HTMLElement,
    selector = '.widget-settings-modal, .opal-cmd-panel, section, [role="dialog"]',
) {
    pressable(root);
    void fade(root);
    const panel = root.querySelector<HTMLElement>(selector);
    if (panel) void pop(panel);
}
const closing = new WeakSet<HTMLElement>();
export async function closeSurface(root: HTMLElement, after?: () => void) {
    if (closing.has(root)) return;
    closing.add(root);
    if (await exit(root)) {
        root.remove();
        after?.();
    }
}

/** Course section reorder: inverse layout offset, restored by the shared runner. */
export function reorder(el: HTMLElement, offset: number) {
    return run(el, { transform: [`translateY(${offset}px)`, 'none'] }, 0.14);
}
