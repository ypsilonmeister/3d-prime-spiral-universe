// Prime Dimension Mode plugin

import * as THREE from 'three';
import { state } from '../state.js';
import { updateParticleVisuals, isCompositeVisible, clearAboveActive } from '../render/particles.js';

export function computePrimeDimValuations() {
    const [px, py, pz] = state.primeDimP;
    const lim = Math.max(state.activePointCount, state._maxRenderedCount);
    for (let n = 1; n <= lim; n++) {
        let m, v;
        m = n; v = 0; while (m % px === 0) { m = (m / px) | 0; v++; } state.primeDimValX[n] = v;
        m = n; v = 0; while (m % py === 0) { m = (m / py) | 0; v++; } state.primeDimValY[n] = v;
        m = n; v = 0; while (m % pz === 0) { m = (m / pz) | 0; v++; } state.primeDimValZ[n] = v;
    }
}

export function applyPrimeDimPositions() {
    const scale = state.currentSpacing * 15;
    const [px, py, pz] = state.primeDimP;

    const lim = Math.max(state.activePointCount, state._maxRenderedCount);
    for (let n = 1; n <= lim; n++) {
        const i = n - 1;
        const vx = state.primeDimValX[n];
        const vy = state.primeDimValY[n];
        const vz = state.primeDimValZ[n];

        let x, y, z;
        if (vx === 0 && vy === 0 && vz === 0) {
            const hash = ((n * 2654435761) >>> 0);
            const jitter = scale * 0.08;
            x = ((hash & 0xFF) / 255 - 0.5) * jitter;
            y = (((hash >> 8) & 0xFF) / 255 - 0.5) * jitter;
            z = (((hash >> 16) & 0xFF) / 255 - 0.5) * jitter;
        } else {
            x = vx * scale;
            y = vy * scale;
            z = vz * scale;
        }

        state.baseTargetPositions[i * 3]     = x;
        state.baseTargetPositions[i * 3 + 1] = y;
        state.baseTargetPositions[i * 3 + 2] = z;
    }

    const totalLim = Math.max(state.activePointCount, state._maxRenderedCount) * 3;
    for (let i = 0; i < totalLim; i++) {
        state.targetPositions[i] = state.baseTargetPositions[i];
    }
    state.lerpActive = true;
}

export function buildPrimeDimAxisObjects() {
    removePrimeDimAxisObjects();
    const [px, py, pz] = state.primeDimP;
    const len = state.currentSpacing * 15 * 6;

    const mat = new THREE.LineBasicMaterial({ color: 0x00f2ff, transparent: true, opacity: 0.4 });
    const axes = [
        { dir: new THREE.Vector3(len, 0, 0), label: `p=${px}` },
        { dir: new THREE.Vector3(0, len, 0), label: `p=${py}` },
        { dir: new THREE.Vector3(0, 0, len), label: `p=${pz}` },
    ];

    const lineGroup = new THREE.Group();
    for (const ax of axes) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), ax.dir]);
        lineGroup.add(new THREE.Line(geo, mat));
    }
    state.scene.add(lineGroup);
    state.primeDimAxisLines = lineGroup;

    // Sprite labels using canvas texture
    const labelColors = ['#ff6666', '#66ff66', '#6699ff'];
    const labelDirs = [
        new THREE.Vector3(len + state.currentSpacing * 20, 0, 0),
        new THREE.Vector3(0, len + state.currentSpacing * 20, 0),
        new THREE.Vector3(0, 0, len + state.currentSpacing * 20),
    ];
    for (let i = 0; i < 3; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 128, 64);
        ctx.font = 'bold 28px Orbitron, sans-serif';
        ctx.fillStyle = labelColors[i];
        ctx.shadowColor = labelColors[i];
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`p=${[px,py,pz][i]}`, 64, 32);
        const tex = new THREE.CanvasTexture(canvas);
        const mat2 = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(mat2);
        sprite.position.copy(labelDirs[i]);
        sprite.scale.set(state.currentSpacing * 18, state.currentSpacing * 9, 1);
        state.scene.add(sprite);
        state.primeDimAxisLabels.push(sprite);
    }
}

export function removePrimeDimAxisObjects() {
    if (state.primeDimAxisLines) {
        state.scene.remove(state.primeDimAxisLines);
        state.primeDimAxisLines = null;
    }
    for (const s of state.primeDimAxisLabels) {
        state.scene.remove(s);
    }
    state.primeDimAxisLabels = [];
}

export function updatePrimeDimVisuals() {
    if (!state.primeDimModeActive) {
        updateParticleVisuals();
        return;
    }

    const cols  = state.geometry.attributes.customColor.array;
    const sizes = state.geometry.attributes.size.array;
    const color = new THREE.Color();
    const [px, py, pz] = state.primeDimP;

    for (let n = 1; n <= state.activePointCount; n++) {
        const i = n - 1;

        const vx = state.primeDimValX[n];
        const vy = state.primeDimValY[n];
        const vz = state.primeDimValZ[n];
        const isOnAxis = (vx > 0 || vy > 0 || vz > 0);

        if (state.primeDimOnlyChosen && !isOnAxis) { sizes[i] = 0.0; continue; }
        if (!isCompositeVisible(n)) { sizes[i] = 0.0; continue; }

        if (!isOnAxis) {
            // Not a multiple of any chosen prime — dim, small
            color.setHSL(0.6, 0.2, 0.15);
            sizes[i] = state.isPrimeArray[n] ? 45.0 : 18.0;
        } else if (state.isPrimeArray[n]) {
            // This is one of the chosen axis primes — bright, on a unit axis
            if      (n === px) color.set(0xff6666);
            else if (n === py) color.set(0x66ff66);
            else if (n === pz) color.set(0x6699ff);
            else               color.setHSL(0.55, 1.0, 0.75); // other prime (shouldn't normally hit axes)
            sizes[i] = 90.0;
        } else {
            // Composite multiple — colour by which axes it lives on
            const onX = vx > 0, onY = vy > 0, onZ = vz > 0;
            const count = (onX ? 1 : 0) + (onY ? 1 : 0) + (onZ ? 1 : 0);
            if      (count === 3) color.set(0xffffff);   // all three — white
            else if (onX && onY)  color.set(0xffaa44);   // XY plane — orange
            else if (onX && onZ)  color.set(0xcc44ff);   // XZ plane — purple
            else if (onY && onZ)  color.set(0x44ffaa);   // YZ plane — teal
            else if (onX)         color.set(0xff6666);   // X axis — red
            else if (onY)         color.set(0x66ff66);   // Y axis — green
            else                  color.set(0x6699ff);   // Z axis — blue
            const depth = vx + vy + vz;
            sizes[i] = Math.min(25 + depth * 10, 60);
        }
        cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
    }
    clearAboveActive();
    state.geometry.attributes.customColor.needsUpdate = true;
    state.geometry.attributes.size.needsUpdate = true;
}

export const primeDimMode = {
    id: 'prime-dim',
    kind: 'owner',
    enter() {
        state.primeDimModeActive = true;
        computePrimeDimValuations();
        applyPrimeDimPositions();
        buildPrimeDimAxisObjects();
        updatePrimeDimVisuals();
    },
    exit() {
        state.primeDimModeActive = false;
        removePrimeDimAxisObjects();
        state.primeDimOnlyChosen = false;
    },
    onCountChange() {
        if (state.primeDimModeActive) {
            computePrimeDimValuations();
            applyPrimeDimPositions();
            buildPrimeDimAxisObjects();
            updatePrimeDimVisuals();
        }
    }
};
