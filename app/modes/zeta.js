// Riemann Zeta Wave Mode plugin

import { state } from '../state.js';
import { ZETA_ZEROS } from '../../shared/zeta-zeros.js';
import { requestZetaOffsets, cancelPendingZetaRequests, isWorkerReady } from '../worker-client.js';
import { applyPositionOverlays } from '../render/lattice.js';

let _zetaSyncCachesBuilt = false;
let _lnCacheSync = null;
let _sqrtCacheSync = null;
let _zetaDenomSync = null;

function _computeZetaSyncFallback(N) {
    if (!_zetaSyncCachesBuilt) {
        _lnCacheSync = new Float64Array(state.MAX_POINTS);
        _sqrtCacheSync = new Float64Array(state.MAX_POINTS);
        for (let i = 0; i < state.MAX_POINTS; i++) {
            _lnCacheSync[i] = Math.log(i + 1);
            _sqrtCacheSync[i] = Math.sqrt(i + 1);
        }
        _zetaDenomSync = new Float64Array(100);
        for (let k = 0; k < 100; k++) {
            const g = ZETA_ZEROS[k];
            _zetaDenomSync[k] = 0.25 + g * g;
        }
        _zetaSyncCachesBuilt = true;
    }
    for (let i = 0; i < state.MAX_POINTS; i++) {
        const lnx = _lnCacheSync[i], sqrtx = _sqrtCacheSync[i];
        let sum = 0;
        for (let k = 0; k < N; k++) {
            const g = ZETA_ZEROS[k];
            const angle = g * lnx;
            sum += sqrtx * (Math.cos(angle) * 0.5 + Math.sin(angle) * g) / _zetaDenomSync[k];
        }
        state.zetaOffsets[i] = -2.0 * sum;
    }
    let maxAbs = 0;
    for (let i = 0; i < state.MAX_POINTS; i++) {
        const a = Math.abs(state.zetaOffsets[i]);
        if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs > 0) {
        const scale = (state.currentSpacing * 8.0 * state.zetaAmplitude) / maxAbs;
        for (let i = 0; i < state.MAX_POINTS; i++) state.zetaOffsets[i] *= scale;
    }
}

export function computeZetaOffsets(N) {
    if (!state.zetaModeActive || N === 0) {
        cancelPendingZetaRequests();
        state.zetaOffsets.fill(0);
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
        applyPositionOverlays();
    },
    onCountChange() {
        if (state.zetaModeActive) {
            computeZetaOffsets(state.zetaZeroCount);
        }
    }
};
