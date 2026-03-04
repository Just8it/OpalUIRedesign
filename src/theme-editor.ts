/* ━━ Theme Editor ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Zoom-out sidebar with preset tiles and an accent color picker.
 * Uses a custom canvas-based picker (no customElements needed).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

import { applyTheme, saveTheme, loadTheme, PRESETS, type ThemeConfig, type ThemeMode } from './theme';

/* ── State ─────────────────────────────────────────────────── */

let editorOpen = false;
let draft: ThemeConfig = { mode: 'dark', accent: '#6264f4' };
let savedSnapshot: ThemeConfig = { ...draft };

/* ── Constants ─────────────────────────────────────────────── */

const PANEL_ID     = 'opal-theme-editor';
const BACKDROP_ID  = 'opal-theme-backdrop';

const PRESET_META: Record<ThemeMode, { label: string; icon: string; desc: string }> = {
    dark:  { label: 'Dark',  icon: '🌙', desc: 'Deep space' },
    light: { label: 'Light', icon: '☀️', desc: 'Clean white' },
    oled:  { label: 'OLED',  icon: '⚫', desc: 'Pure black' },
};

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

    // Add backdrop
    const backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.className = 'theme-editor-backdrop';
    backdrop.addEventListener('click', () => closeThemeEditor(false));
    document.body.appendChild(backdrop);

    // Build & inject editor panel
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'theme-editor-panel';
    panel.innerHTML = buildPanelHTML(draft);
    document.body.appendChild(panel);

    // Build the canvas color picker into the placeholder
    const pickerContainer = panel.querySelector('#theme-picker-container') as HTMLElement;
    const swatch = panel.querySelector('#theme-accent-swatch') as HTMLElement | null;
    const hexLabel = panel.querySelector('#theme-accent-hex') as HTMLElement | null;

    buildColorPicker(pickerContainer, draft.accent, (hex) => {
        draft.accent = hex;
        applyTheme(draft);
        if (swatch) swatch.style.background = hex;
        if (hexLabel) hexLabel.textContent = hex;
    });

    // Force reflow then add visible class for slide-in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => panel.classList.add('visible'));
    });

    bindEvents(panel);
}

export function closeThemeEditor(save: boolean): void {
    if (!editorOpen) return;
    editorOpen = false;

    // Remove panel + backdrop
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
        panel.classList.remove('visible');
        setTimeout(() => panel.remove(), 300);
    }
    document.getElementById(BACKDROP_ID)?.remove();

    if (save) {
        saveTheme(draft);
    } else {
        // Revert to saved
        applyTheme(savedSnapshot);
    }
}

/* ── Panel HTML ────────────────────────────────────────────── */

function buildPanelHTML(config: ThemeConfig): string {
    const presetTiles = (Object.keys(PRESETS) as ThemeMode[]).map(mode => {
        const m = PRESET_META[mode];
        const active = mode === config.mode;
        return `
            <button data-preset="${mode}"
                    class="theme-preset-tile ${active ? 'active' : ''}">
                <span class="theme-preset-icon">${m.icon}</span>
                <span class="theme-preset-label">${m.label}</span>
                <span class="theme-preset-desc">${m.desc}</span>
            </button>`;
    }).join('');

    return `
        <div class="theme-editor-header">
            <h3>Theme</h3>
            <button id="theme-close-btn" class="theme-icon-btn" title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>

        <div class="theme-section">
            <label class="theme-section-label">Mode</label>
            <div class="theme-preset-grid">${presetTiles}</div>
        </div>

        <div class="theme-section">
            <label class="theme-section-label">Accent Color</label>
            <div class="theme-accent-row">
                <div id="theme-accent-swatch" class="theme-swatch" style="background:${config.accent}"></div>
                <span id="theme-accent-hex" class="theme-hex-label">${config.accent}</span>
            </div>
            <div id="theme-picker-container" class="theme-picker-container"></div>
        </div>

        <div class="theme-actions">
            <button id="theme-cancel-btn" class="theme-btn theme-btn-ghost">Cancel</button>
            <button id="theme-save-btn" class="theme-btn theme-btn-primary">Save</button>
        </div>
    `;
}

/* ── Event Binding ─────────────────────────────────────────── */

function bindEvents(panel: HTMLElement): void {
    // Preset tiles
    panel.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.preset as ThemeMode;
            draft.mode = mode;
            applyTheme(draft);

            // Update active state
            panel.querySelectorAll('.theme-preset-tile').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Save / Cancel / Close
    panel.querySelector('#theme-save-btn')?.addEventListener('click', () => closeThemeEditor(true));
    panel.querySelector('#theme-cancel-btn')?.addEventListener('click', () => closeThemeEditor(false));
    panel.querySelector('#theme-close-btn')?.addEventListener('click', () => closeThemeEditor(false));
}
