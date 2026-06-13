// Mode Manager to handle coordination, owner-exclusivity, and overlays of math visualization modes

import { state } from '../state.js';
import { calculateTargetPositions } from '../render/lattice.js';
import { updateParticleVisuals } from '../render/particles.js';

import { zetaMode } from './zeta.js';
import { padicMode } from './padic.js';
import { primeDimMode } from './prime-dim.js';
import { ntlMode } from './ntl.js';
import { sieveMode } from './sieve-anim.js';

const modes = new Map();
let activeOwner = null;
const activeOverlays = new Set();
let onUIDisabledStateUpdate = null;

export function setUIDisabledStateUpdateCallback(cb) {
    onUIDisabledStateUpdate = cb;
}

export function initModeManager() {
    modes.set(zetaMode.id, zetaMode);
    modes.set(padicMode.id, padicMode);
    modes.set(primeDimMode.id, primeDimMode);
    modes.set(ntlMode.id, ntlMode);
    modes.set(sieveMode.id, sieveMode);
}

export function toggleMode(id) {
    const mode = modes.get(id);
    if (!mode) return;

    if (mode.kind === 'owner') {
        if (activeOwner === mode) {
            // Exit active owner
            activeOwner.exit();
            activeOwner = null;
            calculateTargetPositions();
            updateParticleVisuals();
        } else {
            // Exit previous owner if any
            if (activeOwner) {
                activeOwner.exit();
            }
            activeOwner = mode;
            activeOwner.enter();
        }
    } else {
        // Overlay mode
        if (activeOverlays.has(mode)) {
            activeOverlays.delete(mode);
            mode.exit();
        } else {
            activeOverlays.add(mode);
            mode.enter();
        }
    }

    if (onUIDisabledStateUpdate) {
        onUIDisabledStateUpdate();
    }
}

export function getActiveOwner() {
    return activeOwner;
}

export function isOverlayActive(id) {
    const mode = modes.get(id);
    return activeOverlays.has(mode);
}

export function onCountChange() {
    if (activeOwner) {
        if (activeOwner.onCountChange) activeOwner.onCountChange();
    } else {
        calculateTargetPositions();
        for (const overlay of activeOverlays) {
            if (overlay.onCountChange) overlay.onCountChange();
        }
        updateParticleVisuals();
    }
}
