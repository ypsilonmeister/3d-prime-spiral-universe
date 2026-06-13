// Number Theoretic Landscape Mode plugin

import * as THREE from 'three';
import { state } from '../state.js';
import { applyPositionOverlays } from '../render/lattice.js';
import { updateParticleVisuals, isCompositeVisible, clearAboveActive } from '../render/particles.js';

const HC_NUMBERS = new Set([1,2,4,6,12,24,36,48,60,120,180,240,360,720,840,1260,1680,2520,5040,7560,10080,15120,20160,25200,27720,45360,50400,55440,83160,110880,166320,221760,277200,332640]);
const PERFECT_NUMBERS = new Set([6, 28, 496, 8128]);

export function computeNTLOffsets() {
    if (!state.ntlModeActive) {
        state.ntlOffsets.fill(0);
        return;
    }

    let rawMax = 0;
    for (let n = 1; n <= state.activePointCount; n++) {
        const v = _ntlRawValue(n);
        state.ntlOffsets[n - 1] = v;
        const a = Math.abs(v);
        if (a > rawMax) rawMax = a;
    }
    state.ntlOffsets.fill(0, state.activePointCount);

    const targetMax = state.currentSpacing * 25 * state.ntlScale;
    const norm = rawMax > 0 ? targetMax / rawMax : 1;
    for (let i = 0; i < state.activePointCount; i++) {
        state.ntlOffsets[i] *= norm;
    }
}

function _ntlRawValue(n) {
    if      (state.ntlFunc === 'd')           return state.ntl_d[n];
    else if (state.ntlFunc === 'sigma_ratio') return state.ntl_sigma[n];
    else if (state.ntlFunc === 'omega')       return state.ntl_omega[n];
    else if (state.ntlFunc === 'log_sigma')   return state.ntl_sigma[n] > 0 ? Math.log(state.ntl_sigma[n]) : 0;
    else if (state.ntlFunc === 'mobius')      return state.ntl_mu[n];
    else                                      return state.ntl_phi[n] / n;
}

export function updateNTLVisuals() {
    const cols  = state.geometry.attributes.customColor.array;
    const sizes = state.geometry.attributes.size.array;
    const color = new THREE.Color();

    let rawMin = Infinity, rawMax = -Infinity;
    for (let n = 1; n <= state.activePointCount; n++) {
        const v = _ntlRawValue(n);
        if (v < rawMin) rawMin = v;
        if (v > rawMax) rawMax = v;
    }
    const rawRange = rawMax - rawMin || 1;

    for (let n = 1; n <= state.activePointCount; n++) {
        const i = n - 1;
        if (!isCompositeVisible(n)) { sizes[i] = 0.0; continue; }

        const raw = _ntlRawValue(n);
        const t = (raw - rawMin) / rawRange; // 0..1 normalized

        const isPrime = !!state.isPrimeArray[n];
        const isPerfect = PERFECT_NUMBERS.has(n);
        const isHC = HC_NUMBERS.has(n);

        if (isPerfect && state.ntlHighlightPerfect) {
            color.set(0xffffff);
            sizes[i] = 110.0;
        } else if (isHC && state.ntlHighlightHC) {
            color.set(0xffdd00);
            sizes[i] = 95.0;
        } else if (state.ntlFunc === 'mobius') {
            if (state.ntl_mu[n] === 0)       { color.setHSL(0.0, 0.0, 0.15); sizes[i] = 20.0; }
            else if (state.ntl_mu[n] === -1) { color.set(0xff3333); sizes[i] = isPrime ? 80.0 : 45.0; }
            else                             { color.set(0x00ffcc); sizes[i] = isPrime ? 80.0 : 45.0; }
        } else {
            const hue = (1.0 - t) * 0.67;
            const sat = isPrime ? 0.5 : 1.0;
            const lit = isPrime ? 0.45 : 0.35 + t * 0.35;
            color.setHSL(hue, sat, lit);
            if (isPrime) {
                sizes[i] = 70.0;
            } else {
                sizes[i] = Math.max(18, Math.min(85, 18 + t * 67));
            }
        }
        cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
    }
    clearAboveActive();
    state.geometry.attributes.customColor.needsUpdate = true;
    state.geometry.attributes.size.needsUpdate = true;
}

export const ntlMode = {
    id: 'ntl',
    kind: 'overlay',
    enter() {
        state.ntlModeActive = true;
        computeNTLOffsets();
        applyPositionOverlays();
        updateNTLVisuals();
    },
    exit() {
        state.ntlModeActive = false;
        state.ntlOffsets.fill(0);
        applyPositionOverlays();
    },
    onCountChange() {
        if (state.ntlModeActive) {
            computeNTLOffsets();
            applyPositionOverlays();
            updateNTLVisuals();
        }
    }
};
