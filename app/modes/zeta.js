// Riemann Zeta Wave Mode plugin

import { state } from '../state.js';
import { ZETA_ZEROS_1000 as ZETA_ZEROS } from '../../shared/zeta-zeros-1000.js';
import { requestZetaOffsets, cancelPendingZetaRequests, isWorkerReady } from '../worker-client.js';
import { buildZetaDenom, buildLnSqrtCaches, accumulateZeroSumPsi, maxAbs, zetaNormScale, scaleInto } from '../../shared/explicit-formula.js';
import { applyPositionOverlays } from '../render/lattice.js';

let _zetaSyncCaches = null; // { ln, sq, denom, N, raw (Float32), maxAbs }

// The fallback runs on the main thread (worker unavailable), so cap the effective N
// to keep the UI responsive: N=1000 over MAX_POINTS blocked ~10s, N=100 about a tenth of that.
const ZETA_SYNC_FALLBACK_MAX_N = 100;

function _computeZetaSyncFallback(N) {
    // also never read past the zero table (would yield NaN)
    N = Math.min(N, ZETA_SYNC_FALLBACK_MAX_N, ZETA_ZEROS.length);
    const M = state.MAX_POINTS;
    if (!_zetaSyncCaches) {
        const { ln, sq } = buildLnSqrtCaches(M);
        _zetaSyncCaches = { ln, sq, denom: buildZetaDenom(ZETA_ZEROS), N: -1, raw: null, maxAbs: 0 };
    }
    const c = _zetaSyncCaches;
    // Same policy as worker.js: the zero sum depends only on the effective N; amplitude/spacing
    // only redo the normalization. raw is kept Float32 so max|raw| matches the worker's.
    if (c.N !== N) {
        const S = new Float64Array(M);
        accumulateZeroSumPsi(S, c.ln, c.sq, ZETA_ZEROS, c.denom, 0, N);
        const raw = new Float32Array(M);
        for (let i = 0; i < M; i++) raw[i] = -2.0 * S[i];
        c.N = N; c.raw = raw; c.maxAbs = maxAbs(raw);
    }
    state.zetaOffsetsRaw.set(c.raw);
    scaleInto(state.zetaOffsets, c.raw, zetaNormScale(c.maxAbs, state.currentSpacing, state.zetaAmplitude));
}

// Keep the visible N (slider range, label, state) equal to the N actually computed.
// In fallback the slider max follows the effective cap and a note says so; with the
// worker ready the full range (1000) is restored.
export function syncZetaNControl() {
    const fallback = !isWorkerReady();
    const max = fallback ? Math.min(ZETA_SYNC_FALLBACK_MAX_N, ZETA_ZEROS.length) : ZETA_ZEROS.length;
    if (state.zetaZeroCount > max) state.zetaZeroCount = max;
    if (typeof document === 'undefined') return;
    const slider = document.getElementById('zeta-n-slider');
    const val = document.getElementById('zeta-n-val');
    const note = document.getElementById('zeta-n-note');
    if (slider) {
        slider.max = String(max);
        slider.value = String(state.zetaZeroCount);
    }
    if (val) val.innerText = state.zetaZeroCount;
    if (note) note.textContent = fallback ? ` (fallback mode: max ${max})` : '';
}

export function computeZetaOffsets(N) {
    syncZetaNControl();
    N = Math.min(N, state.zetaZeroCount);
    if (!state.zetaModeActive || N === 0) {
        cancelPendingZetaRequests();
        state.zetaOffsets.fill(0);
        state.zetaOffsetsRaw.fill(0);
        applyPositionOverlays();
        return;
    }
    if (isWorkerReady()) {
        const requestedN = N;
        requestZetaOffsets(N, state.zetaAmplitude, state.currentSpacing).then(applied => {
            if (!applied) return;
            if (!state.zetaModeActive) return;
            if (state.zetaZeroCount !== requestedN) return;
            if (state.padicModeActive || state.primeDimModeActive) return;
            applyPositionOverlays();
        });
    } else {
        _computeZetaSyncFallback(N);
        applyPositionOverlays();
    }
}

export const zetaMode = {
    id: 'zeta',
    kind: 'overlay',
    enter() {
        state.zetaModeActive = true;
        computeZetaOffsets(state.zetaZeroCount);
    },
    exit() {
        state.zetaModeActive = false;
        if (state.zetaAnimating) {
            state.zetaAnimating = false;
            clearTimeout(state.zetaAnimFrame);
        }
        cancelPendingZetaRequests();
        state.zetaOffsets.fill(0);
        state.zetaOffsetsRaw.fill(0);
        applyPositionOverlays();
    },
    onCountChange() {
        if (state.zetaModeActive) {
            computeZetaOffsets(state.zetaZeroCount);
        }
    }
};
