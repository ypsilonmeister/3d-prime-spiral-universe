// Explicit-formula mode plugin (owner): psi1(x) - x^2/2 on a log-spaced conical spiral.
// Draws (all through the same two-stage compression, see shared/explicit-formula.js compressedOffset):
//   grey axis, measured curve (cyan), N-zero reconstruction ribbon (warm, vertex colour = residual),
//   and the shell +-B1(x) (Schoenfeld bound; RH ASSUMED, x >= 73.2 only) with a boundary ring at x = 73.2.
// All math is delegated to shared/explicit-formula.js; this file only maps numbers to geometry.

import * as THREE from 'three';
import { state } from '../state.js';
import { ZETA_ZEROS_1000 as ZETA_ZEROS } from '../../shared/zeta-zeros-1000.js';
import { buildSieve } from '../../shared/sieve.js';
import {
    buildPsiTables, computeExplicitBase, computeExplicitRecon, rmsDiff,
    compressedOffset, compressionRef, SCHOENFELD_X0,
} from '../../shared/explicit-formula.js';
import { isWorkerReady, requestExplicit, cancelExplicitRequests, onWorkerFailure } from '../worker-client.js';
import { computeZetaOffsets } from './zeta.js';

export const EXPLICIT_SAMPLES = 1600;
export const EXPLICIT_SAMPLES_FALLBACK = 400;
const TURNS = 6, R0 = 600, R1 = 2200, H = 1300, AMP = 220;
const TUBE_SEGMENTS = 16, RIBBON_HALF_WIDTH = 28;
const RESIDUAL_FULL = 0.25 * AMP; // residual (display units) mapped to the "hot" colour
const DEFAULT_N = 100;
const COL_BASE = new THREE.Color(0xffaa33), COL_HOT = new THREE.Color(0xff2d55);

let group = null;
let token = 0;            // bumps on every full rebuild / exit; stale async results are dropped
let cache = null;         // { xMax, M, fallback, xs, meas, bound, head, frames, dMeas, shell }
let reconSeq = 0;
let prevPointsVisible = true;
let savedZetaN = null;    // zetaZeroCount at entry, restored on exit
let syncTables = null;    // { max, tables } for the fallback path

// Analytic frame on the cone spiral at log-progress u in [0,1]: position P, normal n (radial, outward,
// orthogonalised against the tangent) and binormal b = T x n.
function frameAt(u) {
    const th = 2 * Math.PI * TURNS * u, r = R0 + (R1 - R0) * u, h = -H + 2 * H * u;
    const c = Math.cos(th), s = Math.sin(th);
    const dth = 2 * Math.PI * TURNS, dr = R1 - R0;
    let T = new THREE.Vector3(dr * c - r * dth * s, 2 * H, dr * s + r * dth * c).normalize();
    const nr = new THREE.Vector3(c, 0, s);
    const n = nr.sub(T.clone().multiplyScalar(nr.dot(T))).normalize();
    const b = new THREE.Vector3().crossVectors(T, n);
    return { P: new THREE.Vector3(r * c, h, r * s), n, b };
}

function disposeGroup() {
    if (!group) return;
    group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
    });
    if (group.parent) group.parent.remove(group);
    group = null;
}

function setStatus(text) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('explicit-status');
    if (el) el.textContent = text;
}

function publish(extra) {
    state.explicitInfo = { ...(state.explicitInfo || {}), ...extra };
}

function currentXMax() { return Math.max(3, Math.floor(state.activePointCount)); }

function getSyncTables(xMax) {
    if (!syncTables || syncTables.max < xMax) {
        const { spf } = buildSieve(xMax);
        syncTables = { max: xMax, tables: buildPsiTables(xMax, spf) };
    }
    return syncTables.tables;
}

// ---- geometry ------------------------------------------------------------

function buildStaticGeometry(base, xMax, M) {
    const { xs, meas, bound, head } = base;
    const hasShell = xMax > SCHOENFELD_X0;
    const lnSpan = Math.log(xMax / 2);
    const uOf = x => Math.log(x / 2) / lnSpan;

    // y_ref from B(xMax) (or the measured maximum when no bound applies at this xMax)
    let yRef;
    if (hasShell) {
        yRef = compressionRef(bound[M - 1], xMax);
    } else {
        let mx = 0;
        for (let i = 0; i < M; i++) mx = Math.max(mx, Math.abs(meas[i]) / (xs[i] * Math.sqrt(xs[i])));
        yRef = Math.max(compressionRef(mx * xMax * Math.sqrt(xMax), xMax), 1e-9);
    }

    const frames = new Array(M), dMeas = new Float64Array(M);
    const axis = new Float32Array(M * 3), mpos = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
        const f = frames[i] = frameAt(uOf(xs[i]));
        dMeas[i] = compressedOffset(meas[i], xs[i], yRef, AMP);
        axis[i * 3] = f.P.x; axis[i * 3 + 1] = f.P.y; axis[i * 3 + 2] = f.P.z;
        const q = f.P.clone().addScaledVector(f.n, dMeas[i]);
        mpos[i * 3] = q.x; mpos[i * 3 + 1] = q.y; mpos[i * 3 + 2] = q.z;
    }

    const line = (pos, color, opacity = 1) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
    };
    const axisLine = line(axis, 0x777777, 0.8); axisLine.name = 'explicit-axis';
    const measLine = line(mpos, 0x00f2ff); measLine.name = 'explicit-measured';
    group.add(axisLine, measLine);

    // Shell: rings at x = 73.2 (boundary) and every sample with x > 73.2.
    let shell = null;
    if (hasShell) {
        const shellX = [SCHOENFELD_X0], shellD = [compressedOffset(head, SCHOENFELD_X0, yRef, AMP)];
        const shellF = [frameAt(uOf(SCHOENFELD_X0))];
        for (let i = 0; i < M; i++) {
            if (xs[i] > SCHOENFELD_X0) {
                shellX.push(xs[i]);
                shellD.push(compressedOffset(bound[i], xs[i], yRef, AMP));
                shellF.push(frames[i]);
            }
        }
        const R = shellX.length, S = TUBE_SEGMENTS;
        const pos = new Float32Array(R * S * 3);
        for (let j = 0; j < R; j++) {
            const f = shellF[j], d = shellD[j];
            for (let k = 0; k < S; k++) {
                const a = 2 * Math.PI * k / S;
                const q = f.P.clone().addScaledVector(f.n, d * Math.cos(a)).addScaledVector(f.b, d * Math.sin(a));
                const o = (j * S + k) * 3;
                pos[o] = q.x; pos[o + 1] = q.y; pos[o + 2] = q.z;
            }
        }
        const idx = [];
        for (let j = 0; j < R - 1; j++) for (let k = 0; k < S; k++) {
            const a = j * S + k, b = j * S + (k + 1) % S, c = (j + 1) * S + k, d = (j + 1) * S + (k + 1) % S;
            idx.push(a, c, b, b, c, d);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setIndex(idx);
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
            color: 0x8866ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
        }));
        mesh.name = 'explicit-shell';
        // Boundary ring at x = 73.2: the first ring of the tube, drawn as an opaque loop.
        const ringPos = pos.slice(0, S * 3);
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
        const ring = new THREE.LineLoop(rg, new THREE.LineBasicMaterial({ color: 0xffffff }));
        ring.name = 'explicit-boundary-ring';
        group.add(mesh, ring);
        shell = { shellX: Float64Array.from(shellX), rings: R, segments: S };
    }
    return { frames, dMeas, yRef, shell };
}

// Ribbon along the base curve at the reconstruction offset, colour = residual vs. measured.
function updateRibbon(recon) {
    const c = cache, M = c.xs.length;
    let pos, col, geom = group.getObjectByName('explicit-ribbon');
    const first = !geom;
    if (first) {
        pos = new Float32Array(M * 2 * 3); col = new Float32Array(M * 2 * 3);
    } else {
        pos = geom.geometry.attributes.position.array; col = geom.geometry.attributes.color.array;
    }
    const tmp = new THREE.Color(), q = new THREE.Vector3();
    for (let i = 0; i < M; i++) {
        const f = c.frames[i];
        const dRec = compressedOffset(recon[i], c.xs[i], c.yRef, AMP);
        const t = Math.min(1, Math.abs(dRec - c.dMeas[i]) / RESIDUAL_FULL);
        tmp.copy(COL_BASE).lerp(COL_HOT, t);
        for (let side = 0; side < 2; side++) {
            q.copy(f.P).addScaledVector(f.n, dRec).addScaledVector(f.b, side ? RIBBON_HALF_WIDTH : -RIBBON_HALF_WIDTH);
            const o = (i * 2 + side) * 3;
            pos[o] = q.x; pos[o + 1] = q.y; pos[o + 2] = q.z;
            col[o] = tmp.r; col[o + 1] = tmp.g; col[o + 2] = tmp.b;
        }
    }
    if (first) {
        const idx = [];
        for (let i = 0; i < M - 1; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setIndex(idx);
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        mesh.name = 'explicit-ribbon';
        group.add(mesh);
    } else {
        geom.geometry.attributes.position.needsUpdate = true;
        geom.geometry.attributes.color.needsUpdate = true;
    }
}

// ---- computation orchestration -------------------------------------------

function applyRecon(recon, N, myToken) {
    if (myToken !== token || !group || !cache) return;
    updateRibbon(recon);
    reconSeq++;
    publish({
        N, rms: rmsDiff(recon, cache.meas), reconSeq, pending: false,
    });
}

async function computeRecon(N, myToken) {
    const c = cache;
    if (!c) return;
    publish({ pending: true });
    let recon;
    if (c.fallback) {
        recon = computeExplicitRecon(c.xs, N, ZETA_ZEROS);
    } else {
        let m;
        try {
            m = await requestExplicit({ type: 'explicit_recon', xMax: c.xMax, M: c.M, N });
        } catch (e) {
            return;                           // worker died: the failure handler rebuilds in fallback
        }
        if (!m) return;                       // superseded
        recon = m.recon;
    }
    // A newer N may have been requested meanwhile; only the latest N is applied.
    if (N !== currentN()) return;
    applyRecon(recon, N, myToken);
}

function currentN() { return Math.max(0, Math.min(state.zetaZeroCount | 0, ZETA_ZEROS.length)); }

async function fullRebuild() {
    const myToken = ++token;
    cancelExplicitRequests();
    cache = null;
    if (group) disposeGroup();
    group = new THREE.Group();
    group.name = 'explicit-group';
    state.scene.add(group);

    const xMax = currentXMax();
    const fallback = !isWorkerReady();
    const M = fallback ? EXPLICIT_SAMPLES_FALLBACK : EXPLICIT_SAMPLES;
    publish({ M, xMax, fallback, pending: true, rms: null, N: null, shell: null });
    setStatus(fallback ? '(fallback mode: reduced samples)' : 'computing…');

    let base;
    if (fallback) {
        base = computeExplicitBase(xMax, M, getSyncTables(xMax));
    } else {
        try {
            const m = await requestExplicit({ type: 'explicit_base', xMax, M });
            if (!m) return;
            base = m;
        } catch (e) {
            // worker died: the failure handler starts a fallback rebuild (which bumps the token)
            console.error('explicit mode: worker request failed', e);
            return;
        }
    }
    if (myToken !== token || !group) return;

    const geo = buildStaticGeometry(base, xMax, M);
    cache = { xMax, M, fallback, xs: base.xs, meas: base.meas, bound: base.bound, head: base.head, ...geo };
    publish({
        shell: geo.shell, shellX: geo.shell ? geo.shell.shellX : new Float64Array(0), yRef: geo.yRef,
        samples: base.xs.length,
    });
    setStatus(fallback ? '(fallback mode: reduced samples)' : `M=${M}, x ∈ [2, ${xMax.toLocaleString()}]`);
    await computeRecon(currentN(), myToken);
}

function syncNControl() {
    if (typeof document === 'undefined') return;
    const slider = document.getElementById('zeta-n-slider');
    const val = document.getElementById('zeta-n-val');
    const note = document.getElementById('zeta-n-note');
    if (slider) { slider.max = String(ZETA_ZEROS.length); slider.value = String(state.zetaZeroCount); }
    if (val) val.innerText = state.zetaZeroCount;
    if (note) note.textContent = '';
}

// Zeta Wave is off: just put the shared slider/label back to the restored N.
function syncZetaNRestore() {
    if (typeof document === 'undefined') return;
    const slider = document.getElementById('zeta-n-slider');
    const val = document.getElementById('zeta-n-val');
    if (slider) slider.value = String(state.zetaZeroCount);
    if (val) val.innerText = state.zetaZeroCount;
}

// Worker died after startup: drop the ribbon work and redo it on the main thread (M=400).
onWorkerFailure(() => {
    if (state.explicitModeActive) fullRebuild();
});

export const explicitMode = {
    id: 'explicit',
    kind: 'owner',
    enter() {
        state.explicitModeActive = true;
        savedZetaN = state.zetaZeroCount;
        // Pause the Zeta Wave's own N-driven work (animation); its recompute is gated in computeZetaOffsets.
        if (state.zetaAnimating) {
            state.zetaAnimating = false;
            clearTimeout(state.zetaAnimFrame);
            if (typeof document !== 'undefined') {
                const b = document.getElementById('zeta-anim-btn');
                if (b) b.textContent = 'Animate';
            }
        }
        if (!(state.zetaZeroCount > 0)) state.zetaZeroCount = DEFAULT_N;
        state.zetaZeroCount = Math.min(state.zetaZeroCount, ZETA_ZEROS.length);
        syncNControl();
        if (state.points) { prevPointsVisible = state.points.visible; state.points.visible = false; }
        state.explicitInfo = null;
        fullRebuild();
    },
    exit() {
        state.explicitModeActive = false;
        token++;
        cancelExplicitRequests();
        cache = null;
        disposeGroup();
        state.explicitInfo = null;
        if (state.points) state.points.visible = prevPointsVisible;
        setStatus('');
        // Hand N back to the Zeta Wave exactly as it was, and resync it if it is still on.
        if (savedZetaN != null) { state.zetaZeroCount = savedZetaN; savedZetaN = null; }
        if (state.zetaModeActive) computeZetaOffsets(state.zetaZeroCount);
        else syncZetaNRestore();
    },
    // N slider: only the reconstruction ribbon is recomputed (measured + shell stay cached).
    onNChange() {
        if (!state.explicitModeActive || !cache) return;   // no cache yet: fullRebuild reads the latest N
        syncNControl();
        computeRecon(currentN(), token);
    },
    onCountChange() {
        if (state.explicitModeActive) fullRebuild();
    },
};
