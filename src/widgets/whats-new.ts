import { t } from '../i18n/messages/widgets.ts';
import { openSurface, closeSurface } from '../motion';
import type { Widget } from '../types.ts';
import { escapeHtml, safeHref } from '../utils';
import { bindDialogKeyboard, dialogHeader, dialogFooter } from '../settings';
import { groupNewFiles, relativeTime, isStableNewFileUrl } from './whats-new-helpers';
import { newFiles, newFilesError, pending, loaded, hasFileIndex, refreshNewFiles, whatsNewSettings, saveWhatsNewSettings } from './whats-new-store';
import { newsIcon } from './neuigkeiten';
let onRefresh = () => {};
export function initWhatsNew(refresh: () => void): void {
    onRefresh = refresh;
    document.addEventListener('click', event => {
        if (!(event.target as Element).closest('[data-whats-new-retry]')) return;
        refreshNewFiles(onRefresh, true); onRefresh();
    });
}
export const whatsNewWidget: Widget<typeof newFiles> = {
    id: 'whats-new', get title() { return t('whatsNewTitle'); }, opalPortletOrder: '',
    icon: newsIcon, defaultW: 4, defaultH: 4, hasNativeConfig: false, hasSettings: true,
    scrape() { refreshNewFiles(onRefresh); return newFiles; },
    render(items) {
        if (pending || !loaded) return `<div class="opal-empty"><p class="opal-empty-title" role="status">${t('whatsNewLoading')}</p></div>`;
        if (newFilesError) return `<div class="opal-empty"><p class="opal-empty-title">${t('whatsNewError')}</p><button type="button" class="opal-btn" data-whats-new-retry>${t('sharedRetry')}</button></div>`;
        if (!hasFileIndex) return `<div class="opal-empty"><p class="opal-empty-title">${t('whatsNewNoIndex')}</p><p class="opal-empty-hint">${t('whatsNewNoIndexHint')}</p></div>`;
        if (!items.length) return `<div class="opal-empty"><p class="opal-empty-title">${t('whatsNewEmpty', { count: whatsNewSettings.days })}</p></div>`;
        return [...groupNewFiles(items)].map(([course, files]) => `<h4 class="opal-section-title">${escapeHtml(course)}</h4>${files.map(file => {
            const href = items.find(i => i.node.id === file.node.id)?.href || file.node.url;
            return `<a class="opal-row" href="${safeHref(href)}"${isStableNewFileUrl(file.node.url) ? ' target="_blank" rel="noopener"' : ''}><span><span class="opal-row-title">${escapeHtml(file.node.title)}</span><span class="opal-row-meta block">${escapeHtml(file.path.slice(1).join(' / '))}</span><span class="opal-caption">${escapeHtml(relativeTime(file.node.firstSeenAt ?? Date.now()))} · ${escapeHtml(file.node.fileExtension || t('whatsNewFile'))}</span></span></a>`;
        }).join('')}`).join('');
    },
};
export function openWhatsNewSettings(refresh: () => void): void {
    document.getElementById('opal-settings-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'opal-settings-modal'; overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="widget-settings-modal" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
        ${dialogHeader('whats-new-title', t('whatsNewTitle'))}
        <div class="settings-modal-body">
          <div class="settings-field">
            <label class="settings-field-label" for="whats-new-days">${t('whatsNewPeriod')}</label>
            <div class="settings-input-wrap">
              <select id="whats-new-days" class="settings-select-input">${[3, 7, 14, 30].map(n => `<option value="${n}" ${n === whatsNewSettings.days ? 'selected' : ''}>${t('whatsNewDays', { count: n })}</option>`).join('')}</select>
              <svg class="settings-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            </div>
          </div>
          <div class="settings-field">
            <label class="settings-field-label" for="whats-new-limit">${t('whatsNewLimit')}</label>
            <input class="settings-number-input" id="whats-new-limit" type="number" min="1" max="100" value="${whatsNewSettings.limit}" aria-describedby="whats-new-limit-hint">
            <p class="opal-caption mt-1.5" id="whats-new-limit-hint">${t('whatsNewLimitHint')}</p>
          </div>
        </div>
        ${dialogFooter()}
      </div>`;
    document.body.append(overlay);
    openSurface(overlay);
    const release = bindDialogKeyboard(overlay, () => close());
    function close() { void closeSurface(overlay, release); }
    overlay.querySelectorAll('.widget-settings-close').forEach(btn => btn.addEventListener('click', close));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.widget-settings-save')?.addEventListener('click', () => {
        const days = Number(overlay.querySelector<HTMLSelectElement>('select')?.value);
        const input = overlay.querySelector<HTMLInputElement>('input[type="number"]');
        if (!input?.reportValidity()) return;
        void saveWhatsNewSettings(days, Number(input.value)).then(() => { close(); refresh(); });
    });
}
