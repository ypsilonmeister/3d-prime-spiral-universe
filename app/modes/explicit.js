// Explicit-formula mode plugin (owner): psi1(x) - x^2/2 (default) or psi(x) - x on a log-spaced conical spiral.
// View A draws (all through the same two-stage compression, see shared/explicit-formula.js compressedOffset):
//   grey axis, measured curve (cyan), N-zero reconstruction ribbon (warm, vertex colour = residual),
//   and the shell +-B(x) (Schoenfeld bound; RH ASSUMED, x >= 73.2 only) with a boundary ring at x = 73.2.
// View B draws only the reference axis and the truncation-residual ribbon (measured - reconstructed) and hides
// the RH error shell automatically (the bound applies to the true fluctuation, not to the truncation residual).
// All math is delegated to shared/explicit-formula.js; this file only maps numbers to geometry and HUD text.

import * as THREE from 'three';
import { state } from '../state.js';
import { ZETA_ZEROS_1000 as ZETA_ZEROS } from '../../shared/zeta-zeros-1000.js';
import { buildSieve } from '../../shared/sieve.js';
import {
    buildPsiTables, buildZetaDenom, computeExplicitBase, computeExplicitRecon,
    computeExplicitResidual, computeExplicitHud, compressedOffset, compressionRef,
    explicitScaleParams, SCHOENFELD_X0,
} from '../../shared/explicit-formula.js';
import { isWorkerReady, requestExplicit, cancelExplicitRequests, cancelPendingZetaRequests, onWorkerFailure } from '../worker-client.js';
import { DEFAULT_PAGE_TITLE, RH_PAGE_TITLE, buildCleanExitUrl } from '../launch-options.js';
import { computeZetaOffsets } from './zeta.js';
import { stopZetaAnimation, runZetaAnimation, zetaAnimTarget, zetaAnimN } from './zeta-anim.js';

export const EXPLICIT_SAMPLES = 1600;
export const EXPLICIT_SAMPLES_FALLBACK = 400;
const TURNS = 6, R0 = 600, R1 = 2200, H = 1300, AMP = 220;
const TUBE_SEGMENTS = 16, RIBBON_HALF_WIDTH = 28;
const RESIDUAL_FULL = 0.25 * AMP; // residual (display units) mapped to the "hot" colour
const DEFAULT_N = 100;
const COL_BASE = new THREE.Color(0xffaa33), COL_HOT = new THREE.Color(0xff2d55);
const PRIME_MARKER_COLOR = 0xf4f7ff; // crisp off-white, distinct from cyan / warm / magenta / violet
const PRIME_MARKER_SIZE = 16;
const PRIME_MARKER_OPACITY = 0.85;

let group = null;
let token = 0;            // bumps on every full rebuild / exit; stale async results are dropped
let cache = null;         // { xMax, M, kind, fallback, xs, meas, bound, head, boundAtX0, frames, dMeas, yRef, shell, recon, residual, N }
let reconSeq = 0;
let prevPointsVisible = true;
let savedAnim = null;     // { n, target } of a Zeta animation running at entry, resumed on exit
let savedZetaN = null;    // zetaZeroCount at entry, restored on exit
let launchedFromUrl = false; // true when entered via ?mode=explicit launch path
let syncTables = null;    // { max, tables } for the fallback path
let syncDenom = null;     // cached buildZetaDenom(ZETA_ZEROS) for the fallback psi path

// Analytic point on the reference cone spiral C(u) for x in [2, xMax] using the same log mapping as samples.
export function explicitAxisPoint(x, xMax) {
    const u = Math.log(x / 2) / Math.log(xMax / 2);
    const th = 2 * Math.PI * TURNS * u, r = R0 + (R1 - R0) * u, h = -H + 2 * H * u;
    return { x: r * Math.cos(th), y: h, z: r * Math.sin(th), u, r, h };
}

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

function disposeMaterial(mat) {
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
        for (const key of Object.keys(m)) {
            const val = m[key];
            if (val && typeof val === 'object' && val.isTexture) val.dispose();
        }
        m.dispose();
    }
}

function disposeGroup() {
    if (!group) return;
    group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) disposeMaterial(o.material);
    });
    group.clear();
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
function currentKind() { return state.explicitKind === 'psi' ? 'psi' : 'psi1'; }
function currentView() { return state.explicitView === 'b' ? 'b' : 'a'; }

function getSyncTables(xMax) {
    if (!syncTables || syncTables.max < xMax) {
        const { spf } = buildSieve(xMax);
        syncTables = { max: xMax, tables: buildPsiTables(xMax, spf) };
    }
    return syncTables.tables;
}

function getSyncDenom() {
    if (!syncDenom) syncDenom = buildZetaDenom(ZETA_ZEROS);
    return syncDenom;
}

function isShellVisible() {
    if (!group) return false;
    const shell = group.getObjectByName('explicit-shell');
    return !!(shell && shell.visible);
}

function isPrimesVisible() {
    if (!group) return false;
    const primes = group.getObjectByName('explicit-primes');
    return !!(primes && primes.visible);
}

function applyViewVisibility() {
    if (!group) return;
    const showA = currentView() === 'a';
    const measObj = group.getObjectByName('explicit-measured');
    if (measObj) measObj.visible = showA;
    const shellObj = group.getObjectByName('explicit-shell');
    if (shellObj) shellObj.visible = showA;
    const ringObj = group.getObjectByName('explicit-boundary-ring');
    if (ringObj) ringObj.visible = showA;
}

function applyPrimesVisibility() {
    if (!group) return;
    const primes = group.getObjectByName('explicit-primes');
    if (primes) primes.visible = !!state.explicitShowPrimes;
}

// ---- HUD & panel DOM sync ------------------------------------------------

export function formatHudNumber(v) {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e6 || (abs > 0 && abs < 1e-2)) return v.toExponential(3);
    return v.toFixed(2);
}

export function formatHudX(x) {
    if (!Number.isFinite(x)) return { op: '=', text: '—' };
    if (Number.isInteger(x)) return { op: '=', text: x.toLocaleString('en-US') };
    // Use ECMAScript's shortest exact IEEE-754 decimal round-trip representation (String(x))
    // so parsing the displayed x back with Number() recovers the exact internal Float64 value,
    // never crosses an integer jump discontinuity of psi(x), and reproduces every HUD row
    // at display precision without rounding drift.
    const s = String(x);
    if (/[eE]/.test(s)) return { op: '=', text: s };
    const [intPart, fracPart] = s.split('.');
    const sign = intPart.startsWith('-') ? '-' : '';
    const absInt = sign ? intPart.slice(1) : intPart;
    const intFmt = sign + absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const text = fracPart ? `${intFmt}.${fracPart}` : intFmt;
    const parsed = Number(text.replace(/,/g, ''));
    return { op: parsed === x ? '=' : '≈', text };
}

function setSegButton(id, active) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function renderExplicitPanel() {
    if (typeof document === 'undefined') return;
    const kind = currentKind();
    const view = currentView();
    const isPsi = kind === 'psi';
    const isViewB = view === 'b';
    const boundSym = isPsi ? 'B(x)' : 'B₁(x)';
    const fluctLabel = isPsi ? 'ψ(x) − x' : 'ψ₁(x) − x²/2';

    setSegButton('explicit-kind-psi1', !isPsi);
    setSegButton('explicit-kind-psi', isPsi);
    setSegButton('explicit-view-a', !isViewB);
    setSegButton('explicit-view-b', isViewB);

    const showPrimes = !!state.explicitShowPrimes;
    const swPrimes = document.getElementById('sw-explicit-primes');
    if (swPrimes) {
        swPrimes.classList.toggle('on', showPrimes);
        swPrimes.setAttribute('aria-checked', showPrimes ? 'true' : 'false');
    }
    const legPrimes = document.getElementById('explicit-legend-primes');
    if (legPrimes) {
        legPrimes.style.opacity = showPrimes ? '1' : '0.4';
    }

    const gibbs = document.getElementById('explicit-gibbs-note');
    if (gibbs) gibbs.hidden = !isPsi;

    const legMeas = document.getElementById('explicit-legend-measured');
    if (legMeas) {
        legMeas.style.opacity = isViewB ? '0.4' : '1';
        legMeas.innerHTML = `<span style="color:#00f2ff" aria-hidden="true">━</span> 実測 ${fluctLabel}${isViewB ? '（ビュー B 非表示）' : ''}`;
    }
    const legRibbon = document.getElementById('explicit-legend-ribbon');
    if (legRibbon) {
        legRibbon.innerHTML = isViewB
            ? '<span style="color:#ffaa33" aria-hidden="true">━</span> 打ち切り残差（実測 − 再構成）（色＝残差の大きさ）'
            : '<span style="color:#ffaa33" aria-hidden="true">━</span> N 個の零点による再構成（色＝残差の大きさ）';
    }
    const legShell = document.getElementById('explicit-legend-shell');
    if (legShell) {
        legShell.style.opacity = isViewB ? '0.45' : '1';
        legShell.innerHTML = isViewB
            ? `<span style="color:#8866ff" aria-hidden="true">◯</span> 誤差上限（RH を仮定した場合）±${boundSym}：ビュー B では自動非表示（上限は真のゆらぎ用）`
            : `<span style="color:#8866ff" aria-hidden="true">◯</span> 誤差上限（RH を仮定した場合）±${boundSym}、x ≥ 73.2`;
    }

    const scaleNote = document.getElementById('explicit-scale-note');
    if (scaleNote) {
        const { scale } = explicitScaleParams(kind);
        const denomStr = isPsi ? '√x' : 'x^{3/2}';
        scaleNote.textContent =
            `表示は圧縮スケール：v/${denomStr} で正規化後 asinh(u/${scale}) 圧縮。長さは誤差に比例せず、|v| ≤ ${boundSym} の大小関係のみ保存されます。`;
    }

    const hudEl = document.getElementById('explicit-hud');
    if (!hudEl) return;
    if (!state.explicitModeActive) {
        hudEl.textContent = '';
        return;
    }
    const info = state.explicitInfo;
    if (!info || !info.hud || !info.hud.samples || info.hud.samples.length === 0) {
        hudEl.textContent = '数値 HUD: 計算中…';
        return;
    }
    const hud = info.hud;
    const viewLabel = isViewB ? 'ビュー B (残差)' : 'ビュー A (全体)';
    const kindLabel = isPsi ? 'ψ' : 'ψ₁';
    const boundRowLabel = isViewB ? `上限 ${boundSym} (RH仮定・殻非表示)` : `上限 ${boundSym} (RH仮定)`;

    const blocks = hud.samples.map(s => {
        const tag = s.label === 'mid' ? '中間サンプル' : '最大サンプル';
        const boundText = Number.isFinite(s.bound) ? formatHudNumber(s.bound) : '— (x < 73.2)';
        const rows = isViewB
            ? [
                ['残差 (実測−再構成)', formatHudNumber(s.residual), s.residual, true],
                ['実測のゆらぎ', formatHudNumber(s.measured), s.measured, false],
                ['再構成値', formatHudNumber(s.recon), s.recon, false],
                [boundRowLabel, boundText, s.bound, false],
            ]
            : [
                ['実測のゆらぎ', formatHudNumber(s.measured), s.measured, false],
                ['再構成値', formatHudNumber(s.recon), s.recon, false],
                ['残差 (実測−再構成)', formatHudNumber(s.residual), s.residual, false],
                [boundRowLabel, boundText, s.bound, false],
            ];
        const rowsHtml = rows.map(([k, text, raw, primary]) =>
            `<div class="explicit-hud-row${primary ? ' primary' : ''}"><span>${k}</span><span class="explicit-hud-val" data-raw="${Number.isFinite(raw) ? raw : 'NaN'}">${text}</span></div>`
        ).join('');
        const fx = formatHudX(s.x);
        return `<div class="explicit-hud-sample" data-sample="${s.label}"><div class="explicit-hud-x" data-raw-x="${s.x}">${tag}: x ${fx.op} ${fx.text}</div>${rowsHtml}</div>`;
    }).join('');

    hudEl.innerHTML =
        `<div class="explicit-hud-head">${kindLabel} / N=${info.N} / ${viewLabel}</div>` +
        `<div class="explicit-hud-row"><span>RMS (残差)</span><span class="explicit-hud-val" data-raw="${hud.rms}">${formatHudNumber(hud.rms)}</span></div>` +
        blocks;
}

// ---- geometry ------------------------------------------------------------

// Prime markers on the reference axis C(u) for all primes p in [2, xMax],
// read directly from the app's existing prime table (state.isPrimeArray — no sieve duplication).
function buildPrimeMarkers(xMax, uOf) {
    const isPrime = state.isPrimeArray;
    const limit = isPrime ? Math.min(xMax, isPrime.length - 1) : 0;
    let count = 0;
    for (let p = 2; p <= limit; p++) if (isPrime[p]) count++;
    const pos = new Float32Array(count * 3);
    let k = 0;
    for (let p = 2; p <= limit; p++) {
        if (!isPrime[p]) continue;
        const u = uOf(p);
        const th = 2 * Math.PI * TURNS * u, r = R0 + (R1 - R0) * u, h = -H + 2 * H * u;
        pos[k++] = r * Math.cos(th);
        pos[k++] = h;
        pos[k++] = r * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
        color: PRIME_MARKER_COLOR,
        size: PRIME_MARKER_SIZE,
        sizeAttenuation: true,
        transparent: true,
        opacity: PRIME_MARKER_OPACITY,
        depthWrite: false,
    });
    const pts = new THREE.Points(g, m);
    pts.name = 'explicit-primes';
    pts.visible = !!state.explicitShowPrimes;
    return { points: pts, count };
}

function buildStaticGeometry(base, xMax, M, kind) {
    const { xs, meas, bound, boundAtX0 } = base;
    const { norm } = explicitScaleParams(kind);
    const hasShell = xMax > SCHOENFELD_X0;
    const lnSpan = Math.log(xMax / 2);
    const uOf = x => Math.log(x / 2) / lnSpan;

    // y_ref from B(xMax) (or the measured maximum when no bound applies at this xMax)
    let yRef;
    if (hasShell) {
        yRef = compressionRef(bound[M - 1], xMax, kind);
    } else {
        let mx = 0;
        for (let i = 0; i < M; i++) mx = Math.max(mx, Math.abs(meas[i]) / norm(xs[i]));
        yRef = Math.max(compressionRef(mx * norm(xMax), xMax, kind), 1e-9);
    }

    const frames = new Array(M), dMeas = new Float64Array(M);
    const axis = new Float32Array(M * 3), mpos = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
        const f = frames[i] = frameAt(uOf(xs[i]));
        dMeas[i] = compressedOffset(meas[i], xs[i], yRef, AMP, kind);
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
    const primeMarkers = buildPrimeMarkers(xMax, uOf);
    group.add(axisLine, measLine, primeMarkers.points);

    // Shell: rings at x = 73.2 (boundary) and every sample with x > 73.2.
    let shell = null;
    if (hasShell) {
        const shellX = [SCHOENFELD_X0], shellD = [compressedOffset(boundAtX0, SCHOENFELD_X0, yRef, AMP, kind)];
        const shellF = [frameAt(uOf(SCHOENFELD_X0))];
        for (let i = 0; i < M; i++) {
            if (xs[i] > SCHOENFELD_X0) {
                shellX.push(xs[i]);
                shellD.push(compressedOffset(bound[i], xs[i], yRef, AMP, kind));
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
    applyViewVisibility();
    applyPrimesVisibility();
    return { frames, dMeas, yRef, shell, primeCount: primeMarkers.count };
}

// Ribbon along the base curve:
//   View A: reconstruction offset, colour = residual vs. measured.
//   View B: truncation residual (measured - reconstructed) offset, colour = |residual| in display units.
function updateRibbon(recon, residual) {
    const c = cache, M = c.xs.length;
    const isViewB = currentView() === 'b';
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
        const dOff = isViewB
            ? compressedOffset(residual[i], c.xs[i], c.yRef, AMP, c.kind)
            : compressedOffset(recon[i], c.xs[i], c.yRef, AMP, c.kind);
        const t = isViewB
            ? Math.min(1, Math.abs(dOff) / RESIDUAL_FULL)
            : Math.min(1, Math.abs(dOff - c.dMeas[i]) / RESIDUAL_FULL);
        tmp.copy(COL_BASE).lerp(COL_HOT, t);
        for (let side = 0; side < 2; side++) {
            q.copy(f.P).addScaledVector(f.n, dOff).addScaledVector(f.b, side ? RIBBON_HALF_WIDTH : -RIBBON_HALF_WIDTH);
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
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        mesh.name = 'explicit-ribbon';
        group.add(mesh);
    } else {
        geom.geometry.attributes.position.needsUpdate = true;
        geom.geometry.attributes.color.needsUpdate = true;
        geom.geometry.computeBoundingSphere();
        if (geom.geometry.boundingBox) geom.geometry.computeBoundingBox();
    }
}

// ---- computation orchestration -------------------------------------------

function applyRecon(recon, N, myToken) {
    if (myToken !== token || !group || !cache) return;
    const residual = computeExplicitResidual(cache.meas, recon);
    cache.recon = recon;
    cache.residual = residual;
    cache.N = N;
    updateRibbon(recon, residual);
    const hud = computeExplicitHud(cache.xs, cache.meas, recon, cache.bound, residual);
    reconSeq++;
    publish({
        kind: cache.kind, view: currentView(), N, rms: hud.rms, hud,
        shellVisible: isShellVisible(), reconSeq, pending: false,
    });
    renderExplicitPanel();
}

async function computeRecon(N, myToken) {
    const c = cache;
    if (!c) return;
    publish({ pending: true });
    let recon;
    if (c.fallback) {
        recon = computeExplicitRecon(c.xs, N, ZETA_ZEROS, c.kind, getSyncDenom());
    } else {
        let m;
        try {
            m = await requestExplicit({ type: 'explicit_recon', xMax: c.xMax, M: c.M, N, formulaKind: c.kind });
        } catch (e) {
            return;                           // worker died: the failure handler rebuilds in fallback
        }
        if (!m) return;                       // superseded
        recon = m.recon;
    }
    // A newer rebuild or N may have been requested meanwhile; only the latest is applied.
    if (myToken !== token || N !== currentN()) return;
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
    const kind = currentKind();
    const view = currentView();
    const fallback = !isWorkerReady();
    const M = fallback ? EXPLICIT_SAMPLES_FALLBACK : EXPLICIT_SAMPLES;
    publish({
        M, xMax, kind, view, fallback, pending: true, rms: null, N: null, hud: null,
        shell: null, shellVisible: false, primeCount: 0, primesVisible: false,
    });
    setStatus(fallback ? '(fallback mode: reduced samples)' : 'computing…');
    renderExplicitPanel();

    let base;
    if (fallback) {
        base = computeExplicitBase(xMax, M, getSyncTables(xMax), kind);
    } else {
        try {
            const m = await requestExplicit({ type: 'explicit_base', xMax, M, formulaKind: kind });
            if (!m) return;
            base = m;
        } catch (e) {
            // worker died: the failure handler starts a fallback rebuild (which bumps the token)
            console.error('explicit mode: worker request failed', e);
            return;
        }
    }
    if (myToken !== token || !group) return;

    const geo = buildStaticGeometry(base, xMax, M, kind);
    cache = {
        xMax, M, kind, fallback,
        xs: base.xs, meas: base.meas, bound: base.bound, head: base.head, boundAtX0: base.boundAtX0,
        ...geo, recon: null, residual: null, N: null,
    };
    publish({
        shell: geo.shell, shellX: geo.shell ? geo.shell.shellX : new Float64Array(0), yRef: geo.yRef,
        samples: base.xs.length, shellVisible: isShellVisible(),
        primeCount: geo.primeCount, primesVisible: isPrimesVisible(),
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
    enter(opts = {}) {
        state.explicitModeActive = true;
        launchedFromUrl = Boolean(opts && opts.fromLaunch);
        if (launchedFromUrl && typeof document !== 'undefined') {
            document.title = RH_PAGE_TITLE;
        }
        savedZetaN = state.zetaZeroCount;
        // Cancel any in-flight Zeta worker computation so explicit_base/recon are not blocked
        // behind a long Zeta run (which could otherwise hit EXPLICIT_TIMEOUT_MS and terminate the worker).
        cancelPendingZetaRequests();
        // Pause the Zeta Wave's own N-driven work (animation); its recompute is gated in computeZetaOffsets.
        savedAnim = null;
        if (state.zetaAnimating) {
            savedAnim = { n: zetaAnimN(), target: zetaAnimTarget() };
            stopZetaAnimation();
        }
        if (!(state.zetaZeroCount > 0)) state.zetaZeroCount = DEFAULT_N;
        state.zetaZeroCount = Math.min(state.zetaZeroCount, ZETA_ZEROS.length);
        syncNControl();
        if (state.points) { prevPointsVisible = state.points.visible; state.points.visible = false; }
        state.explicitInfo = null;
        fullRebuild();
    },
    // opts.willRebuild: the caller rebuilds the lattice (and the Zeta Wave) right after, so don't recompute here.
    exit(opts = {}) {
        state.explicitModeActive = false;
        const wasLaunchedFromUrl = launchedFromUrl;
        launchedFromUrl = false;
        token++;
        cancelExplicitRequests();
        cache = null;
        disposeGroup();
        state.explicitInfo = null;
        if (state.points) state.points.visible = prevPointsVisible;
        setStatus('');
        renderExplicitPanel();
        if (wasLaunchedFromUrl) {
            if (typeof document !== 'undefined') {
                document.title = DEFAULT_PAGE_TITLE;
            }
            if (typeof window !== 'undefined' && window.history && typeof window.history.replaceState === 'function') {
                window.history.replaceState(null, '', buildCleanExitUrl(window.location));
            }
        }
        // Hand N back to the Zeta Wave exactly as it was, and resync it if it is still on.
        if (savedZetaN != null) { state.zetaZeroCount = savedZetaN; savedZetaN = null; }
        const anim = savedAnim; savedAnim = null;
        if (anim && state.zetaModeActive) {
            // resume the sweep where it was paused (the lattice rebuild applies the current N)
            runZetaAnimation(anim.n, anim.target, { apply: false });
            if (!opts.willRebuild) computeZetaOffsets(anim.n);
        } else if (state.zetaModeActive) {
            if (!opts.willRebuild) computeZetaOffsets(state.zetaZeroCount);
        } else syncZetaNRestore();
    },
    // N slider: only reconstruction and residual are recomputed (measured + shell stay cached).
    onNChange() {
        if (!state.explicitModeActive || !cache) return;   // no cache yet: fullRebuild reads the latest N
        syncNControl();
        computeRecon(currentN(), token);
    },
    onCountChange() {
        if (state.explicitModeActive) fullRebuild();
    },
    setKind(kind) {
        const next = kind === 'psi' ? 'psi' : 'psi1';
        if (state.explicitKind === next) return;
        state.explicitKind = next;
        renderExplicitPanel();
        if (state.explicitModeActive) fullRebuild();
    },
    setView(view) {
        const next = view === 'b' ? 'b' : 'a';
        if (state.explicitView === next) return;
        state.explicitView = next;
        if (state.explicitModeActive) {
            applyViewVisibility();
            if (cache && cache.recon && cache.residual) {
                updateRibbon(cache.recon, cache.residual);
                const hud = computeExplicitHud(cache.xs, cache.meas, cache.recon, cache.bound, cache.residual);
                publish({ view: next, shellVisible: isShellVisible(), hud });
            } else {
                publish({ view: next, shellVisible: isShellVisible() });
            }
        }
        renderExplicitPanel();
    },
    setShowPrimes(show) {
        const next = !!show;
        if (state.explicitShowPrimes === next) return;
        state.explicitShowPrimes = next;
        if (state.explicitModeActive) {
            applyPrimesVisibility();
            publish({ primesVisible: isPrimesVisible() });
        }
        renderExplicitPanel();
    },
};
