// Animation render loop, physics interpolation, stereo rendering, and VR frame updates

import { state } from '../state.js';
import { updateParticleVisuals } from './particles.js';

const LERP_THRESHOLD_SQ = 0.25; // 0.5 units per axis
let _lastTime = 0;
let onFrameTick = null;
let onSieveTick = null;

export function setFrameTickCallback(cb) {
    onFrameTick = cb;
}

export function setSieveTickCallback(cb) {
    onSieveTick = cb;
}

export function animate(now = 0) {
    const dt = Math.min((now - _lastTime) / 1000, 0.1); // seconds, clamped to 100ms
    _lastTime = now;

    if (state.sieveModeActive && onSieveTick) {
        onSieveTick(dt);
    }

    if (state.autoGrow && state.activePointCount < state.MAX_POINTS) {
        state.growSpeed *= 1.005;
        state.activePointCount = Math.min(state.MAX_POINTS, state.activePointCount + Math.floor(state.growSpeed));
        
        // throttle updates to every 10 frames during auto-grow
        if (++state.growUICounter % 10 === 0) {
            updateParticleVisuals();
            if (onFrameTick) {
                onFrameTick();
            }
        }
        state.lerpActive = true;
    }

    if (state.lerpActive && state.geometry) {
        const p = state.geometry.attributes.position.array;
        const limit = state.activePointCount * 3;
        let maxDeltaSq = 0;
        for (let i = 0; i < limit; i++) {
            const delta = (state.targetPositions[i] - p[i]) * state.lerpSpeed;
            p[i] += delta;
            if (delta * delta > maxDeltaSq) {
                maxDeltaSq = delta * delta;
            }
        }
        state.geometry.attributes.position.needsUpdate = true;
        if (maxDeltaSq < LERP_THRESHOLD_SQ) {
            state.lerpActive = false;
        }
    }

    if (!state.vrSession && state.controls) {
        state.controls.update();
    }

    if (state.renderer) {
        state.renderer.setScissorTest(false);
        state.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        state.renderer.clear();

        if (state.vrSession) {
            state.renderer.render(state.scene, state.camera);
        } else if (state.stereoMode !== 'off') {
            const eyeSep = 45;
            const W = window.innerWidth, H = window.innerHeight;
            state.cameraL.copy(state.camera);
            state.cameraR.copy(state.camera);
            state.cameraL.aspect = (W / 2) / H;
            state.cameraL.updateProjectionMatrix();
            state.cameraR.aspect = (W / 2) / H;
            state.cameraR.updateProjectionMatrix();
            
            state.cameraL.translateX(-eyeSep);
            state.cameraR.translateX(eyeSep);
            
            state.renderer.setScissorTest(true);
            state.renderer.setViewport(0, 0, W / 2, H);
            state.renderer.setScissor(0, 0, W / 2, H);
            state.renderer.render(state.scene, state.stereoMode === 'parallel' ? state.cameraL : state.cameraR);
            
            state.renderer.setViewport(W / 2, 0, W / 2, H);
            state.renderer.setScissor(W / 2, 0, W / 2, H);
            state.renderer.render(state.scene, state.stereoMode === 'parallel' ? state.cameraR : state.cameraL);
            
            state.renderer.setScissorTest(false);
        } else {
            state.renderer.render(state.scene, state.camera);
        }
    }
}
