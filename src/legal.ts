/**
 * Terms and privacy policy the setup asks for. LEGAL_VERSION is the "Stand" date of
 * ENDNUTZERVEREINBARUNG.md and DATENSCHUTZERKLAERUNG.md: change it together with them,
 * and the setup asks everyone again before optional features can be switched on.
 */
export const LEGAL_VERSION = '2026-11-19';
const DOCS = 'https://github.com/Just8it/OpalUIRedesign/blob/main/';
export const TERMS_URL = `${DOCS}ENDNUTZERVEREINBARUNG.md`;
export const PRIVACY_URL = `${DOCS}DATENSCHUTZERKLAERUNG.md`;
export const LICENSE_URL = `${DOCS}LICENSE`;

export interface LegalAcceptance { version: string; at: number; }

export function readAcceptance(onboarding: Record<string, unknown> | null | undefined): LegalAcceptance | null {
    const accepted = onboarding?.accepted as Partial<LegalAcceptance> | undefined;
    return typeof accepted?.version === 'string' && typeof accepted.at === 'number' && Number.isFinite(accepted.at)
        ? { version: accepted.version, at: accepted.at } : null;
}

export function acceptedCurrentTerms(onboarding: Record<string, unknown> | null | undefined): boolean {
    return readAcceptance(onboarding)?.version === LEGAL_VERSION;
}
