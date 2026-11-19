import { t } from '../../i18n/messages/course.ts';
import type { HomeModel } from '../home/types.ts';
import { esc } from './format.ts';
import { homeButton as button, type HomeRenderState } from './home-shared.ts';
import { blockMeta, colorMark, renderHomeEditor } from './home-edit.ts';
import { renderHomeSeries } from './home-series.ts';
import { renderHomeList, renderHomeAnnouncements } from './home-list.ts';
import { renderHomePage } from './page-doc.ts';
export function renderHome(model: HomeModel, state: HomeRenderState): string {
    if (state.editing) return renderHomeEditor(model, state);
    const body = (block: HomeModel['blocks'][number]) => block.kind === 'series' ? renderHomeSeries(block, state) : block.kind === 'list' ? renderHomeList(block, state) : block.kind === 'page' ? renderHomePage(block) : renderHomeAnnouncements(block, state);
    // A page block has its own "Ganze Seite" under the preview, so its header carries no second link.
    const browse = (block: HomeModel['blocks'][number]) => block.kind === 'page' ? '' : button('browse', t('homeShowAll'), block.config.id, `aria-label="${esc(t('homeShowAllNamed', { title: block.config.title }))}"`);
    const blocks = model.blocks.map(block => `<section class="opal-course-home-block" data-block="${esc(block.config.id)}" data-kind="${block.kind}" aria-label="${esc(block.config.title)}"><header>${colorMark(block.config.color)}<h2>${esc(block.config.title)}</h2><span class="opal-course-home-count">${esc(blockMeta(block))}</span>${browse(block)}</header>${body(block)}</section>`).join('');
    return `<div class="opal-course-home-grid">${blocks}</div>`;
}
export function renderHomeSkeleton(titles = [t('categoryLecture'), t('categoryExercise'), t('categoryExam'), t('announcements')]): string {
    return `<div class="opal-course-home-grid" aria-label="${t('homeLoading')}">${titles.map(title => `<section class="opal-course-home-block" aria-busy="true"><header><h2>${esc(title)}</h2></header><div class="opal-course-home-loading"><span class="opal-course-skel" style="width:65%"></span><span class="opal-course-skel" style="width:90%"></span><span class="opal-course-skel" style="width:75%"></span></div></section>`).join('')}</div>`;
}
