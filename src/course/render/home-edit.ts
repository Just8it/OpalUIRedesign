/* ━━ Course view: arranging the overview ━━━━━━━━━━━━━━━━━━━━━━━━
 * While customising, the overview turns into one list of its blocks,
 * like a settings list: each row says what the block is and offers
 * three things: a grip to drag it (or arrow keys on the focused grip,
 * see ../drag.ts), an eye to hide it, and "…" for its options (name,
 * colour, progress tracking, removal). The icon buttons carry their
 * action as aria-label and tooltip, like the sidebar's eye.
 * Every control keeps its data-home action, so view.ts handles them
 * exactly as before.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
import { t } from '../../i18n/messages/course.ts';
import type { BlockConfig, HomeBlock, HomeModel } from '../home/types.ts';
import { COURSE_GRADIENTS } from '../../course-matcher.ts';
import { esc, ICON } from './format.ts';
import { homeButton as button, type HomeRenderState } from './home-shared.ts';

export function colorMark(color: number): string {
    return `<span class="opal-course-home-mark" style="background:${COURSE_GRADIENTS[color % 8][0]}" aria-hidden="true"></span>`;
}

/** What a block holds, in one muted phrase: "6 Einheiten", "3 Dateien". */
export function blockMeta(block: HomeBlock | undefined): string {
    if (!block) return '';
    if (block.kind === 'series') return block.progressText;
    if (block.kind === 'announcements') return t('announcementCount', { count: block.total });
    if (block.kind === 'page') return block.total ? t('pageWithFiles', { files: t('fileCount', { count: block.total }) }) : t('page');
    return t('fileCount', { count: block.total });
}

/** Id of the visually hidden instruction every grip points to (rendered once in the page shell). */
export const GRIP_HINT_ID = 'opal-course-grip-hint';
/** The drag handle: a real button, so it takes focus and arrow keys. `label` must already be escaped. */
export function gripButton(id: string, label: string): string {
    return `<button type="button" class="opal-course-grip" data-grip data-id="${esc(id)}" data-fk="grip:${esc(id)}" aria-label="${label}" aria-describedby="${GRIP_HINT_ID}" title="${t('gripTitle')}">${ICON.grip}</button>`;
}

/** A real button for the options of a block: the shared one, small. */
const smallButton = (action: string, label: string, id: string, danger = false) =>
    `<button type="button" class="opal-btn opal-btn-sm${danger ? ' opal-btn-danger' : ''}" data-home="${action}" data-id="${esc(id)}" data-fk="home:${action}:${esc(id)}">${label}</button>`;

const removable =(id: string) => id.startsWith('custom:') || id.startsWith('sec:') || id.startsWith('folder:') || id.startsWith('page:');
const trackable = (config: BlockConfig) => !['announcements', 'pinned', 'page'].includes(config.source.type);

/** One row of the arrange list. `pos` is the place among the visible blocks. */
export function renderHomeEdit(config: BlockConfig, state: HomeRenderState, meta = '', pos: { index: number; total: number } = { index: -1, total: 0 }): string {
    const id = config.id, title = esc(config.title), optsKey = `opts:${id}`, open = state.expanded.has(optsKey);
    const name = state.rename === id
        ? `<input class="opal-course-home-rename" data-home-rename="${esc(id)}" data-fk="rename:${esc(id)}" aria-label="${t('homeBlockName')}" value="${title}">`
        : `<span class="opal-course-home-ename">${title}</span>`;
    // Hidden blocks have no place to move to; their slot keeps the row aligned.
    const grip = config.hidden || pos.total < 2
        ? '<span class="opal-course-grip is-placeholder" aria-hidden="true"></span>'
        : gripButton(id, esc(t('moveNamedPosition', { title: config.title, position: pos.index + 1, total: pos.total })));
    const colors = `<div role="radiogroup" aria-label="${esc(t('homeColorOf', { title: config.title }))}" class="opal-course-home-colors">${COURSE_GRADIENTS.map((_, i) => button('color', colorMark(i), id, `role="radio" aria-checked="${i === config.color}" aria-label="${t('homeColorNumber', { number: i + 1 })}" data-color="${i}"`)).join('')}</div>`;
    const options = `<div class="opal-course-home-eopts" id="opal-home-opts-${esc(id)}"${open ? '' : ' hidden'}>
        <div class="opal-course-home-eopt"><span class="opal-course-home-elabel">${t('columnName')}</span>${smallButton('rename', t('homeRename'), id)}</div>
        <div class="opal-course-home-eopt"><span class="opal-course-home-elabel">${t('homeColor')}</span>${colors}</div>
        ${trackable(config) ? `<div class="opal-course-home-eopt"><span class="opal-course-home-elabel" id="opal-home-series-l-${esc(id)}">${t('homeProgress')}</span><label class="opal-switch opal-switch-sm"><input type="checkbox" role="switch" id="opal-home-series-${esc(id)}" data-home="series" data-id="${esc(id)}" data-fk="home:series:${esc(id)}" aria-labelledby="opal-home-series-t-${esc(id)}"${config.series ? ' checked' : ''}><span class="opal-switch-track" aria-hidden="true"></span><span class="opal-switch-thumb" aria-hidden="true"></span></label><label class="opal-course-home-etext" id="opal-home-series-t-${esc(id)}" for="opal-home-series-${esc(id)}">${t('homeTrackSeries')}</label></div>` : ''}
        ${removable(id) ? `<div class="opal-course-home-eopt"><span class="opal-course-home-elabel" aria-hidden="true"></span>${smallButton('remove', t('homeRemoveBlock'), id, true)}</div>` : ''}
      </div>`;
    return `<li class="opal-course-home-erow${config.hidden ? ' is-hidden' : ''}${open ? ' is-open' : ''}" data-block="${esc(id)}">
      <div class="opal-course-home-erow-main">${grip}${colorMark(config.color)}${name}<span class="opal-course-home-emeta">${esc(meta)}</span>
        <span class="opal-course-home-etools">${button('hide', config.hidden ? ICON.eyeOff : ICON.eye, id, `aria-label="${esc(t(config.hidden ? 'showNamed' : 'hideNamed', { title: config.title }))}" title="${config.hidden ? t('show') : t('hide')}"`)}${button('expand', ICON.more, optsKey, `aria-expanded="${open}" aria-controls="opal-home-opts-${esc(id)}" aria-label="${esc(t('homeOptionsFor', { title: config.title }))}" title="${t('homeOptions')}"`)}</span>
      </div>${options}
    </li>`;
}

/** The whole arrange view: visible blocks in order, hidden ones, and what can be added. */
export function renderHomeEditor(model: HomeModel, state: HomeRenderState): string {
    const shown = model.blocks.map((b, index) => renderHomeEdit(b.config, state, blockMeta(b), { index, total: model.blocks.length })).join('');
    const hidden = model.hidden.map(c => renderHomeEdit(c, state, t('homeHidden'))).join('');
    const addList = state.adding
        ? `<ul class="opal-course-home-elist is-add">${model.addable.map(s => `<li class="opal-course-home-erow"><div class="opal-course-home-erow-main"><span class="opal-course-home-ename">${esc(s.displayTitle ?? s.title)}</span><span class="opal-course-home-emeta">${t('fileCount', { count: s.count })}</span><span class="opal-course-home-etools">${button('add', ICON.plus, s.id, `aria-label="${esc(t('homeAddNamed', { title: s.displayTitle ?? s.title }))}" title="${t('homeAdd')}"`)}</span></div></li>`).join('') || `<li class="opal-course-home-eempty">${t('homeAllAreasUsed')}</li>`}</ul>`
        : '';
    return `<div class="opal-course-home-editor">
      <section class="opal-course-home-eset" aria-labelledby="opal-home-e-shown">
        <h2 id="opal-home-e-shown">${t('homeShown')}</h2>
        <p class="opal-course-home-ehint">${t('homeReorderHint')}</p>
        ${shown ? `<ol class="opal-course-home-elist">${shown}</ol>` : `<p class="opal-course-home-eempty">${t('homeNoVisibleBlocks')}</p>`}
      </section>
      ${hidden ? `<section class="opal-course-home-eset" aria-labelledby="opal-home-e-hidden"><h2 id="opal-home-e-hidden">${t('homeHidden')}</h2><ul class="opal-course-home-elist">${hidden}</ul></section>` : ''}
      <section class="opal-course-home-eset" aria-labelledby="opal-home-e-add">
        <h2 id="opal-home-e-add">${t('homeMoreBlocks')}</h2>
        <p class="opal-course-home-ehint">${t('homeAddBlockHint')}</p>
        ${button('add-menu', `${state.adding ? t('homeCloseList') : t('homeSelectArea')}${ICON.chevron}`, '', `aria-expanded="${state.adding}"`)}
        ${addList}
      </section>
    </div>`;
}
