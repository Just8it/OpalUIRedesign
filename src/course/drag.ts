/* ━━ Course view: drag to reorder ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * A row is picked up by its grip (mouse, pen or touch), follows the
 * pointer, and the rows it passes slide aside to show where it will
 * land. Release commits, Escape or a cancelled pointer puts it back.
 *
 * Positions are "units": usually one row, but a sidebar group header
 * and its nested sections move aside together as one unit. The
 * dragged unit is always the single row under the grip.
 *
 * The grip is a real button. Focused, ArrowUp / ArrowDown move the
 * row one place, so nothing here needs a pointer.
 *
 * Nothing is stored here: onDrop gets the from/to unit index and the
 * rows' on-screen tops at release, so the caller can re-render and
 * let every row settle from where the eye last saw it.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { reducedMotion } from '../motion';

export interface SortableOptions {
    /** Where pointer and key events are listened for (delegated). */
    root: HTMLElement;
    /** Selector of the grip button inside a row. */
    grip: string;
    /** The row a grip moves. */
    row: (grip: HTMLElement) => HTMLElement | null;
    /** The units the row moves among, in order; the row's own unit is [row]. */
    units: (row: HTMLElement) => HTMLElement[][];
    /** The element that scrolls while dragging near its edge. */
    scroller: (row: HTMLElement) => HTMLElement;
    onDrop: (row: HTMLElement, from: number, to: number, tops: Map<HTMLElement, number>) => void;
    /** Keyboard: one place up (-1) or down (+1). */
    onStep: (row: HTMLElement, delta: -1 | 1) => void;
}

const THRESHOLD = 4;
const EDGE = 48;

export function sortable(o: SortableOptions): () => void {
    let drag: {
        row: HTMLElement; grip: HTMLElement; pointer: number; startY: number; y: number;
        units: HTMLElement[][]; from: number; to: number; mids: number[]; span: number;
        scroller: HTMLElement; startScroll: number; started: boolean; frame: number;
    } | null = null;

    const els = () => drag ? drag.units.flat() : [];
    const offset = () => drag ? drag.y - drag.startY + drag.scroller.scrollTop - drag.startScroll : 0;

    function layout() {
        if (!drag) return;
        const dy = offset();
        drag.row.style.transform = `translateY(${dy}px)`;
        // The slot is the number of other units whose middle the dragged row's centre has passed.
        const centre = drag.mids[drag.from] + dy;
        let to = 0;
        for (let i = 0; i < drag.units.length; i++) if (i !== drag.from && drag.mids[i] < centre) to++;
        drag.to = to;
        const { from, span } = drag;
        drag.units.forEach((unit, i) => {
            if (i === from) return;
            const shift = from < to && i > from && i <= to ? -span : to < from && i >= to && i < from ? span : 0;
            for (const el of unit) el.style.transform = shift ? `translateY(${shift}px)` : '';
        });
    }

    function autoscroll() {
        if (!drag) return;
        drag.frame = 0;
        const box = drag.scroller.getBoundingClientRect();
        const top = Math.max(box.top, 0), bottom = Math.min(box.bottom, window.innerHeight);
        const speed = drag.y < top + EDGE ? -(top + EDGE - drag.y) : drag.y > bottom - EDGE ? drag.y - (bottom - EDGE) : 0;
        if (speed) {
            const before = drag.scroller.scrollTop;
            drag.scroller.scrollTop += Math.round(speed / 3);
            if (drag.scroller.scrollTop !== before) layout();
            drag.frame = requestAnimationFrame(autoscroll);
        }
    }

    function begin() {
        if (!drag) return;
        drag.started = true;
        const tops = drag.units.map(u => u[0].getBoundingClientRect().top);
        drag.mids = drag.units.map((u, i) => {
            const last = u[u.length - 1].getBoundingClientRect();
            return (tops[i] + last.bottom) / 2;
        });
        const rect = drag.row.getBoundingClientRect();
        const next = drag.units[drag.from + 1]?.[0] ?? null, prev = drag.units[drag.from - 1];
        // Distance to the neighbouring unit includes the gap between rows.
        drag.span = next ? next.getBoundingClientRect().top - rect.top : prev ? rect.bottom - prev[prev.length - 1].getBoundingClientRect().bottom : rect.height;
        o.root.classList.add('is-sorting');
        drag.row.classList.add('is-dragging');
        for (const el of els()) if (el !== drag.row) el.classList.add('is-shifting');
        if (reducedMotion()) o.root.classList.add('is-sorting-instant');
    }

    function finish(commit: boolean) {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (d.frame) cancelAnimationFrame(d.frame);
        try { d.grip.releasePointerCapture(d.pointer); } catch { /* already released */ }
        window.removeEventListener('keydown', onEscape, true);
        if (!d.started) return;
        const tops = new Map<HTMLElement, number>();
        for (const el of d.units.flat()) tops.set(el, el.getBoundingClientRect().top);
        for (const el of d.units.flat()) { el.style.transform = ''; el.classList.remove('is-shifting', 'is-dragging'); }
        o.root.classList.remove('is-sorting', 'is-sorting-instant');
        // A drag ends with a click on the grip; swallow it.
        const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
        d.grip.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => d.grip.removeEventListener('click', swallow, { capture: true }), 0);
        if (commit && d.to !== d.from) o.onDrop(d.row, d.from, d.to, tops);
    }

    const onEscape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !drag) return;
        e.preventDefault(); e.stopPropagation();
        finish(false);
    };

    const onDown = (e: PointerEvent) => {
        const grip = (e.target as Element | null)?.closest<HTMLElement>(o.grip);
        if (!grip || !o.root.contains(grip) || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const row = o.row(grip);
        if (!row) return;
        const units = o.units(row);
        const from = units.findIndex(u => u.includes(row));
        if (from < 0 || units.length < 2) return;
        e.preventDefault();
        const scroller = o.scroller(row);
        drag = { row, grip, pointer: e.pointerId, startY: e.clientY, y: e.clientY, units, from, to: from, mids: [], span: 0, scroller, startScroll: scroller.scrollTop, started: false, frame: 0 };
        grip.setPointerCapture(e.pointerId);
        window.addEventListener('keydown', onEscape, true);
    };
    const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointer) return;
        drag.y = e.clientY;
        if (!drag.started) {
            if (Math.abs(drag.y - drag.startY) < THRESHOLD) return;
            begin();
        }
        e.preventDefault();
        layout();
        if (!drag.frame) drag.frame = requestAnimationFrame(autoscroll);
    };
    const onUp = (e: PointerEvent) => { if (drag && e.pointerId === drag.pointer) finish(true); };
    const onCancel = (e: PointerEvent) => { if (drag && e.pointerId === drag.pointer) finish(false); };
    const onKey = (e: KeyboardEvent) => {
        const grip = (e.target as Element | null)?.closest<HTMLElement>(o.grip);
        if (!grip || drag || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        const row = o.row(grip);
        if (!row) return;
        e.preventDefault(); e.stopPropagation();
        o.onStep(row, e.key === 'ArrowUp' ? -1 : 1);
    };

    o.root.addEventListener('pointerdown', onDown);
    o.root.addEventListener('pointermove', onMove);
    o.root.addEventListener('pointerup', onUp);
    o.root.addEventListener('pointercancel', onCancel);
    o.root.addEventListener('keydown', onKey);
    return () => {
        finish(false);
        o.root.removeEventListener('pointerdown', onDown);
        o.root.removeEventListener('pointermove', onMove);
        o.root.removeEventListener('pointerup', onUp);
        o.root.removeEventListener('pointercancel', onCancel);
        o.root.removeEventListener('keydown', onKey);
    };
}
