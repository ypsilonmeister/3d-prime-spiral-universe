// Sieve of Eratosthenes Animation plugin

import * as THREE from 'three';
import { state } from '../state.js';
import { updateParticleVisuals } from '../render/particles.js';

const _sieveTmpColor = new THREE.Color();
const SIEVE_FADE_SPEED = 0.04;

let onSieveStatsUpdate = null;
let onSieveUIUpdate = null;

export function setSieveCallbacks(statsCb, uiCb) {
    onSieveStatsUpdate = statsCb;
    onSieveUIUpdate = uiCb;
}

export function sieveReset() {
    state.sievePlaying = false;
    state.sieveFinished = false;
    state.sieveCurrentP = 2;
    state.sieveNextMultiple = 4;
    state.sieveFoundCount = 0;
    state.sieveAccum = 0;
    state.sieveState.fill(0);
    state.sieveAlpha.fill(1.0);
    state.sieveState[1] = 2;  // 1 is not prime
    state.sieveState[2] = 1;  // 2 is the first prime
    state.sieveFoundCount = 1;
    sieveFlushVisuals();
    sieveUpdateStats();
}

export function sieveAdvanceStep() {
    if (state.sieveFinished) return false;

    // Eliminate all multiples of sieveCurrentP up to sieveLimit (dirty-write each)
    const p = state.sieveCurrentP;
    const limit = state.sieveLimit;
    for (let m = state.sieveNextMultiple; m <= limit; m += p) {
        if (state.sieveState[m] === 0) {
            state.sieveState[m] = 2;
            sieveWriteCell(m);  // mark eliminated — dirty-write
        }
    }

    // Find next prime candidate
    let next = p + 1;
    while (next <= limit && state.sieveState[next] !== 0) next++;

    if (next > limit) {
        // Sieve complete — everything remaining unmarked is prime
        for (let n = 2; n <= limit; n++) {
            if (state.sieveState[n] === 0) {
                state.sieveState[n] = 1;
                state.sieveFoundCount++;
                sieveWriteCell(n);
            }
        }
        state.sieveFinished = true;
        state.sievePlaying = false;
        if (onSieveUIUpdate) onSieveUIUpdate();
        return false;
    }

    // Confirm next as prime (dirty-write)
    state.sieveState[next] = 1;
    state.sieveFoundCount++;
    state.sieveCurrentP = next;
    state.sieveNextMultiple = next * 2;
    sieveWriteCell(next);

    // Optimisation: if p > √sieveLimit all remaining unknowns are prime
    if (next * next > limit) {
        for (let n = next + 1; n <= limit; n++) {
            if (state.sieveState[n] === 0) {
                state.sieveState[n] = 1;
                state.sieveFoundCount++;
                sieveWriteCell(n);
            }
        }
        state.sieveFinished = true;
        state.sievePlaying = false;
        if (onSieveUIUpdate) onSieveUIUpdate();
        return true;
    }

    return true;
}

export function sieveWriteCell(n) {
    if (!state.geometry) return;
    const i = n - 1;
    const cols  = state.geometry.attributes.customColor.array;
    const sizes = state.geometry.attributes.size.array;
    const alpha = state.sieveAlpha[n];
    const sState = state.sieveState[n];
    const c = _sieveTmpColor;

    if (sState === 2 && alpha <= 0.0) {
        sizes[i] = 0.0;
    } else if (sState === 1) {
        c.set(0xffd700);
        sizes[i] = 80.0;
        cols[i*3]=c.r*alpha; cols[i*3+1]=c.g*alpha; cols[i*3+2]=c.b*alpha;
    } else if (sState === 2) {
        c.setHSL(0.0, 0.9, 0.4 * alpha);
        sizes[i] = Math.max(0, 40.0 * alpha);
        cols[i*3]=c.r*alpha; cols[i*3+1]=c.g*alpha; cols[i*3+2]=c.b*alpha;
    } else {
        c.setHSL(0.58, 0.6, 0.35);
        sizes[i] = 35.0;
        cols[i*3]=c.r*alpha; cols[i*3+1]=c.g*alpha; cols[i*3+2]=c.b*alpha;
    }

    state.geometry.attributes.customColor.needsUpdate = true;
    state.geometry.attributes.size.needsUpdate = true;
}

export function sieveFlushVisuals() {
    if (!state.sieveModeActive || !state.geometry) return;
    for (let n = 1; n <= state.sieveLimit; n++) {
        sieveWriteCell(n);
    }
    // Hide particles beyond sieveLimit
    const sizes = state.geometry.attributes.size.array;
    for (let n = state.sieveLimit + 1; n <= state.MAX_POINTS; n++) {
        sizes[n - 1] = 0.0;
    }
    state.geometry.attributes.customColor.needsUpdate = true;
    state.geometry.attributes.size.needsUpdate = true;
}

export function sieveUpdateStats() {
    if (onSieveStatsUpdate) {
        onSieveStatsUpdate(state.sieveFinished, state.sieveFoundCount, state.sieveLimit, state.sieveCurrentP);
    }
}

export function sieveTick(dt) {
    if (!state.sievePlaying || state.sieveFinished) {
        sieveFadeStep();
        return;
    }

    const stepsPerSec = Math.pow(2, state.sieveSpeed * 3);  // 1x→8/s, 5x→32768/s
    state.sieveAccum += stepsPerSec * dt;

    let dirty = false;
    let budget = Math.min(Math.ceil(state.sieveAccum), 2000); // cap per-frame work
    while (state.sieveAccum >= 1 && !state.sieveFinished && budget-- > 0) {
        state.sieveAccum -= 1;
        const advanced = sieveAdvanceStep();
        dirty = true;
        if (!advanced) break;
    }

    sieveFadeStep();
    if (dirty) {
        sieveUpdateStats();
    }
}

export function sieveFadeStep() {
    if (!state.geometry) return;
    let anyFading = false;
    const sizes = state.geometry.attributes.size.array;
    const cols  = state.geometry.attributes.customColor.array;
    const color = new THREE.Color();

    for (let n = 1; n <= state.sieveLimit; n++) {
        if (state.sieveState[n] !== 2) continue;
        const prev = state.sieveAlpha[n];
        if (prev <= 0) continue;
        anyFading = true;
        const alpha = Math.max(0, prev - SIEVE_FADE_SPEED);
        state.sieveAlpha[n] = alpha;
        const i = n - 1;
        color.setHSL(0.0, 0.9, 0.4 * alpha);
        cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
        sizes[i] = Math.max(0, 40.0 * alpha);
    }
    if (anyFading) {
        state.geometry.attributes.customColor.needsUpdate = true;
        state.geometry.attributes.size.needsUpdate = true;
    }
}

export const sieveMode = {
    id: 'sieve',
    kind: 'overlay',
    enter() {
        state.sieveModeActive = true;
        state.sieveLimit = state.activePointCount;
        sieveReset();
        if (onSieveUIUpdate) onSieveUIUpdate();
    },
    exit() {
        state.sieveModeActive = false;
        state.sievePlaying = false;
        updateParticleVisuals();
    },
    onCountChange() {
        // No action on count change; requires user-driven Reset/Rebuild
    }
};
