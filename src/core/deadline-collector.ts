import { store } from '../storage/store.ts';
import { keys } from '../storage/registry.ts';
import { storageAvailable } from '../storage/backend.ts';
/* ━━ Deadline collector ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Called by the indexers for every OPAL page they see (the page the
 * user is on, and pages the crawler fetches). Finds hand-in dates and
 * stores them for the deadline widget.
 * The signature is a fixed contract between indexer and widget code.
 *
 * Text comes from the main content only: navigation, scripts and
 * hidden elements are skipped. Detection is text based (see
 * deadline-parser.ts) because no real OPAL task page was available to
 * derive selectors from.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { hasDateLikeText, parseDeadlines, MAX_SCAN_CHARS, type FoundDeadline } from './deadline-parser.ts';
import {
    deadlineId,
    queuePageDeadlines,
    type ScrapedDeadline,
} from './deadline-store.ts';

export interface DeadlinePageContext {
    /** Root course id, e.g. /opal/auth/RepositoryEntry/123 */
    courseId: string;
    courseTitle?: string;
    /** Absolute or site-relative url of the page the document came from. */
    pageUrl: string;
    pageTitle: string;
}

const OPAL_ORIGIN = 'https://bildungsportal.sachsen.de';
const MAX_NODES = 20_000;
const OWN_UI = '[id^="opal-"]';

const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OBJECT', 'CANVAS',
    'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'BUTTON', 'SELECT', 'OPTION', 'TEXTAREA', 'INPUT',
]);
const BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'UL', 'OL', 'TR', 'TD', 'TH', 'TABLE', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'SECTION', 'ARTICLE', 'DD', 'DT', 'DL', 'BLOCKQUOTE', 'PRE', 'HR', 'FIELDSET', 'LEGEND', 'CAPTION',
]);
/* Navigation and chrome classes seen in OPAL's markup (course menu, header, footer). */
const SKIP_CLASSES = ['menu', 'nav-container', 'breadcrumb', 'page-header-container', 'page-footer', 'dropdown-menu', 'sr-only'];
const SKIP_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'menu', 'menubar', 'tree', 'dialog', 'tooltip']);

/* ── Setting cache ─────────────────────────────────────────── */

let enabled: boolean | null = null;

function initEnabled(): void {
    if (enabled !== null || !storageAvailable()) return;
    enabled = true; // optimistic until storage answers; the flush checks again
    store.get(keys.deadlines)
        .then(value => { enabled = value; })
        .catch(() => {});
    store.watch(keys.deadlines, value => { enabled = value; });
}

/* ── Text extraction ───────────────────────────────────────── */

function isSkipped(el: Element): boolean {
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
    const role = el.getAttribute('role');
    if (role && SKIP_ROLES.has(role)) return true;
    const style = el.getAttribute('style');
    if (style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
    if (el.id.startsWith('opal-')) return true; // the extension's own overlays
    const cls = el.classList;
    return SKIP_CLASSES.some(c => cls.contains(c));
}

/** Visible-ish text of the main content, blocks separated by newlines, capped. */
export function extractMainText(doc: Document): string {
    const candidates = Array.from(doc.querySelectorAll('main, [role="main"], .content-container, #content'));
    const root = candidates.find(c => !c.closest(OWN_UI)) ?? doc.body;
    if (!root) return '';
    const parts: string[] = [];
    let length = 0;
    let visited = 0;
    const stack: (Node | string)[] = [root];
    while (stack.length > 0 && length < MAX_SCAN_CHARS && visited < MAX_NODES) {
        const node = stack.pop() as Node | string;
        visited++;
        if (typeof node === 'string') { parts.push(node); length += 1; continue; }
        if (node.nodeType === 3) {
            const t = node.nodeValue ?? '';
            if (t.trim()) { parts.push(t); length += t.length; }
            continue;
        }
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        if (el !== root && isSkipped(el)) continue;
        const block = BLOCK_TAGS.has(el.tagName.toUpperCase());
        if (block) stack.push('\n');
        const children = el.childNodes;
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        if (block) parts.push('\n');
    }
    return parts.join('').replace(/[^\S\n]+/g, ' ').replace(/\s*\n\s*/g, '\n').slice(0, MAX_SCAN_CHARS);
}

/* ── Entry building ────────────────────────────────────────── */

function normalizePageUrl(pageUrl: string): string | null {
    try {
        const url = new URL(pageUrl, OPAL_ORIGIN);
        if (url.origin !== OPAL_ORIGIN || !url.pathname.startsWith('/opal/')) return null;
        url.hash = '';
        return url.href;
    } catch {
        return null;
    }
}

/** "OPAL - Übungsblatt 3" and similar: drop the site name, keep the page name. */
function cleanTitle(raw: string): string {
    const t = raw.replace(/\s+/g, ' ').trim()
        .replace(/^OPAL\s*[-|:–]\s*/i, '')
        .replace(/\s*[-|:–]\s*OPAL$/i, '')
        .trim();
    return t.length > 140 ? t.slice(0, 139).trimEnd() + '…' : t;
}

function localDayKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toScrapedDeadlines(found: FoundDeadline[], ctx: DeadlinePageContext, pageUrl: string, now: Date): ScrapedDeadline[] {
    const title = cleanTitle(ctx.pageTitle || '') || cleanTitle(ctx.courseTitle || '');
    const courseTitle = ctx.courseTitle ? cleanTitle(ctx.courseTitle) : '';
    return found.map(f => {
        const entry: ScrapedDeadline = {
            id: deadlineId(pageUrl, localDayKey(f.due), f.kind),
            title,
            courseId: ctx.courseId || '',
            pageUrl,
            due: f.due.toISOString(),
            kind: f.kind,
            foundAt: now.toISOString(),
        };
        if (f.sentence) entry.description = f.sentence;
        if (courseTitle && courseTitle !== title) entry.courseTitle = courseTitle;
        return entry;
    });
}

/* ── Public entry point ────────────────────────────────────── */

/**
 * Must never throw and must return quickly: it runs inside crawl loops.
 * Storage writes are the implementation's business (batched, async).
 */
export function collectDeadlinesFromDoc(doc: Document, ctx: DeadlinePageContext): void {
    try {
        initEnabled();
        if (enabled === false || !doc || !ctx) return;
        const pageUrl = normalizePageUrl(ctx.pageUrl);
        if (!pageUrl) return;
        // Cheap bail-out before walking the tree.
        const quick = (doc.body?.textContent ?? '').slice(0, MAX_SCAN_CHARS * 4);
        if (!hasDateLikeText(quick)) { queuePageDeadlines(pageUrl, []); return; }
        const now = new Date();
        const found = parseDeadlines(extractMainText(doc), now);
        queuePageDeadlines(pageUrl, toScrapedDeadlines(found, ctx, pageUrl, now));
    } catch (err) {
        console.warn('[OPAL] Deadline collector failed:', err);
    }
}
