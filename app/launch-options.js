// URL launch-option parser and exit URL cleanup helpers (pure, DOM-free)

export const DEFAULT_PAGE_TITLE = 'PrimeCrystal';
export const RH_PAGE_TITLE = 'リーマン予想と素数 — Explicit Formula | PrimeCrystal';

const LAUNCH_PARAM_KEYS = ['mode', 'kind', 'view', 'sweep'];

export function parseLaunchOptions(search = '', { reducedMotion = false } = {}) {
    const params = new URLSearchParams(search || '');
    const rawMode = (params.get('mode') || '').trim().toLowerCase();
    const mode = (rawMode === 'explicit' || rawMode === 'rh') ? 'explicit' : null;

    const rawKind = (params.get('kind') || '').trim().toLowerCase();
    const kind = (rawKind === 'psi1' || rawKind === 'psi') ? rawKind : null;

    const rawView = (params.get('view') || '').trim().toLowerCase();
    const view = (rawView === 'a' || rawView === 'b') ? rawView : null;

    const rawSweep = (params.get('sweep') || '').trim().toLowerCase();
    const sweepDisabled = rawSweep === '0' || rawSweep === 'false';
    const autoSweep = mode === 'explicit' && !reducedMotion && !sweepDisabled;

    return { mode, kind, view, autoSweep };
}

export function buildCleanExitUrl(locationLike) {
    const pathname = (locationLike && locationLike.pathname) || '/';
    const search = (locationLike && locationLike.search) || '';
    const hash = (locationLike && locationLike.hash) || '';

    const params = new URLSearchParams(search);
    for (const key of LAUNCH_PARAM_KEYS) {
        params.delete(key);
    }
    const remaining = params.toString();
    return remaining ? `${pathname}?${remaining}${hash}` : `${pathname}${hash}`;
}
