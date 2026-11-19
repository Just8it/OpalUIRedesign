import { t } from '../../i18n/messages/course.ts';
import type { SeriesBlock, Unit } from '../home/types.ts';
import { esc, formatDate, ICON } from './format.ts';
import { homeButton as button, homeFiles, type HomeRenderState } from './home-shared.ts';

function unitFiles(unit: Unit, state: HomeRenderState): string {
    return homeFiles(unit.entries, state, 5, unit.key) + (unit.solutions.length ? `<div class="opal-course-home-solutions"><span>${t('categorySolutions')}</span>${homeFiles(unit.solutions, state, 5, `${unit.key}:solutions`)}</div>` : '');
}
function unitRow(unit: Unit, block: SeriesBlock, state: HomeRenderState, earlier: boolean): string {
    const open = state.expanded.has(unit.key);
    const label = unit.doneAt ? t('doneOn', { date: formatDate(unit.doneAt, false) }) : t('homeSkipped');
    return `<div class="opal-course-home-unit${earlier ? ' is-earlier' : ''}"><div class="opal-course-home-unit-head">${button('unit', `${unit.doneAt ? ICON.check : ''}<span>${esc(unit.title)}</span><small>${earlier ? label : t('fileCount', { count: unit.entries.length })}</small>${ICON.chevron}`, unit.key, `aria-expanded="${open}"`)}${button('pointer', t('homeContinueHere'), block.config.id, `data-unit="${esc(unit.key)}"`)}</div><div class="opal-course-home-unit-body"${open ? '' : ' hidden'}>${unitFiles(unit, state)}${unit.doneAt ? button('done', t('homeReopen'), block.config.id, `data-unit="${esc(unit.key)}"`) : ''}</div></div>`;
}
export function renderHomeSeries(block: SeriesBlock, state: HomeRenderState): string {
    const current = block.current;
    const now = current ? `<div class="opal-course-home-current"><p class="opal-course-home-label">${t('homeCurrent')}</p><h3>${esc(current.title)}</h3><p class="opal-course-home-location">${esc(current.location)}</p>${unitFiles(current, state)}<div class="opal-course-home-actions">${button('done', t('homeDone'), block.config.id, `data-unit="${esc(current.key)}"`, true)}${button('skip', t('homeSkip'), block.config.id, `data-unit="${esc(current.key)}"`)}</div></div>` : `<p class="opal-course-home-complete">${block.units.length ? `${ICON.check} ${t('homeAllDone')}` : t('homeNoFiles')}</p>${block.units.length ? button('restart', t('homeRestart'), block.config.id) : ''}`;
    const pastKey = `earlier:${block.config.id}`;
    return now + (block.next.length ? `<div class="opal-course-home-next"><p class="opal-course-home-label">${t('homeNext')}</p>${block.next.slice(0, 3).map(u => unitRow(u, block, state, false)).join('')}</div>` : '') + (block.earlier.length ? `<div class="opal-course-home-earlier">${button('expand', `${t('homeEarlier', { count: block.earlier.length })} ${ICON.chevron}`, pastKey, `aria-expanded="${state.expanded.has(pastKey)}"`)}<div${state.expanded.has(pastKey) ? '' : ' hidden'}>${block.earlier.map(u => unitRow(u, block, state, true)).join('')}</div></div>` : '');
}
