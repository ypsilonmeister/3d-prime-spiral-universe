// p-adic View Mode plugin

import * as THREE from 'three';
import { state } from '../state.js';
import { applyPositionOverlays } from '../render/lattice.js';
import { updateParticleVisuals, isCompositeVisible, clearAboveActive } from '../render/particles.js';
import { computeZetaOffsets } from './zeta.js';

export function computePadicValuations(p) {
    const lim = Math.max(state.activePointCount, state._maxRenderedCount);
    for (let n = 1; n <= lim; n++) {
        let m = n, v = 0;
        while (m % p === 0) {
            m = (m / p) | 0;
            v++;
        }
        state.padicVal[n] = v;
    }
}

export function applyPadicPositions() {
    // Place particles on concentric spherical shells ordered by |n|_p = p^{-v_p(n)}
    const scaleFactor = state.currentSpacing * 20;

    const lim = Math.max(state.activePointCount, state._maxRenderedCount);
    const maxV = Math.ceil(Math.log(state.MAX_POINTS) / Math.log(state.padicP));
    const shells = new Array(maxV + 1).fill(null).map(() => []);
    for (let n = 1; n <= lim; n++) {
        const v = Math.min(state.padicVal[n], maxV);
        shells[v].push(n - 1);
    }

    const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
    for (let v = 0; v <= maxV; v++) {
        const shell = shells[v];
        if (shell.length === 0) continue;
        const r = (Math.pow(state.padicP, -v)) * scaleFactor;
        const count = shell.length;
        if (count === 1) {
            const idx = shell[0];
            state.baseTargetPositions[idx * 3]     = 0;
            state.baseTargetPositions[idx * 3 + 1] = r;
            state.baseTargetPositions[idx * 3 + 2] = 0;
            continue;
        }
        for (let k = 0; k < count; k++) {
            const idx = shell[k];
            const y = 1 - (k / (count - 1)) * 2;
            const rxy = Math.sqrt(Math.max(0, 1 - y * y));
            const angle = phi * k;
            state.baseTargetPositions[idx * 3]     = r * rxy * Math.cos(angle);
            state.baseTargetPositions[idx * 3 + 1] = r * y;
            state.baseTargetPositions[idx * 3 + 2] = r * rxy * Math.sin(angle);
        }
    }

    if (state.zetaModeActive) {
        computeZetaOffsets(state.zetaZeroCount);
    } else {
        applyPositionOverlays();
    }
}

export function updatePadicColorVisuals() {
    if (!state.padicModeActive || !state.padicColorMode) {
        updateParticleVisuals();
        return;
    }
    const cols = state.geometry.attributes.customColor.array;
    const sizes = state.geometry.attributes.size.array;
    const color = new THREE.Color();
    const maxV = Math.ceil(Math.log(state.MAX_POINTS) / Math.log(state.padicP));

    for (let n = 1; n <= state.activePointCount; n++) {
        const i = n - 1;
        if (!isCompositeVisible(n)) { sizes[i] = 0.0; continue; }

        const v = Math.min(state.padicVal[n], maxV);
        if (v === 0) {
            color.setHSL(0.6, 0.3, 0.25);
            sizes[i] = state.isPrimeArray[n] ? 70.0 : 22.0;
        } else {
            const hue = (1.0 - Math.min(v / maxV, 1.0)) * 0.55 + 0.05;
            const lightness = 0.4 + Math.min(v / maxV, 1.0) * 0.35;
            color.setHSL(hue, 1.0, lightness);
            sizes[i] = state.isPrimeArray[n] ? 80.0 : Math.min(20 + v * 8, 55);
        }
        cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
    }
    clearAboveActive();
    state.geometry.attributes.customColor.needsUpdate = true;
    state.geometry.attributes.size.needsUpdate = true;
}

export const padicMode = {
    id: 'padic',
    kind: 'owner',
    enter() {
        state.padicModeActive = true;
        computePadicValuations(state.padicP);
        applyPadicPositions();
        updatePadicColorVisuals();
    },
    exit() {
        state.padicModeActive = false;
        if (state.padicAnimating) {
            state.padicAnimating = false;
            clearTimeout(state.padicAnimFrame);
        }
        state.padicColorMode = false;
    },
    onCountChange() {
        if (state.padicModeActive) {
            computePadicValuations(state.padicP);
            applyPadicPositions();
            updatePadicColorVisuals();
        }
    }
};
