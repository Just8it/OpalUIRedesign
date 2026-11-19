import { readable } from '../course/render/list-row';
import { formatNumber } from '../i18n/core.ts';
import { t } from '../i18n/messages/search.ts';
/* Owns render rendering and helpers. */

import { collapse, swap } from '../motion';

import { type IndexNode, type SearchResult } from '../core/search-engine';
import { PROGRESS_DONE_VISIBLE_MS, describeProgress, type IndexProgress } from '../core/index-progress';

import { escapeAttr, escapeHtml, safeHref } from '../utils';

export function createResultRenderer(context: {
    readonly explainRanking: boolean;
    isSyntheticNode(node: IndexNode): boolean;
}) {
    const CLOCK_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

    function renderHistoryItems(hist: string[], divided: boolean): string {
        if (hist.length === 0) return '';
        return (
            `<div class="opal-cmd-section${divided ? ' opal-cmd-section-divided' : ''}">${t('recentQueries')}</div>` +
            hist
                .slice(0, 5)
                .map(
                    (q) => `
        <button type="button" class="opal-cmd-history-item opal-cmd-row" data-query="${escapeAttr(q)}">
            <span class="opal-cmd-icon">${CLOCK_ICON}</span>
            <span class="opal-cmd-title">${escapeHtml(q)}</span>
        </button>`,
                )
                .join('')
        );
    }

    const TYPE_ICON: Record<string, string> = {
        course: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
        file: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        folder: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
        action: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    };

    const TYPE_LABEL = {
        course: 'resultCourse',
        file: 'resultFile',
        folder: 'resultFolder',
        action: 'resultAction',
    } as const;

    function fold(text: string): string {
        let out = '';
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === 'ß') {
                out += 's';
                continue;
            }
            const lower = (ch.normalize('NFD')[0] ?? ch).toLowerCase();
            out += lower.length === 1 ? lower : ch;
        }
        return out;
    }

    function highlightTokens(query: string): string[] {
        const q = query.trim().replace(/^\/[cf]\s+/, '');
        return q
            .split(/\s+/)
            .map((t) => t.replace(/^(?:ext|type):/i, ''))
            .filter((t) => t.length >= 2 || /^\d+$/.test(t))
            .map(fold);
    }

    function tokenVariants(token: string): string[] {
        const plain = token.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/ss/g, 's');
        return plain !== token ? [token, plain] : [token];
    }

    function highlightTitle(title: string, tokens: string[]): string {
        if (tokens.length === 0) return escapeHtml(title);
        const hay = fold(title);
        const ranges: [number, number][] = [];
        for (const token of tokens) {
            for (const v of tokenVariants(token)) {
                let at = hay.indexOf(v);
                while (v && at !== -1) {
                    ranges.push([at, at + v.length]);
                    at = hay.indexOf(v, at + v.length);
                }
            }
        }
        if (ranges.length === 0) return escapeHtml(title);
        ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
        let html = '';
        let pos = 0;
        for (const [start, end] of ranges) {
            if (end <= pos) continue;
            const from = Math.max(start, pos);
            html += escapeHtml(title.slice(pos, from)) + `<mark>${escapeHtml(title.slice(from, end))}</mark>`;
            pos = end;
        }
        return html + escapeHtml(title.slice(pos));
    }

    function secondLine(r: SearchResult): string {
        const n = r.node;
        if (n.type === 'action') return n.description || t(TYPE_LABEL.action);
        const path = Array.isArray(r.path) ? r.path.filter(Boolean) : [];
        if (path.length > 0) return path.join(' › ');
        const label = TYPE_LABEL[n.type];
        return [label ? t(label) : n.type, n.semester].filter(Boolean).join(' · ');
    }

    function renderRow(r: SearchResult, i: number, selectedIdx: number, courseId: string, tokens: string[]): string {
        const n = r.node;
        const isSelected = i === selectedIdx;
        const meta =
            n.type === 'file' && n.fileExtension
                ? n.fileExtension.toUpperCase()
                : courseId && n.courseId === courseId && n.type !== 'action'
                  ? t('resultCurrentCourse')
                  : '';
        const href = safeHref(n.url);
        return `<div id="opal-cmd-option-${i}" role="option" aria-selected="${isSelected}" class="opal-cmd-result opal-cmd-row${isSelected ? ' is-selected' : ''}" data-url="${href}" data-idx="${i}">
          <a class="opal-cmd-link" href="${href}">
          <span class="opal-cmd-icon">${TYPE_ICON[n.type] ?? TYPE_ICON.action}</span>
          <span class="opal-cmd-text">
            <span class="opal-cmd-title">${highlightTitle(readable(n.title, n.title), tokens)}</span>
            <span class="opal-cmd-path">${escapeHtml(secondLine(r))}</span>
            ${context.explainRanking && !context.isSyntheticNode(n) ? `<span class="opal-cmd-explanation">${t('resultScore', { score: formatNumber(r.score, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) })}<br>${r.explanation.map(escapeHtml).join('<br>')}</span>` : ''}
          </span>
          </a>
          ${n.type === 'file' && n.parentId ? `<button type="button" class="opal-btn opal-cmd-folder" data-folder="true" aria-label="${t('resultOpenParent')}">${t('resultFolder')}</button>` : ''}
          ${meta ? `<span class="opal-cmd-meta">${escapeHtml(meta)}</span>` : ''}
        </div>`;
    }

    function renderCmdResults(
        results: SearchResult[],
        courseId: string,
        selectedIdx: number,
        tokens: string[],
    ): string {
        if (results.length === 0) {
            return `<div class="opal-cmd-empty opal-empty"><p class="opal-empty-title">${t('resultEmpty')}</p><p class="opal-empty-hint">${t('resultEmptyHint')}</p></div>`;
        }
        return results.map((r, i) => renderRow(r, i, selectedIdx, courseId, tokens)).join('');
    }

    function renderHome(recents: SearchResult[], hist: string[], courseId: string, selectedIdx: number): string {
        let html = '';
        if (recents.length > 0) {
            html += `<div class="opal-cmd-section">${t('recentOpened')}</div>`;
            html += recents.map((r, i) => renderRow(r, i, selectedIdx, courseId, [])).join('');
        }
        return html + renderHistoryItems(hist, recents.length > 0);
    }

    function renderDrillView(
        drillTitle: string,
        results: SearchResult[],
        selectedIdx: number,
        fileCount: number,
    ): string {
        const header = `
        <div class="opal-cmd-drill-head">
          <span class="opal-cmd-title">${escapeHtml(drillTitle)}</span>
          <span class="opal-cmd-hint"><kbd class="opal-kbd">Esc</kbd> ${t('drillClose')}</span>
        </div>`;

        if (results.length === 0) {
            return (
                header +
                `<div class="opal-cmd-empty opal-empty"><p class="opal-empty-title">${t('drillEmpty')}</p><p class="opal-empty-hint">${t('drillEmptyHint')}</p></div>`
            );
        }

        let html = header;
        const folderStart = fileCount;

        if (fileCount > 0) {
            html += `<div class="opal-cmd-section">${t('drillFiles')}</div>`;
        }

        results.forEach((r, i) => {
            if (i === folderStart) html += `<div class="opal-cmd-section">${t('drillFolders')}</div>`;
            html += renderRow(r, i, selectedIdx, '', []);
        });

        return html;
    }

    function renderProgress(el: HTMLElement, p: IndexProgress | null, now: number): void {
        const visible =
            !!p && (p.status === 'running' || (p.status === 'done' && now - p.updatedAt < PROGRESS_DONE_VISIBLE_MS));
        if (!p || !visible) {
            if (!el.hidden) void collapse(el, false);
            return;
        }
        const total = p.status === 'done' ? Math.max(1, p.totalCourses) : p.totalCourses;
        const done = p.status === 'done' ? total : Math.min(p.completedCourses, total);
        const determinate = total > 0;
        const pct = determinate ? Math.round((done / total) * 100) : 0;
        const text = describeProgress(p);
        const wasHidden = el.hidden;
        if (!el.firstElementChild) {
            el.innerHTML =
                '<div class="opal-cmd-progress-track" role="progressbar"><div class="opal-cmd-progress-fill"></div></div><p class="opal-cmd-progress-text"></p>';
        }
        const track = el.firstElementChild as HTMLElement;
        const fill = track.firstElementChild as HTMLElement;
        track.setAttribute('aria-label', t('progressLabel'));
        track.setAttribute('aria-valuetext', text);
        for (const [key, value] of Object.entries(
            determinate ? { 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) } : {},
        ))
            track.setAttribute(key, value);
        if (!determinate)
            ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].forEach((key) => track.removeAttribute(key));
        fill.classList.toggle('is-indeterminate', !determinate);
        fill.style.width = determinate ? `${pct}%` : '';
        const line = el.lastElementChild as HTMLElement;
        if (p.status === 'done' && line.dataset.status !== 'done' && !wasHidden)
            void swap(line, () => {
                line.textContent = text;
            });
        else line.textContent = text;
        line.dataset.status = p.status;
        if (wasHidden) void collapse(el, true);
    }
    return { highlightTokens, renderCmdResults, renderHome, renderDrillView, renderProgress };
}
