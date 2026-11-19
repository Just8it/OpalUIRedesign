import { applyTheme } from '../theme.ts';
import { normaliseTheme } from './registry.ts';
/** Extension pages (options, popup) wear the same --color-opal-* tokens as the dashboard. */
export function applyPageTheme(raw: unknown) {
    const theme = normaliseTheme(raw);
    applyTheme(theme);
    document.documentElement.style.colorScheme = theme.mode === 'light' ? 'light' : 'dark';
    return theme;
}
