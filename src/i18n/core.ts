/**
 * Interface language for everything the extension draws. OPAL's own text (what scrapers and parsers
 * match, such as "Abmelden" or "wurde von … erstellt") is data, not interface, and never goes through here.
 *
 * Each area keeps its strings in `src/i18n/messages/<area>.ts` via `defineMessages(de, en)`.
 * German is the source; the type makes a missing or extra English key a compile error.
 */
export type Locale = 'de' | 'en';
export type LanguageSetting = 'auto' | Locale;
export const LOCALES: readonly Locale[] = ['de', 'en'];
/** Names shown in the language picker, each in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

/** A message is a string with `{name}` placeholders, or plural forms picked by the `count` parameter. */
export type Plural = { one: string; other: string; zero?: string };
export type Message = string | Plural;
export type Params = Record<string, string | number>;

/** Browser UI language, or German where there is none (unit tests, OPAL's own audience). */
export function detectLocale(): Locale {
    let tag = '';
    try { tag = globalThis.chrome?.i18n?.getUILanguage?.() ?? ''; } catch { /* no extension context */ }
    if (!tag) return 'de';
    return tag.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function resolveLocale(setting: LanguageSetting | undefined): Locale {
    return setting === 'de' || setting === 'en' ? setting : detectLocale();
}

let current: Locale = detectLocale();
const listeners = new Set<(locale: Locale) => void>();

export function locale(): Locale { return current; }
/** BCP 47 tag for Intl and `lang` attributes. */
export function localeTag(): string { return current === 'de' ? 'de-DE' : 'en-GB'; }

export function setLocale(next: Locale): void {
    if (next === current) return;
    current = next;
    if (typeof document !== 'undefined') document.documentElement.dataset.opalLocale = next;
    for (const listener of listeners) listener(next);
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function format(message: Message, params: Params | undefined): string {
    let text: string;
    if (typeof message === 'string') text = message;
    else {
        const count = Number(params?.count ?? 0);
        text = count === 0 && message.zero !== undefined ? message.zero
            : new Intl.PluralRules(localeTag()).select(count) === 'one' ? message.one : message.other;
    }
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
        const value = params[name];
        if (value === undefined) return whole;
        return typeof value === 'number' ? value.toLocaleString(localeTag()) : value;
    });
}

type Shape<D> = { [K in keyof D]: D[K] extends string ? string : Plural };
export type Translate<D> = (key: keyof D & string, params?: Params) => string;

/**
 * `const t = defineMessages({ save: 'Speichern' }, { save: 'Save' }); t('save')`.
 * Unknown keys fall back to German, then to the key itself, so a gap is visible but never blank.
 */
export function defineMessages<const D extends Record<string, Message>>(de: D, en: Shape<D>): Translate<D> {
    const tables: Record<Locale, Record<string, Message>> = { de, en };
    return (key, params) => format(tables[current][key] ?? de[key] ?? key, params);
}

/** Dates and times in the interface language. */
export function formatDate(date: Date | number, options: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(localeTag(), options).format(date);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(localeTag(), options).format(value);
}

/** "vor 5 Minuten" / "5 minutes ago". */
export function formatRelative(value: number, unit: Intl.RelativeTimeFormatUnit): string {
    return new Intl.RelativeTimeFormat(localeTag(), { numeric: 'auto' }).format(value, unit);
}
