import { fade, pop, pressable, closeSurface } from './motion';
import { bindDialogKeyboard } from './settings';
import { applyTheme, saveTheme, loadTheme, deriveAccentTokens, PRESETS, type ThemeConfig, type ThemeMode } from './theme';
import { localeTag } from './i18n/core.ts';
import { t } from './i18n/messages/shell.ts';
/* ━━ Darstellung panel ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * A popover dialog under the Darstellung button of the edit bar:
 * mode (segmented), accent swatches and an own colour (hex field
 * plus a canvas picker). Changes preview live; Speichern keeps them,
 * Abbrechen and Escape put the saved theme back.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ── State ─────────────────────────────────────────────────── */

let editorOpen = false;
let draft: ThemeConfig = { mode: 'dark', accent: '#2f6fe4' };
let savedSnapshot: ThemeConfig = { ...draft };
let releaseFocus: ReturnType<typeof bindDialogKeyboard> | null = null;
let stopReposition: (() => void) | null = null;

/* ── Constants ─────────────────────────────────────────────── */

const PANEL_ID     = 'opal-theme-editor';
const BACKDROP_ID  = 'opal-theme-backdrop';

const MODES: { mode: ThemeMode; label: string }[] = [
    { mode: 'light', get label() { return t('themeLight'); } },
    { mode: 'dark',  get label() { return t('themeDark'); } },
    { mode: 'oled',  get label() { return t('themeOled'); } },
];

/** The accent presets: the same values and names the options page offered before the panel took over. */
export const ACCENT_PRESETS: { value: string; label: string }[] = [
    { value: '#2f6fe4', get label() { return t('themeBlue'); } },
    { value: '#b04736', get label() { return t('themeRed'); } },
    { value: '#26805b', get label() { return t('themeGreen'); } },
    { value: '#8150b5', get label() { return t('themePurple'); } },
];
const HEX_RE = /^#?([0-9a-f]{6})$/i;
const isPreset = (hex: string) => ACCENT_PRESETS.some(p => p.value === hex.toLowerCase());
/** Check mark colour on a swatch: whichever of black and white reads better on it. */
const onSwatch = (hex: string) => deriveAccentTokens(hex, PRESETS.dark)['on-accent'];

/* ── Color Conversion Helpers ─────────────────────────────── */

interface HSV { h: number; s: number; v: number }

function hexToHsv(hex: string): HSV {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + 6) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/* ── Canvas Color Picker ──────────────────────────────────── */

function buildColorPicker(
    container: HTMLElement,
    initialColor: string,
    onChange: (hex: string) => void,
): { setColor: (hex: string) => void } {

    const hsv = hexToHsv(initialColor);
    let currentH = hsv.h;
    let currentS = hsv.s;
    let currentV = hsv.v;

    // -- Saturation/Value canvas --
    const svCanvas = document.createElement('canvas');
    svCanvas.width = 260;
    svCanvas.height = 160;
    svCanvas.className = 'theme-sv-canvas';
    const svCtx = svCanvas.getContext('2d')!;

    // -- Hue bar canvas --
    const hueCanvas = document.createElement('canvas');
    hueCanvas.width = 260;
    hueCanvas.height = 16;
    hueCanvas.className = 'theme-hue-canvas';
    const hueCtx = hueCanvas.getContext('2d')!;

    // -- Pointers --
    const svPointer = document.createElement('div');
    svPointer.className = 'theme-sv-pointer';

    const huePointer = document.createElement('div');
    huePointer.className = 'theme-hue-pointer';

    // -- Wrappers --
    const svWrap = document.createElement('div');
    svWrap.className = 'theme-sv-wrap';
    svWrap.appendChild(svCanvas);
    svWrap.appendChild(svPointer);

    const hueWrap = document.createElement('div');
    hueWrap.className = 'theme-hue-wrap';
    hueWrap.appendChild(hueCanvas);
    hueWrap.appendChild(huePointer);

    container.appendChild(svWrap);
    container.appendChild(hueWrap);

    function drawSV(): void {
        const w = svCanvas.width, h = svCanvas.height;
        // Base hue fill
        svCtx.fillStyle = `hsl(${currentH}, 100%, 50%)`;
        svCtx.fillRect(0, 0, w, h);
        // White gradient left→right
        const whiteGrad = svCtx.createLinearGradient(0, 0, w, 0);
        whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
        whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
        svCtx.fillStyle = whiteGrad;
        svCtx.fillRect(0, 0, w, h);
        // Black gradient top→bottom
        const blackGrad = svCtx.createLinearGradient(0, 0, 0, h);
        blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
        blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
        svCtx.fillStyle = blackGrad;
        svCtx.fillRect(0, 0, w, h);
    }

    function drawHue(): void {
        const w = hueCanvas.width, h = hueCanvas.height;
        const grad = hueCtx.createLinearGradient(0, 0, w, 0);
        for (let i = 0; i <= 6; i++) {
            grad.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
        }
        hueCtx.fillStyle = grad;
        hueCtx.fillRect(0, 0, w, h);
    }

    function updatePointers(): void {
        svPointer.style.left = `${currentS * 100}%`;
        svPointer.style.top = `${(1 - currentV) * 100}%`;
        svPointer.style.backgroundColor = hsvToHex(currentH, currentS, currentV);
        huePointer.style.left = `${(currentH / 360) * 100}%`;
        huePointer.style.backgroundColor = `hsl(${currentH}, 100%, 50%)`;
    }

    function emitColor(): void {
        onChange(hsvToHex(currentH, currentS, currentV));
    }

    // -- Drag logic --
    function addDrag(
        target: HTMLElement,
        onMove: (x: number, y: number) => void,
    ): void {
        let dragging = false;

        function handle(e: MouseEvent | TouchEvent): void {
            e.preventDefault();
            const rect = target.getBoundingClientRect();
            const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
            onMove(x, y);
        }

        target.addEventListener('mousedown', (e) => { dragging = true; handle(e); });
        target.addEventListener('touchstart', (e) => { dragging = true; handle(e); }, { passive: false });

        window.addEventListener('mousemove', (e) => { if (dragging) handle(e); });
        window.addEventListener('touchmove', (e) => { if (dragging) handle(e); }, { passive: false });

        window.addEventListener('mouseup', () => { dragging = false; });
        window.addEventListener('touchend', () => { dragging = false; });
    }

    addDrag(svWrap, (x, y) => {
        currentS = x;
        currentV = 1 - y;
        updatePointers();
        emitColor();
    });

    addDrag(hueWrap, (x) => {
        currentH = x * 360;
        drawSV();
        updatePointers();
        emitColor();
    });

    // Initial draw
    drawSV();
    drawHue();
    updatePointers();

    return {
        setColor(hex: string) {
            const hsv = hexToHsv(hex);
            currentH = hsv.h;
            currentS = hsv.s;
            currentV = hsv.v;
            drawSV();
            updatePointers();
        },
    };
}

/* ── Public API ────────────────────────────────────────────── */

export async function openThemeEditor(): Promise<void> {
    if (editorOpen) return;
    editorOpen = true;

    // Snapshot current theme so we can revert on cancel
    savedSnapshot = await loadTheme();
    draft = { ...savedSnapshot };

    // Transparent backdrop: a click outside cancels, like Escape.
    const backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.className = 'theme-editor-backdrop';
    backdrop.addEventListener('click', () => closeThemeEditor(false));
    document.body.appendChild(backdrop);
    void fade(backdrop);

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'theme-editor-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'theme-editor-title');
    panel.lang = localeTag();
    panel.innerHTML = buildPanelHTML(draft);
    document.body.appendChild(panel);
    positionPanel(panel);
    const onResize = () => positionPanel(panel);
    window.addEventListener('resize', onResize);
    stopReposition = () => window.removeEventListener('resize', onResize);
    pressable(panel); void pop(panel);

    const picker = buildColorPicker(
        panel.querySelector<HTMLElement>('#theme-picker-container')!,
        draft.accent,
        hex => { setAccent(panel, hex, 'picker'); },
    );
    bindEvents(panel, picker);

    releaseFocus = bindDialogKeyboard(
        panel,
        () => closeThemeEditor(false),
        panel.querySelector<HTMLElement>('[data-mode][aria-checked="true"]'),
    );
}

export function closeThemeEditor(save: boolean): void {
    if (!editorOpen) return;
    editorOpen = false;
    stopReposition?.();
    stopReposition = null;

    const release = releaseFocus;
    releaseFocus = null;
    const panel = document.getElementById(PANEL_ID);
    if (panel) void closeSurface(panel);
    const backdrop = document.getElementById(BACKDROP_ID);
    if (backdrop) void closeSurface(backdrop);
    release?.(() => document.getElementById('opal-theme-btn'));

    if (save) void saveTheme(draft);
    else applyTheme(savedSnapshot);
}

/** Right edge on the edit actions, directly under the Darstellung button; never off screen. */
function positionPanel(panel: HTMLElement): void {
    const anchor = document.getElementById('opal-edit-actions') ?? document.getElementById('opal-theme-btn');
    const rect = anchor?.getBoundingClientRect();
    const top = rect ? Math.round(rect.bottom + 8) : 64;
    // Right-aligned with the actions, but never past the left edge of a narrow window.
    const right = rect
        ? Math.max(16, Math.min(Math.round(window.innerWidth - rect.right), window.innerWidth - panel.offsetWidth - 16))
        : 16;
    panel.style.top = `${top}px`;
    panel.style.right = `${right}px`;
    panel.style.maxHeight = `calc(100vh - ${top}px - 16px)`;
}

/* ── Panel HTML ────────────────────────────────────────────── */

function accentOption(value: string, label: string, checked: boolean): string {
    const custom = value === 'custom';
    const style = custom ? '' : ` style="background:${value};color:${onSwatch(value)}"`;
    return `<button type="button" role="radio" class="theme-accent-opt" data-accent="${value}" aria-checked="${checked}" tabindex="${checked ? 0 : -1}">
        <span class="theme-accent-dot${custom ? ' is-custom' : ''}"${style}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></span>
        <span class="theme-accent-name">${label}</span>
    </button>`;
}

function buildPanelHTML(config: ThemeConfig): string {
    const modes = MODES.map(({ mode, label }) => {
        const active = mode === config.mode;
        return `<button type="button" role="radio" data-mode="${mode}" aria-checked="${active}" tabindex="${active ? 0 : -1}">${label}</button>`;
    }).join('');

    const custom = !isPreset(config.accent);
    const accents = ACCENT_PRESETS.map(p => accentOption(p.value, p.label, p.value === config.accent.toLowerCase())).join('')
        + accentOption('custom', t('themeCustomAccent'), custom);

    return `
        <div class="theme-editor-header">
            <h2 id="theme-editor-title">${t('appearance')}</h2>
            <button type="button" id="theme-close-btn" class="theme-icon-btn" aria-label="${t('close')}" title="${t('close')}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>

        <div class="theme-section">
            <p id="theme-mode-label" class="theme-section-label">${t('themeMode')}</p>
            <div class="opal-seg theme-mode-seg" role="radiogroup" aria-labelledby="theme-mode-label" aria-describedby="theme-mode-hint">${modes}</div>
            <p id="theme-mode-hint" class="theme-caption">${t('themeOledHint')}</p>
        </div>

        <div class="theme-section">
            <p id="theme-accent-label" class="theme-section-label">${t('themeAccent')}</p>
            <div class="theme-accent-row" role="radiogroup" aria-labelledby="theme-accent-label">${accents}</div>
            <div id="theme-custom" class="theme-custom"${custom ? '' : ' hidden'}>
                <label class="theme-hex-field" for="theme-hex-input"><span class="theme-section-label">${t('themeHex')}</span>
                    <input id="theme-hex-input" class="settings-number-input" type="text" value="${config.accent}" maxlength="7" spellcheck="false" autocomplete="off" aria-describedby="theme-hex-error">
                </label>
                <p id="theme-hex-error" class="theme-caption theme-hex-error" role="status" hidden>${t('themeHexError')}</p>
                <div id="theme-picker-container" class="theme-picker-container"></div>
            </div>
        </div>

        <p class="theme-caption">${t('themeScope')}</p>

        <div class="theme-actions">
            <button type="button" id="theme-cancel-btn" class="opal-btn">${t('cancel')}</button>
            <button type="button" id="theme-save-btn" class="opal-btn opal-btn-primary">${t('save')}</button>
        </div>
    `;
}

/* ── Event Binding ─────────────────────────────────────────── */

/** Move focus along a radiogroup with the arrow keys and select what it lands on. */
function radioArrows(group: HTMLElement, select: (el: HTMLElement) => void): void {
    group.addEventListener('keydown', (e) => {
        const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
        const at = radios.indexOf(document.activeElement as HTMLElement);
        if (at < 0) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0
            : e.key === 'End' ? radios.length - 1
            : (at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + radios.length) % radios.length;
        radios[next].focus();
        select(radios[next]);
    });
}

type Picker = { setColor: (hex: string) => void };

/** Apply an accent to the draft and mirror it in the swatches, hex field and picker. */
function setAccent(panel: HTMLElement, hex: string, from: 'preset' | 'hex' | 'picker', picker?: Picker): void {
    draft.accent = hex;
    applyTheme(draft);
    const input = panel.querySelector<HTMLInputElement>('#theme-hex-input');
    if (input && from !== 'hex') input.value = hex;
    if (from !== 'picker') picker?.setColor(hex);
    if (from !== 'preset') syncAccentRadios(panel, 'custom');
}

function syncAccentRadios(panel: HTMLElement, selected: string): void {
    panel.querySelectorAll<HTMLElement>('[data-accent]').forEach(opt => {
        const on = opt.dataset.accent === selected;
        opt.setAttribute('aria-checked', String(on));
        opt.tabIndex = on ? 0 : -1;
    });
    panel.querySelector<HTMLElement>('#theme-custom')!.hidden = selected !== 'custom';
}

function bindEvents(panel: HTMLElement, picker: Picker): void {
    // Mode: one choice of three
    const modeGroup = panel.querySelector<HTMLElement>('.theme-mode-seg')!;
    const selectMode = (btn: HTMLElement) => {
        draft.mode = btn.dataset.mode as ThemeMode;
        applyTheme(draft);
        modeGroup.querySelectorAll<HTMLElement>('[data-mode]').forEach(b => {
            const on = b === btn;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
        });
    };
    modeGroup.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest<HTMLElement>('[data-mode]');
        if (btn) selectMode(btn);
    });
    radioArrows(modeGroup, selectMode);

    // Accent: four presets and "Eigene"
    const accentGroup = panel.querySelector<HTMLElement>('.theme-accent-row')!;
    const selectAccent = (opt: HTMLElement) => {
        const value = opt.dataset.accent!;
        if (value === 'custom') {
            syncAccentRadios(panel, 'custom');
            return;
        }
        setAccent(panel, value, 'preset', picker);
        syncAccentRadios(panel, value);
    };
    accentGroup.addEventListener('click', (e) => {
        const opt = (e.target as Element).closest<HTMLElement>('[data-accent]');
        if (!opt) return;
        selectAccent(opt);
        if (opt.dataset.accent === 'custom') panel.querySelector<HTMLInputElement>('#theme-hex-input')?.focus();
    });
    radioArrows(accentGroup, selectAccent);

    // Own colour by hex: the keyboard route to any accent
    const hexInput = panel.querySelector<HTMLInputElement>('#theme-hex-input')!;
    const hexError = panel.querySelector<HTMLElement>('#theme-hex-error')!;
    hexInput.addEventListener('input', () => {
        const match = HEX_RE.exec(hexInput.value.trim());
        // Only a complete entry can be wrong; a half-typed value is just unfinished.
        if (!match && hexInput.value.trim().length >= 7) hexInput.setAttribute('aria-invalid', 'true');
        else hexInput.removeAttribute('aria-invalid');
        hexError.hidden = !!match || hexInput.value.trim().length < 7;
        if (match) setAccent(panel, '#' + match[1].toLowerCase(), 'hex', picker);
    });
    hexInput.addEventListener('blur', () => {
        hexInput.value = draft.accent;
        hexInput.removeAttribute('aria-invalid');
        hexError.hidden = true;
    });

    panel.querySelector('#theme-save-btn')?.addEventListener('click', () => closeThemeEditor(true));
    panel.querySelector('#theme-cancel-btn')?.addEventListener('click', () => closeThemeEditor(false));
    panel.querySelector('#theme-close-btn')?.addEventListener('click', () => closeThemeEditor(false));
}
