// Mode Manager to handle coordination, owner-exclusivity, and overlays of math visualization modes

import { state } from '../state.js';
import { calculateTargetPositions, applyPositionOverlays } from '../render/lattice.js';
import { updateParticleVisuals } from '../render/particles.js';

import { zetaMode, computeZetaOffsets } from './zeta.js';
import { padicMode } from './padic.js';
import { primeDimMode } from './prime-dim.js';
import { ntlMode, computeNTLOffsets } from './ntl.js';
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

// Recompute the lattice base positions and COMMIT them into the live target
// buffer, re-applying any active Z-axis overlays (zeta / NTL). When a
// position-owning mode (p-adic / PrimeDim) is active, delegate to it instead.
//
// This is the single place that turns `calculateTargetPositions()` (which only
// fills baseTargetPositions) into rendered positions. Every caller that changes
// the lattice — startup, layout/fill/spacing/stride changes, owner-exit — must
// go through here, otherwise targetPositions is never updated and the points
// lerp toward the origin instead of forming the lattice.
export function rebuildPositions() {
    if (activeOwner) {
        if (activeOwner.onCountChange) activeOwner.onCountChange();
        return;
    }
    calculateTargetPositions();
    if (state.ntlModeActive) computeNTLOffsets();
    if (state.zetaModeActive) computeZetaOffsets(state.zetaZeroCount);
    applyPositionOverlays();
}

export function toggleMode(id) {
    const mode = modes.get(id);
    if (!mode) return;

    if (mode.kind === 'owner') {
        if (activeOwner === mode) {
            // Exit active owner — rebuild the base lattice, re-apply overlays,
            // then repaint colors/sizes.
            activeOwner.exit();
            activeOwner = null;
            rebuildPositions();
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
        if (activeOverlays.size > 0) {
            // Each active overlay recomputes its offsets and commits via applyPositionOverlays.
            for (const overlay of activeOverlays) {
                if (overlay.onCountChange) overlay.onCountChange();
            }
        } else {
            // No overlay to commit the new base — do it ourselves.
            applyPositionOverlays();
        }
        updateParticleVisuals();
    }
}
