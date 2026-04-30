import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Debounce / rAF-throttle helpers ---
// rafThrottle: 重い計算用 — 連続入力中はpending値を上書きし、次のrAFで一度だけ実行
function rafThrottle(fn) {
    let pending = false;
    let lastArgs = null;
    return (...args) => {
        lastArgs = args;
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            fn(...lastArgs);
        });
    };
}
// debounce: trailing edge — 入力が止まってから delay ms 後に1回だけ実行
function debounce(fn, delay = 80) {
    let timer = null;
    return (...args) => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn(...args); }, delay);
    };
}

// --- Configuration ---
const MAX_POINTS = 320000;
let activePointCount = 320000;
let currentLayout = 'cube';
let currentFillMode = 'shell';
let currentSpacing = 65;
let compositeMode = 'both';
let colorMode = 'spectrum';
let stereoMode = 'off';
let uiVisible = true;
let showLabels = true;
let autoGrow = false;
let growSpeed = 50;
let linearStride = 0;
const targetPositions = new Float32Array(MAX_POINTS * 3);
const lerpSpeed = 0.05;

// --- p-adic Mode ---
let padicModeActive = false;
let padicP = 2;                    // current prime base
let padicAnimating = false;
let padicAnimFrame = null;
let padicColorMode = false;        // highlight p-adic layers
// Pre-computed p-adic valuation v_p(n) per particle; recomputed when p changes
const padicVal = new Int16Array(MAX_POINTS + 1);  // v_p(n): 0..~20
// First 25 primes for the dropdown
const PADIC_PRIMES = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];

// --- Number Theoretic Landscape Mode ---
let ntlModeActive = false;
let ntlFunc = 'd';         // 'd' | 'sigma_ratio' | 'omega' | 'log_sigma' | 'mobius' | 'phi'
let ntlScale = 1.0;        // height multiplier
let ntlHighlightPerfect = false;
let ntlHighlightHC = false;
// Pre-computed tables (filled by worker on startup; let so we can swap in transferred buffers)
let ntl_d     = new Uint16Array(MAX_POINTS + 1);   // divisor count
let ntl_sigma = new Float32Array(MAX_POINTS + 1);  // sigma / n  (ratio)
let ntl_omega = new Uint8Array(MAX_POINTS + 1);    // distinct prime factors
let ntl_mu    = new Int8Array(MAX_POINTS + 1);     // Mobius: -1/0/1
let ntl_phi   = new Uint32Array(MAX_POINTS + 1);   // Euler totient
const ntlOffsets = new Float32Array(MAX_POINTS);     // Z-axis offset per particle
// Highly composite numbers up to 320000
const HC_NUMBERS = new Set([1,2,4,6,12,24,36,48,60,120,180,240,360,720,840,1260,1680,2520,5040,7560,10080,15120,20160,25200,27720,45360,50400,55440,83160,110880,166320,221760,277200,332640]);
const PERFECT_NUMBERS = new Set([6, 28, 496, 8128]);

// --- Worker integration ---
// Sieves and NTL tables are built off the main thread for snappy startup.
// computeZetaOffsets is also delegated so slider input doesn't block the UI.
let _worker = null;
let _workerReady = false;
let _zetaReqId = 0;
let _zetaResolveLast = null;          // resolver for the latest in-flight zeta request

function _setBootStage(text, pct) {
    const stage = document.getElementById('boot-stage');
    const prog  = document.getElementById('boot-progress');
    if (stage && text != null) stage.textContent = text;
    if (prog  && pct   != null) prog.value = pct;
}
function _hideBootOverlay() {
    const ov = document.getElementById('boot-overlay');
    if (!ov) return;
    ov.classList.add('hidden');
    setTimeout(() => { ov.style.display = 'none'; }, 700);
}

function applyPositionOverlays() {
    const limit = Math.max(activePointCount, _maxRenderedCount);
    for (let i = 0; i < limit; i++) {
        targetPositions[i * 3]     = baseTargetPositions[i * 3];
        targetPositions[i * 3 + 1] = baseTargetPositions[i * 3 + 1];
        targetPositions[i * 3 + 2] = baseTargetPositions[i * 3 + 2] + zetaOffsets[i] + ntlOffsets[i];
    }
    lerpActive = true;
}

function cancelPendingZetaRequests() {
    _zetaReqId++;
    if (_zetaResolveLast) {
        _zetaResolveLast(false);
        _zetaResolveLast = null;
    }
}

function initWorker() {
    return new Promise((resolve, reject) => {
        _worker = new Worker('worker.js', { type: 'module' });
        _worker.onerror = (e) => reject(e);
        _worker.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'progress') {
                const stages = {
                    primes:        ['Sieving primes',           0, 15],
                    ntl_d_sigma:   ['Counting divisors',       15, 60],
                    ntl_omega_mu:  ['Factoring (ω, μ)',         60, 88],
                    ntl_phi:       ['Computing totient φ',     88, 98],
                };
                const s = stages[m.stage];
                if (s) {
                    const [label, lo, hi] = s;
                    _setBootStage(label, lo + (hi - lo) * (m.pct / 100));
                }
            } else if (m.type === 'init_done') {
                // Adopt transferred buffers
                isPrimeArray = m.isPrime;
                primeGaps    = m.gaps;
                ntl_d        = m.ntl_d;
                ntl_sigma    = m.ntl_sigma;
                ntl_omega    = m.ntl_omega;
                ntl_mu       = m.ntl_mu;
                ntl_phi      = m.ntl_phi;
                _workerReady = true;
                resolve();
            } else if (m.type === 'zeta_done') {
                // Apply only if it's the latest request (drop stale results)
                if (m.reqId === _zetaReqId) {
                    zetaOffsets = m.offsets;
                    if (_zetaResolveLast) { _zetaResolveLast(true); _zetaResolveLast = null; }
                }
            }
        };
        _worker.postMessage({ type: 'init', maxPoints: MAX_POINTS });
    });
}

// Request a zeta offset recompute. Returns a promise that resolves when the latest request lands.
// Older in-flight requests are abandoned (their reqId won't match).
function requestZetaOffsets(N) {
    if (_zetaResolveLast) {
        _zetaResolveLast(false);
        _zetaResolveLast = null;
    }
    _zetaReqId++;
    const id = _zetaReqId;
    return new Promise(resolve => {
        _zetaResolveLast = ok => resolve(ok === true);
        _worker.postMessage({
            type: 'zeta', reqId: id,
            N, amplitude: zetaAmplitude, spacing: currentSpacing,
        });
    });
}

function computeNTLOffsets() {
    if (!ntlModeActive) { ntlOffsets.fill(0); return; }

    let rawMax = 0;
    for (let n = 1; n <= activePointCount; n++) {
        let v;
        if      (ntlFunc === 'd')           v = ntl_d[n];
        else if (ntlFunc === 'sigma_ratio') v = ntl_sigma[n];
        else if (ntlFunc === 'omega')       v = ntl_omega[n];
        else if (ntlFunc === 'log_sigma')   v = ntl_sigma[n] > 0 ? Math.log(ntl_sigma[n]) : 0;
        else if (ntlFunc === 'mobius')      v = ntl_mu[n];
        else                                v = ntl_phi[n] / n;  // phi ratio
        ntlOffsets[n - 1] = v;
        const a = Math.abs(v);
        if (a > rawMax) rawMax = a;
    }
    // Zero-out any stale entries past activePointCount (keeps applyPositionOverlays clean)
    ntlOffsets.fill(0, activePointCount);

    // Normalize to [0, spacing*scale] range so it's visually readable at any zoom
    const targetMax = currentSpacing * 25 * ntlScale;
    const norm = rawMax > 0 ? targetMax / rawMax : 1;
    for (let i = 0; i < activePointCount; i++) ntlOffsets[i] *= norm;
}

function applyNTLOffsets() {
    applyPositionOverlays();
}

// --- Sieve of Eratosthenes Animation ---
let sieveModeActive = false;
let sievePlaying = false;
let sieveSpeed = 1.0;         // multiplier; controls steps/frame
let sieveCurrentP = 2;        // the prime we are currently sieving multiples of
let sieveNextMultiple = 4;    // next multiple of sieveCurrentP to eliminate
let sieveLimit = 0;           // activePointCount snapshot when mode was entered
let sieveFinished = false;
let sieveFoundCount = 0;      // primes confirmed so far
// Per-particle state: 0=unknown, 1=confirmed prime, 2=eliminated
const sieveState = new Uint8Array(MAX_POINTS + 1);
// Per-particle alpha for fade-out: 1.0=fully visible, 0.0=gone
const sieveAlpha = new Float32Array(MAX_POINTS + 1).fill(1.0);
// Accumulated fractional steps (sub-frame speed accumulator)
let sieveAccum = 0;
// Constant fade speed per frame (fraction of alpha removed)
const SIEVE_FADE_SPEED = 0.04;

function _sieveReset() {
    sievePlaying = false;
    sieveFinished = false;
    sieveCurrentP = 2;
    sieveNextMultiple = 4;
    sieveFoundCount = 0;
    sieveAccum = 0;
    sieveState.fill(0);
    sieveAlpha.fill(1.0);
    sieveState[1] = 2;  // 1 is not prime
    sieveState[2] = 1;  // 2 is the first prime
    sieveFoundCount = 1;
    _sieveFlushVisuals();
    _sieveUpdateStats();
}

// Advance the sieve by exactly one "prime confirmation + start eliminating its multiples"
// Returns true if a new prime was confirmed (used for step button).
// Writes visuals ONLY for cells whose state changed this step (dirty-cell update).
function sieveAdvanceStep() {
    if (sieveFinished) return false;

    // Eliminate all multiples of sieveCurrentP up to sieveLimit (dirty-write each)
    const p = sieveCurrentP;
    for (let m = sieveNextMultiple; m <= sieveLimit; m += p) {
        if (sieveState[m] === 0) {
            sieveState[m] = 2;
            _sieveWriteCell(m);  // mark eliminated — dirty-write
        }
    }

    // Find next prime candidate
    let next = p + 1;
    while (next <= sieveLimit && sieveState[next] !== 0) next++;

    if (next > sieveLimit) {
        // Sieve complete — everything remaining unmarked is prime
        for (let n = 2; n <= sieveLimit; n++) {
            if (sieveState[n] === 0) { sieveState[n] = 1; sieveFoundCount++; _sieveWriteCell(n); }
        }
        sieveFinished = true;
        sievePlaying = false;
        _sieveUpdateUI();
        return false;
    }

    // Confirm next as prime (dirty-write)
    sieveState[next] = 1;
    sieveFoundCount++;
    sieveCurrentP = next;
    sieveNextMultiple = next * 2;
    _sieveWriteCell(next);

    // Optimisation: if p > √sieveLimit all remaining unknowns are prime
    if (next * next > sieveLimit) {
        for (let n = next + 1; n <= sieveLimit; n++) {
            if (sieveState[n] === 0) { sieveState[n] = 1; sieveFoundCount++; _sieveWriteCell(n); }
        }
        sieveFinished = true;
        sievePlaying = false;
        _sieveUpdateUI();
        return true;
    }

    return true;
}

// Single-cell visual write — used by both dirty updates and the full flush
const _sieveTmpColor = new THREE.Color();
function _sieveWriteCell(n) {
    if (!geometry) return;
    const i = n - 1;
    const cols  = geometry.attributes.customColor.array;
    const sizes = geometry.attributes.size.array;
    const alpha = sieveAlpha[n];
    const state = sieveState[n];
    const c = _sieveTmpColor;

    if (state === 2 && alpha <= 0.0) { sizes[i] = 0.0; }
    else if (state === 1) { c.set(0xffd700); sizes[i] = 80.0; cols[i*3]=c.r*alpha; cols[i*3+1]=c.g*alpha; cols[i*3+2]=c.b*alpha; }
    else if (state === 2) { c.setHSL(0.0, 0.9, 0.4 * alpha); sizes[i] = Math.max(0, 40.0 * alpha); cols[i*3]=c.r*alpha; cols[i*3+1]=c.g*alpha; cols[i*3+2]=c.b*alpha; }
    else                  { c.setHSL(0.58, 0.6, 0.35); sizes[i] = 35.0; cols[i*3]=c.r*alpha; cols[i*3+1]=c.g*alpha; cols[i*3+2]=c.b*alpha; }

    geometry.attributes.customColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
}

// Full flush: only used after a Reset / mode switch when all cells need to be repainted at once.
// In normal play, sieveAdvanceStep + _sieveFadeStep update only changed cells.
function _sieveFlushVisuals() {
    if (!sieveModeActive || !geometry) return;
    for (let n = 1; n <= sieveLimit; n++) _sieveWriteCell(n);
    // Hide particles beyond sieveLimit
    const sizes = geometry.attributes.size.array;
    for (let n = sieveLimit + 1; n <= MAX_POINTS; n++) sizes[n - 1] = 0.0;
    geometry.attributes.customColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
}

function _sieveUpdateStats() {
    const el = document.getElementById('sieve-stats');
    if (!el) return;
    if (sieveFinished) {
        el.textContent = `Done — ${sieveFoundCount} primes found`;
        return;
    }
    const sqrtN = Math.floor(Math.sqrt(sieveLimit));
    el.textContent = `Sieving ×${sieveCurrentP} | Primes: ${sieveFoundCount} | √N=${sqrtN}`;
    const prog = document.getElementById('sieve-progress');
    if (prog) prog.value = Math.min(sieveCurrentP / sqrtN, 1.0) * 100;
}

function _sieveUpdateUI() {
    const btn = document.getElementById('sieve-play-btn');
    if (btn) btn.textContent = sievePlaying ? '⏸ Pause' : '▶ Play';
    _sieveUpdateStats();
}

// Called every frame from animate() when sieveModeActive
function sieveTick(dt) {
    if (!sievePlaying || sieveFinished) {
        // Still need to animate fade-outs even when paused
        _sieveFadeStep();
        return;
    }

    // Accumulate time → steps
    // sieveSpeed=1 → ~2 steps/sec; we use a steps/sec = 2^sieveSpeed curve for wide range
    const stepsPerSec = Math.pow(2, sieveSpeed * 3);  // 1x→8/s, 5x→32768/s
    sieveAccum += stepsPerSec * dt;

    let dirty = false;
    let budget = Math.min(Math.ceil(sieveAccum), 2000); // cap per-frame work
    while (sieveAccum >= 1 && !sieveFinished && budget-- > 0) {
        sieveAccum -= 1;
        const advanced = sieveAdvanceStep();
        dirty = true;
        if (!advanced) break;
    }

    _sieveFadeStep();
    if (dirty) _sieveUpdateStats();
}

function _sieveFadeStep() {
    if (!geometry) return;
    let anyFading = false;
    const sizes = geometry.attributes.size.array;
    const cols  = geometry.attributes.customColor.array;
    const color = new THREE.Color();

    for (let n = 1; n <= sieveLimit; n++) {
        if (sieveState[n] !== 2) continue;
        const prev = sieveAlpha[n];
        if (prev <= 0) continue;
        anyFading = true;
        const alpha = Math.max(0, prev - SIEVE_FADE_SPEED);
        sieveAlpha[n] = alpha;
        const i = n - 1;
        color.setHSL(0.0, 0.9, 0.4 * alpha);
        cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
        sizes[i] = Math.max(0, 40.0 * alpha);
    }
    if (anyFading) {
        geometry.attributes.customColor.needsUpdate = true;
        geometry.attributes.size.needsUpdate = true;
    }
}

// --- Prime Dimension Mode ---
let primeDimModeActive = false;
let primeDimP = [2, 3, 5];        // [px, py, pz]
let primeDimOnlyChosen = false;   // show only multiples of chosen primes
// Valuation cache for each of the 3 axes (recomputed when primes change)
const primeDimValX = new Int16Array(MAX_POINTS + 1);
const primeDimValY = new Int16Array(MAX_POINTS + 1);
const primeDimValZ = new Int16Array(MAX_POINTS + 1);
// Axis line objects and label sprites (added/removed from scene)
let primeDimAxisLines = null;
let primeDimAxisLabels = [];

function computePadicValuations(p) {
    const lim = Math.max(activePointCount, _maxRenderedCount);
    for (let n = 1; n <= lim; n++) {
        let m = n, v = 0;
        while (m % p === 0) { m = (m / p) | 0; v++; }
        padicVal[n] = v;
    }
}

function computePrimeDimValuations() {
    const [px, py, pz] = primeDimP;
    const lim = Math.max(activePointCount, _maxRenderedCount);
    for (let n = 1; n <= lim; n++) {
        let m, v;
        m = n; v = 0; while (m % px === 0) { m = (m / px) | 0; v++; } primeDimValX[n] = v;
        m = n; v = 0; while (m % py === 0) { m = (m / py) | 0; v++; } primeDimValY[n] = v;
        m = n; v = 0; while (m % pz === 0) { m = (m / pz) | 0; v++; } primeDimValZ[n] = v;
    }
}

function applyPrimeDimPositions() {
    const scale = currentSpacing * 15;
    const [px, py, pz] = primeDimP;

    const lim = Math.max(activePointCount, _maxRenderedCount);
    for (let n = 1; n <= lim; n++) {
        const i = n - 1;
        const vx = primeDimValX[n];
        const vy = primeDimValY[n];
        const vz = primeDimValZ[n];

        let x, y, z;
        if (vx === 0 && vy === 0 && vz === 0) {
            // Not a multiple of any chosen prime — cluster near origin with small jitter
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

        baseTargetPositions[i * 3]     = x;
        baseTargetPositions[i * 3 + 1] = y;
        baseTargetPositions[i * 3 + 2] = z;
    }

    { const lim = Math.max(activePointCount, _maxRenderedCount) * 3; for (let i = 0; i < lim; i++) targetPositions[i] = baseTargetPositions[i]; }
    lerpActive = true;
}

function buildPrimeDimAxisObjects() {
    removePrimeDimAxisObjects();
    const [px, py, pz] = primeDimP;
    const len = currentSpacing * 15 * 6;

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
    scene.add(lineGroup);
    primeDimAxisLines = lineGroup;

    // Sprite labels using canvas texture
    const labelColors = ['#ff6666', '#66ff66', '#6699ff'];
    const labelDirs = [
        new THREE.Vector3(len + currentSpacing * 20, 0, 0),
        new THREE.Vector3(0, len + currentSpacing * 20, 0),
        new THREE.Vector3(0, 0, len + currentSpacing * 20),
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
        sprite.scale.set(currentSpacing * 18, currentSpacing * 9, 1);
        scene.add(sprite);
        primeDimAxisLabels.push(sprite);
    }
}

function removePrimeDimAxisObjects() {
    if (primeDimAxisLines) { scene.remove(primeDimAxisLines); primeDimAxisLines = null; }
    for (const s of primeDimAxisLabels) scene.remove(s);
    primeDimAxisLabels = [];
}

function applyPadicPositions() {
    // Place particles on concentric spherical shells ordered by |n|_p = p^{-v_p(n)}.
    // Radial distance r = p^{-v} * scaleFactor (outer = 1, inner layers = 1/p, 1/p^2, ...).
    // Within each shell, arrange by spiral index to preserve angular structure.
    const scaleFactor = currentSpacing * 20;

    // Group indices by valuation (only over the currently-active range)
    const lim = Math.max(activePointCount, _maxRenderedCount);
    const maxV = Math.ceil(Math.log(MAX_POINTS) / Math.log(padicP));
    const shells = new Array(maxV + 1).fill(null).map(() => []);
    for (let n = 1; n <= lim; n++) {
        const v = Math.min(padicVal[n], maxV);
        shells[v].push(n - 1); // 0-based index
    }

    // Fibonacci / golden-angle spiral to distribute points on each shell
    const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
    for (let v = 0; v <= maxV; v++) {
        const shell = shells[v];
        if (shell.length === 0) continue;
        const r = (Math.pow(padicP, -v)) * scaleFactor;
        const count = shell.length;
        if (count === 1) {
            // Single point on a shell — place on the +Y pole instead of dividing by zero
            const idx = shell[0];
            baseTargetPositions[idx * 3]     = 0;
            baseTargetPositions[idx * 3 + 1] = r;
            baseTargetPositions[idx * 3 + 2] = 0;
            continue;
        }
        for (let k = 0; k < count; k++) {
            const idx = shell[k];
            const y = 1 - (k / (count - 1)) * 2;
            const rxy = Math.sqrt(Math.max(0, 1 - y * y));
            const angle = phi * k;
            baseTargetPositions[idx * 3]     = r * rxy * Math.cos(angle);
            baseTargetPositions[idx * 3 + 1] = r * y;
            baseTargetPositions[idx * 3 + 2] = r * rxy * Math.sin(angle);
        }
    }

    if (zetaModeActive) computeZetaOffsets(zetaZeroCount);
    else applyPositionOverlays();
}

// --- Zeta Wave Mode ---
let zetaModeActive = false;
let zetaZeroCount = 0;      // N: number of zeros to use (0-100)
let zetaAmplitude = 1.0;    // amplitude scale
let zetaAnimating = false;
let zetaAnimFrame = null;
const baseTargetPositions = new Float32Array(MAX_POINTS * 3); // lattice positions without zeta offset
let zetaOffsets = new Float32Array(MAX_POINTS);                // Z-axis offset per particle (replaced by worker)

// First 100 non-trivial zeros of the Riemann zeta function (imaginary parts γ_n)
// Source: Andrew Odlyzko's tables
const ZETA_ZEROS = [
    14.134725, 21.022040, 25.010858, 30.424876, 32.935062,
    37.586178, 40.918719, 43.327073, 48.005151, 49.773832,
    52.970321, 56.446248, 59.347044, 60.831779, 65.112544,
    67.079811, 69.546402, 72.067158, 75.704691, 77.144840,
    79.337376, 82.910381, 84.735493, 87.425275, 88.809112,
    92.491899, 94.651344, 95.870634, 98.831194, 101.317851,
    103.725538, 105.446623, 107.168611, 111.029536, 111.874659,
    114.320220, 116.226680, 118.790783, 121.370125, 122.946829,
    124.256819, 127.516684, 129.578704, 131.087688, 133.497737,
    134.756510, 138.116042, 139.736209, 141.123707, 143.111846,
    146.000982, 147.422765, 150.053521, 150.925258, 153.024694,
    156.112909, 157.597591, 158.849989, 161.188965, 163.030710,
    165.537069, 167.184439, 169.094515, 169.911976, 173.411536,
    174.754191, 176.441434, 178.377407, 179.916484, 182.207078,
    184.874468, 185.598783, 187.228922, 189.416159, 192.026657,
    193.079726, 195.265397, 196.876481, 198.015309, 201.264751,
    202.493595, 204.189671, 205.394697, 207.906259, 209.576509,
    211.690862, 213.347919, 214.547044, 216.169538, 219.067596,
    220.714918, 221.430705, 224.007000, 224.983324, 227.421444,
    229.337413, 231.250189, 231.987235, 233.693404, 236.524230,
];

// Zeta offset computation is delegated to the worker (see requestZetaOffsets).
// This thin wrapper keeps the call sites synchronous-looking by issuing a request
// and applying the result via applyZetaOffsets() once it lands. If the worker
// is unavailable (fallback path), we compute synchronously here.
function computeZetaOffsets(N) {
    if (!zetaModeActive || N === 0) {
        cancelPendingZetaRequests();
        zetaOffsets.fill(0);
        applyZetaOffsets();
        return;
    }
    if (_workerReady) {
        const requestedN = N;
        requestZetaOffsets(N).then(applied => {
            // Drop the result if any of the following changed while we were waiting:
            //   - zeta turned off (cancelPendingZetaRequests already handles this, but double-check)
            //   - the slider moved on (a newer request supersedes us — applied will be false)
            //   - p-adic / primeDim took ownership of positions (zeta has no slot to occupy)
            if (!applied) return;
            if (!zetaModeActive) return;
            if (zetaZeroCount !== requestedN) return;
            if (padicModeActive || primeDimModeActive) return;
            applyZetaOffsets();
        });
    } else {
        _computeZetaSyncFallback(N);
        applyZetaOffsets();
    }
}

// Pre-built only when fallback is taken (still cheap to build on demand)
let _zetaSyncCachesBuilt = false;
let _lnCacheSync = null, _sqrtCacheSync = null, _zetaDenomSync = null;
function _computeZetaSyncFallback(N) {
    if (!_zetaSyncCachesBuilt) {
        _lnCacheSync = new Float64Array(MAX_POINTS);
        _sqrtCacheSync = new Float64Array(MAX_POINTS);
        for (let i = 0; i < MAX_POINTS; i++) { _lnCacheSync[i] = Math.log(i+1); _sqrtCacheSync[i] = Math.sqrt(i+1); }
        _zetaDenomSync = new Float64Array(100);
        for (let k = 0; k < 100; k++) { const g = ZETA_ZEROS[k]; _zetaDenomSync[k] = 0.25 + g*g; }
        _zetaSyncCachesBuilt = true;
    }
    for (let i = 0; i < MAX_POINTS; i++) {
        const lnx = _lnCacheSync[i], sqrtx = _sqrtCacheSync[i];
        let sum = 0;
        for (let k = 0; k < N; k++) {
            const g = ZETA_ZEROS[k]; const angle = g * lnx;
            sum += sqrtx * (Math.cos(angle) * 0.5 + Math.sin(angle) * g) / _zetaDenomSync[k];
        }
        zetaOffsets[i] = -2.0 * sum;
    }
    let maxAbs = 0;
    for (let i = 0; i < MAX_POINTS; i++) { const a = Math.abs(zetaOffsets[i]); if (a > maxAbs) maxAbs = a; }
    if (maxAbs > 0) {
        const scale = (currentSpacing * 8.0 * zetaAmplitude) / maxAbs;
        for (let i = 0; i < MAX_POINTS; i++) zetaOffsets[i] *= scale;
    }
}

function applyZetaOffsets() {
    applyPositionOverlays();
}

// --- State ---
let scene, camera, cameraL, cameraR, renderer, controls, points, geometry;
// isPrimeArray and primeGaps are populated by the worker on startup; mutable so we
// can adopt the transferred buffers without copying.
let isPrimeArray = new Uint8Array(MAX_POINTS + 1);
let primeGaps = new Uint8Array(MAX_POINTS + 2);
// numberType[n] = category key string (assigned in classifyNumbers)
const numberType = new Array(MAX_POINTS + 1);
let lastTapTime = 0;

// --- WebXR ---
let vrSession = null;
let vrSupported = false;

// --- Lerp state ---
let lerpActive = true;
let growUICounter = 0;

// Remember the largest activePointCount we've drawn to so we know the range
// of `sizes` slots that may still hold non-zero values from a previous frame.
// When activePointCount shrinks, we only need to clear [activePointCount, _maxRenderedCount).
let _maxRenderedCount = 0;
function _clearAboveActive() {
    if (!geometry) return;
    if (_maxRenderedCount <= activePointCount) { _maxRenderedCount = activePointCount; return; }
    const sizes = geometry.attributes.size.array;
    for (let i = activePointCount; i < _maxRenderedCount; i++) sizes[i] = 0.0;
    _maxRenderedCount = activePointCount;
}

// ---------------------------------------------------------------------------
// Number type definitions
// order matters: first match wins (prime subtypes checked before generic prime)
// ---------------------------------------------------------------------------
const NUMBER_TYPES = [
    // n=1 special
    { key: 'one',       label: '1 (Unity)',           color: '#ffd700', size: 120, defaultOn: true,
      test: n => n === 1 },

    // --- Prime subtypes (checked in priority order) ---
    { key: 'mersenne',  label: 'Mersenne',            color: '#ff4dff', size: 100, defaultOn: true,
      // 2^p-1 that are prime, within range: 3,7,31,127,8191,131071
      test: n => [3,7,31,127,8191,131071].includes(n) },

    { key: 'fermat',    label: 'Fermat',              color: '#ff9900', size: 100, defaultOn: true,
      // 2^(2^n)+1: 3,5,17,257,65537
      test: n => [3,5,17,257,65537].includes(n) },

    { key: 'twin',      label: 'Twin (p±2)',          color: '#00ffcc', size: 85, defaultOn: true,
      test: (n, ip) => ip[n] && n > 2 && (ip[n-2] || (n+2 <= MAX_POINTS && ip[n+2])) },

    { key: 'cousin',    label: 'Cousin (p±4)',        color: '#33ccff', size: 82, defaultOn: true,
      test: (n, ip) => ip[n] && n > 4 && (ip[n-4] || (n+4 <= MAX_POINTS && ip[n+4])) },

    { key: 'sexy',      label: 'Sexy (p±6)',          color: '#66aaff', size: 80, defaultOn: true,
      test: (n, ip) => ip[n] && n > 6 && (ip[n-6] || (n+6 <= MAX_POINTS && ip[n+6])) },

    { key: 'safe',      label: 'Safe ((p-1)/2 prime)',color: '#ff6680', size: 82, defaultOn: true,
      // p is safe prime: p>5, p prime, (p-1)/2 prime
      test: (n, ip) => ip[n] && n > 5 && (n-1)%2===0 && ip[(n-1)/2] },

    { key: 'sophie',    label: 'Sophie Germain',      color: '#ff99cc', size: 82, defaultOn: true,
      // p prime, 2p+1 also prime (and 2p+1 <= MAX)
      test: (n, ip) => ip[n] && n > 2 && (2*n+1 <= MAX_POINTS) && ip[2*n+1] },

    { key: 'palindrome',label: 'Palindrome prime',    color: '#aaff44', size: 85, defaultOn: true,
      test: (n, ip) => {
          if (!ip[n]) return false;
          const s = String(n); return s === s.split('').reverse().join('');
      }},

    { key: 'repunit',   label: 'Repunit (11, R19…)',  color: '#ffdd00', size: 90, defaultOn: true,
      // Repunit primes within range: 11, R19=1111111111111111111 (>range), so just 11
      // Also R2=11, R19 is 19 digits so out of range
      test: (n, ip) => ip[n] && /^1+$/.test(String(n)) },

    { key: 'prime',     label: 'Other prime',         color: '#4d94ff', size: 80, defaultOn: true,
      test: (n, ip) => ip[n] && n > 2 },

    { key: 'two',       label: '2 (even prime)',      color: '#00ffff', size: 85, defaultOn: true,
      test: n => n === 2 },

    // --- Composite categories ---
    { key: 'perfect',   label: 'Perfect (6,28,496…)', color: '#ffffff', size: 60, defaultOn: true,
      test: n => [6,28,496,8128].includes(n) },

    { key: 'primepow',  label: 'Prime power (p^k)',   color: '#cc44ff', size: 50, defaultOn: true,
      test: (n, ip) => {
          if (ip[n] || n < 4) return false;
          // check if n = p^k for k>=2
          for (let p = 2; p * p <= n; p++) {
              if (n % p === 0) {
                  let m = n;
                  while (m % p === 0) m = m / p;
                  if (m === 1) return ip[p] === 1;
              }
          }
          return false;
      }},

    { key: 'even',      label: 'Even composite',      color: '#1a4d6b', size: 28, defaultOn: true,
      test: (n, ip) => !ip[n] && n > 2 && n % 2 === 0 },

    { key: 'odd',       label: 'Odd composite',       color: '#3a3a5c', size: 28, defaultOn: true,
      test: (n, ip) => !ip[n] && n > 1 && n % 2 !== 0 },
];

// visibility state per key
const typeVisibility = {};
for (const t of NUMBER_TYPES) typeVisibility[t.key] = t.defaultOn;

// pre-built lookup: key -> type def (built once, never rebuilt)
const typeMap = {};
for (const t of NUMBER_TYPES) typeMap[t.key] = t;

// pre-resolved per-particle type def
const particleTypeDef = new Array(MAX_POINTS + 1); // set in classifyNumbers

// ---------------------------------------------------------------------------
// Classify every number once after sieve
// ---------------------------------------------------------------------------
function classifyNumbers() {
    for (let n = 1; n <= MAX_POINTS; n++) {
        let matched = null;
        for (const t of NUMBER_TYPES) {
            if (t.test(n, isPrimeArray)) { matched = t; break; }
        }
        if (!matched) matched = typeMap['odd'];
        numberType[n] = matched.key;
        particleTypeDef[n] = matched;
    }
}

function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 200000);
    camera.position.set(3000, 3000, 5000);

    cameraL = new THREE.PerspectiveCamera(60, (window.innerWidth/2) / window.innerHeight, 1, 200000);
    cameraR = new THREE.PerspectiveCamera(60, (window.innerWidth/2) / window.innerHeight, 1, 200000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x010103, 1);
    renderer.autoClear = false;
    renderer.xr.enabled = true;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.15;

    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr').then(supported => {
            vrSupported = supported;
            if (supported) document.getElementById('vr-btn').style.display = '';
        });
    }

    // Sieves and NTL tables are computed on the worker (already kicked off in main entrypoint).
    // We arrive here only after _workerReady is true, so isPrimeArray / ntl_* are populated.
    classifyNumbers();
    buildTypeUI();
    createParticles();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'h') window.toggleUI();
        if (e.key.toLowerCase() === 'c') window.centerOne();
        if (e.key.toLowerCase() === 'g') window.toggleAutoGrow();
    });

    window.addEventListener('touchstart', (e) => {
        if (e.touches.length >= 3) { window.toggleUI(); return; }
        if (e.touches.length > 1) return;
        const currentTime = new Date().getTime();
        if (currentTime - lastTapTime < 300) window.toggleUI();
        lastTapTime = currentTime;
    }, { passive: true });

    window.setLayout   = (l) => { currentLayout = l; calculateTargetPositions(); updateUI(); };
    window.setFillMode = (m) => { currentFillMode = m; calculateTargetPositions(); updateUI(); };
    window.setCompositeMode = (m) => { compositeMode = m; updateParticleVisuals(); updateUI(); };
    window.setColorMode = (mode) => { colorMode = mode; updateParticleVisuals(); updateUI(); };
    window.setStereoMode = (mode) => { stereoMode = mode; onWindowResize(); updateUI(); };
    window.toggleAutoGrow = () => { autoGrow = !autoGrow; if (autoGrow) growSpeed = 50; updateUI(); };
    window.toggleLabels = () => {
        showLabels = !showLabels;
        points.material.uniforms.uShowLabels.value = showLabels ? 1.0 : 0.0;
        updateUI();
    };
    window.toggleUI = () => {
        uiVisible = !uiVisible;
        document.getElementById('ui-overlay').classList.toggle('hidden', !uiVisible);
        document.getElementById('show-ui-hint').style.opacity = uiVisible ? '0' : '0.5';
    };
    window.centerOne = () => {
        const tx = targetPositions[0], ty = targetPositions[1], tz = targetPositions[2];
        controls.target.set(tx, ty, tz);
        camera.position.set(tx + 3000, ty + 3000, tz + 5000);
        controls.update();
    };
    window.enterVR = () => enterVR();
    window.toggleType = (key) => {
        typeVisibility[key] = !typeVisibility[key];
        updateParticleVisuals();
        updateTypeUI();
    };

    // Zeta Wave Mode controls
    window.toggleZetaMode = () => {
        zetaModeActive = !zetaModeActive;
        document.getElementById('zeta-controls').style.display = zetaModeActive ? '' : 'none';
        document.getElementById('sw-zeta').classList.toggle('on', zetaModeActive);
        if (zetaModeActive) {
            computeZetaOffsets(zetaZeroCount);
            applyZetaOffsets();
        } else {
            if (zetaAnimating) {
                zetaAnimating = false;
                clearTimeout(zetaAnimFrame);
                document.getElementById('zeta-anim-btn').textContent = 'Animate';
            }
            cancelPendingZetaRequests();
            zetaOffsets.fill(0);
            applyPositionOverlays();
        }
    };

    const recomputeZeta = rafThrottle(() => {
        if (zetaModeActive) { computeZetaOffsets(zetaZeroCount); applyZetaOffsets(); }
    });
    const zetaNSlider = document.getElementById('zeta-n-slider');
    zetaNSlider.addEventListener('input', (e) => {
        zetaZeroCount = parseInt(e.target.value);
        document.getElementById('zeta-n-val').innerText = zetaZeroCount;
        recomputeZeta();
    });

    const zetaAmpSlider = document.getElementById('zeta-amp-slider');
    zetaAmpSlider.addEventListener('input', (e) => {
        zetaAmplitude = parseFloat(e.target.value);
        document.getElementById('zeta-amp-val').innerText = zetaAmplitude.toFixed(1);
        recomputeZeta();
    });

    window.animateZeta = () => {
        if (zetaAnimating) {
            zetaAnimating = false;
            document.getElementById('zeta-anim-btn').textContent = 'Animate';
            return;
        }
        zetaAnimating = true;
        document.getElementById('zeta-anim-btn').textContent = 'Stop';
        if (!zetaModeActive) window.toggleZetaMode();
        const target = zetaZeroCount > 0 ? zetaZeroCount : 100;
        zetaZeroCount = 0;
        document.getElementById('zeta-n-slider').value = 0;
        document.getElementById('zeta-n-val').innerText = 0;
        computeZetaOffsets(0);
        applyZetaOffsets();

        let n = 0;
        const step = () => {
            if (!zetaAnimating || n >= target) {
                zetaAnimating = false;
                document.getElementById('zeta-anim-btn').textContent = 'Animate';
                return;
            }
            n++;
            zetaZeroCount = n;
            document.getElementById('zeta-n-slider').value = n;
            document.getElementById('zeta-n-val').innerText = n;
            computeZetaOffsets(n);
            applyZetaOffsets();
            // Slow down near end for dramatic effect; speed: 80ms per step base
            const delay = n < 10 ? 500 : n < 30 ? 300 : n < 60 ? 150 : 80;
            zetaAnimFrame = setTimeout(step, delay);
        };
        zetaAnimFrame = setTimeout(step, 300);
    };

    // p-adic Mode controls
    window.togglePadicMode = () => {
        padicModeActive = !padicModeActive;
        document.getElementById('padic-controls').style.display = padicModeActive ? '' : 'none';
        document.getElementById('sw-padic').classList.toggle('on', padicModeActive);
        if (padicModeActive) {
            computePadicValuations(padicP);
            applyPadicPositions();
            updatePadicColorVisuals();
        } else {
            if (padicAnimating) {
                padicAnimating = false;
                clearTimeout(padicAnimFrame);
                document.getElementById('padic-anim-btn').textContent = 'Animate p';
            }
            padicColorMode = false;
            document.getElementById('sw-padic-color').classList.remove('on');
            calculateTargetPositions();
            updateParticleVisuals();
        }
        updateUIDisabledState();
    };

    window.setPadicP = (p) => {
        padicP = parseInt(p);
        document.getElementById('padic-p-val').innerText = padicP;
        if (padicModeActive) {
            computePadicValuations(padicP);
            applyPadicPositions();
            updatePadicColorVisuals();
        }
    };

    window.togglePadicColor = () => {
        padicColorMode = !padicColorMode;
        document.getElementById('sw-padic-color').classList.toggle('on', padicColorMode);
        updatePadicColorVisuals();
    };

    window.animatePadic = () => {
        if (padicAnimating) {
            padicAnimating = false;
            clearTimeout(padicAnimFrame);
            document.getElementById('padic-anim-btn').textContent = 'Animate p';
            return;
        }
        padicAnimating = true;
        document.getElementById('padic-anim-btn').textContent = 'Stop';
        if (!padicModeActive) window.togglePadicMode();
        let idx = PADIC_PRIMES.indexOf(padicP);
        if (idx < 0) idx = 0;

        const step = () => {
            if (!padicAnimating) {
                document.getElementById('padic-anim-btn').textContent = 'Animate p';
                return;
            }
            idx = (idx + 1) % PADIC_PRIMES.length;
            padicP = PADIC_PRIMES[idx];
            document.getElementById('padic-p-select').value = padicP;
            document.getElementById('padic-p-val').innerText = padicP;
            computePadicValuations(padicP);
            applyPadicPositions();
            updatePadicColorVisuals();
            padicAnimFrame = setTimeout(step, 1800);
        };
        padicAnimFrame = setTimeout(step, 300);
    };

    // Prime Dimension Mode controls
    window.togglePrimeDimMode = () => {
        primeDimModeActive = !primeDimModeActive;
        document.getElementById('primedim-controls').style.display = primeDimModeActive ? '' : 'none';
        document.getElementById('sw-primedim').classList.toggle('on', primeDimModeActive);
        if (primeDimModeActive) {
            computePrimeDimValuations();
            applyPrimeDimPositions();
            buildPrimeDimAxisObjects();
            updatePrimeDimVisuals();
        } else {
            removePrimeDimAxisObjects();
            primeDimOnlyChosen = false;
            document.getElementById('sw-primedim-only').classList.remove('on');
            calculateTargetPositions();
            updateParticleVisuals();
        }
        updateUIDisabledState();
    };

    window.setPrimeDimAxis = (axisIdx, p) => {
        primeDimP[axisIdx] = parseInt(p);
        if (primeDimModeActive) {
            computePrimeDimValuations();
            applyPrimeDimPositions();
            buildPrimeDimAxisObjects();
            updatePrimeDimVisuals();
        }
    };

    window.randomPrimeDimTriple = () => {
        const pool = PADIC_PRIMES.slice();
        // pick 3 distinct primes
        const chosen = [];
        while (chosen.length < 3) {
            const idx = Math.floor(Math.random() * pool.length);
            chosen.push(pool.splice(idx, 1)[0]);
        }
        chosen.sort((a, b) => a - b);
        primeDimP = chosen;
        document.getElementById('primedim-x-select').value = chosen[0];
        document.getElementById('primedim-y-select').value = chosen[1];
        document.getElementById('primedim-z-select').value = chosen[2];
        if (primeDimModeActive) {
            computePrimeDimValuations();
            applyPrimeDimPositions();
            buildPrimeDimAxisObjects();
            updatePrimeDimVisuals();
        }
    };

    window.togglePrimeDimOnly = () => {
        primeDimOnlyChosen = !primeDimOnlyChosen;
        document.getElementById('sw-primedim-only').classList.toggle('on', primeDimOnlyChosen);
        if (primeDimModeActive) updatePrimeDimVisuals();
    };

    // Number Theoretic Landscape controls
    window.toggleNTLMode = () => {
        ntlModeActive = !ntlModeActive;
        document.getElementById('sw-ntl').classList.toggle('on', ntlModeActive);
        document.getElementById('ntl-controls').style.display = ntlModeActive ? '' : 'none';
        if (ntlModeActive) {
            computeNTLOffsets();
            applyNTLOffsets();
            updateNTLVisuals();
        } else {
            ntlOffsets.fill(0);
            applyPositionOverlays();
            updateParticleVisuals();
        }
    };

    window.setNTLFunc = (f) => {
        ntlFunc = f;
        if (ntlModeActive) {
            computeNTLOffsets();
            applyNTLOffsets();
            updateNTLVisuals();
        }
    };

    window.toggleNTLPerfect = () => {
        ntlHighlightPerfect = !ntlHighlightPerfect;
        document.getElementById('sw-ntl-perfect').classList.toggle('on', ntlHighlightPerfect);
        if (ntlModeActive) updateNTLVisuals();
    };

    window.toggleNTLHC = () => {
        ntlHighlightHC = !ntlHighlightHC;
        document.getElementById('sw-ntl-hc').classList.toggle('on', ntlHighlightHC);
        if (ntlModeActive) updateNTLVisuals();
    };

    const recomputeNTL = rafThrottle(() => {
        if (ntlModeActive) { computeNTLOffsets(); applyNTLOffsets(); }
    });
    document.getElementById('ntl-scale-slider').addEventListener('input', (e) => {
        ntlScale = parseFloat(e.target.value);
        document.getElementById('ntl-scale-val').innerText = ntlScale.toFixed(1);
        recomputeNTL();
    });

    // Sieve Animation controls
    window.toggleSieveMode = () => {
        sieveModeActive = !sieveModeActive;
        document.getElementById('sw-sieve').classList.toggle('on', sieveModeActive);
        document.getElementById('sieve-controls').style.display = sieveModeActive ? '' : 'none';
        if (sieveModeActive) {
            sieveLimit = activePointCount;
            _sieveReset();
        } else {
            sievePlaying = false;
            updateParticleVisuals();
        }
    };

    window.sievePlay = () => {
        if (!sieveModeActive) return;
        if (sieveFinished) _sieveReset();
        sievePlaying = true;
        _sieveUpdateUI();
    };

    window.sievePause = () => {
        sievePlaying = false;
        _sieveUpdateUI();
    };

    window.sievePlayPause = () => {
        if (!sieveModeActive) return;
        if (sieveFinished) { _sieveReset(); sievePlaying = true; }
        else sievePlaying = !sievePlaying;
        _sieveUpdateUI();
    };

    window.sieveStep = () => {
        if (!sieveModeActive || sieveFinished) return;
        sievePlaying = false;
        sieveAdvanceStep();  // already dirty-writes via _sieveWriteCell — no full flush needed
        _sieveUpdateStats();
        _sieveUpdateUI();
    };

    window.sieveReset = () => {
        if (!sieveModeActive) return;
        sieveLimit = activePointCount;
        _sieveReset();
        _sieveUpdateUI();
    };

    document.getElementById('sieve-speed-slider').addEventListener('input', (e) => {
        sieveSpeed = parseFloat(e.target.value);
        document.getElementById('sieve-speed-val').innerText = sieveSpeed.toFixed(1) + 'x';
    });

    // Spacing recomputes lattice positions — heavy, throttle by rAF
    const recomputeLattice = rafThrottle(() => calculateTargetPositions());
    const sSlider = document.getElementById('spacing-slider');
    sSlider.addEventListener('input', (e) => {
        currentSpacing = parseInt(e.target.value);
        document.getElementById('spacing-val').innerText = currentSpacing;
        recomputeLattice();
    });

    // Count slider only affects per-particle visibility; rAF-throttle the visual update.
    // If a position-owning mode (padic / primeDim) is active, the new range needs its
    // valuations recomputed before visuals can render correctly.
    const recomputeOnCountChange = rafThrottle(() => {
        if (padicModeActive) {
            computePadicValuations(padicP);
            applyPadicPositions();
            updatePadicColorVisuals();
        } else if (primeDimModeActive) {
            computePrimeDimValuations();
            applyPrimeDimPositions();
            updatePrimeDimVisuals();
        } else if (ntlModeActive) {
            computeNTLOffsets();
            applyNTLOffsets();
            updateNTLVisuals();
        } else {
            updateParticleVisuals();
        }
    });
    const cSlider = document.getElementById('count-slider');
    cSlider.addEventListener('input', (e) => {
        activePointCount = parseInt(e.target.value);
        autoGrow = false;
        // labels are cheap, update immediately so UI stays responsive
        document.getElementById('count-val').innerText = activePointCount.toLocaleString();
        document.getElementById('range-info').innerText = `1 - ${activePointCount.toLocaleString()}`;
        document.getElementById('sw-autogrow').classList.toggle('on', autoGrow);
        recomputeOnCountChange();
    });

    const strideSlider = document.getElementById('stride-slider');
    strideSlider.addEventListener('input', (e) => {
        linearStride = parseInt(e.target.value);
        document.getElementById('stride-val').innerText = linearStride <= 0 ? 'Auto' : linearStride;
        recomputeLattice();
    });

    calculateTargetPositions();
    updateUI();
    renderer.setAnimationLoop(animate);
}

// ---------------------------------------------------------------------------
// Build the Number Types panel in the UI
// ---------------------------------------------------------------------------
function buildTypeUI() {
    const container = document.getElementById('type-list');
    container.innerHTML = '';
    for (const t of NUMBER_TYPES) {
        const row = document.createElement('div');
        row.className = 'type-row';
        row.id = `type-row-${t.key}`;
        row.innerHTML = `
            <span class="type-dot" style="background:${t.color};box-shadow:0 0 5px ${t.color}"></span>
            <span class="type-label">${t.label}</span>
            <div class="toggle-switch ${t.defaultOn ? 'on' : ''}" id="sw-type-${t.key}"></div>
        `;
        row.addEventListener('click', () => window.toggleType(t.key));
        container.appendChild(row);
    }
}

function updateTypeUI() {
    for (const t of NUMBER_TYPES) {
        const sw = document.getElementById(`sw-type-${t.key}`);
        if (sw) sw.classList.toggle('on', !!typeVisibility[t.key]);
    }
}

// ---------------------------------------------------------------------------
// Disable/enable UI groups based on active modes
// ---------------------------------------------------------------------------
function setGroupDisabled(id, disabled) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('ui-section-disabled', disabled);
}

function updateUIDisabledState() {
    const padic = padicModeActive;
    const pdim  = primeDimModeActive;
    // NTL mode is an overlay (like zeta), not a position-owner, so it doesn't disable lattice controls
    const exclusivePos = padic || pdim;
    setGroupDisabled('group-lattice',        exclusivePos);
    setGroupDisabled('group-spacing',        exclusivePos);
    setGroupDisabled('group-zeta-toggle',    exclusivePos);
    setGroupDisabled('zeta-controls',        exclusivePos);
    setGroupDisabled('group-padic-toggle',   pdim);
    setGroupDisabled('padic-controls',       pdim);
    setGroupDisabled('group-primedim-toggle', padic);
    setGroupDisabled('primedim-controls',    padic);
    // NTL controls are shown/hidden via display, no need to disable here
}

// ---------------------------------------------------------------------------
// updateUI
// ---------------------------------------------------------------------------
function updateUI() {
    document.getElementById('layout-select').value = currentLayout;
    document.getElementById('fillmode-select').value = currentFillMode;
    document.getElementById('count-val').innerText = activePointCount.toLocaleString();
    document.getElementById('count-slider').value = activePointCount;
    document.getElementById('range-info').innerText = `1 - ${activePointCount.toLocaleString()}`;
    const st = document.getElementById('current-state-text');
    if (st) st.innerText = `${currentLayout.toUpperCase()} - ${currentFillMode.toUpperCase()}`;
    
    const compSelect = document.getElementById('composite-select');
    if (compSelect) compSelect.value = compositeMode;

    document.getElementById('sw-labels').classList.toggle('on', showLabels);
    document.getElementById('sw-autogrow').classList.toggle('on', autoGrow);
    document.getElementById('color-select').value = colorMode;
    document.getElementById('stereo-select').value = stereoMode;
    const strideSection = document.getElementById('stride-section');
    if (strideSection) strideSection.style.display = (currentFillMode === 'linear') ? '' : 'none';
    document.getElementById('stride-val').innerText = linearStride <= 0 ? 'Auto' : linearStride;
    document.getElementById('stride-slider').value = linearStride;

    const typePanel = document.getElementById('type-panel');
    if (typePanel) typePanel.style.display = (colorMode === 'types') ? '' : 'none';

    document.getElementById('sw-zeta').classList.toggle('on', zetaModeActive);
    document.getElementById('zeta-controls').style.display = zetaModeActive ? '' : 'none';

    document.getElementById('sw-padic').classList.toggle('on', padicModeActive);
    document.getElementById('padic-controls').style.display = padicModeActive ? '' : 'none';

    document.getElementById('sw-primedim').classList.toggle('on', primeDimModeActive);
    document.getElementById('primedim-controls').style.display = primeDimModeActive ? '' : 'none';

    document.getElementById('sw-ntl').classList.toggle('on', ntlModeActive);
    document.getElementById('ntl-controls').style.display = ntlModeActive ? '' : 'none';

    document.getElementById('sw-sieve').classList.toggle('on', sieveModeActive);
    document.getElementById('sieve-controls').style.display = sieveModeActive ? '' : 'none';

    updateTypeUI();
    updateUIDisabledState();
}

// ---------------------------------------------------------------------------
// p-adic color visuals (overlays valuation layers when padicColorMode is on)
// ---------------------------------------------------------------------------
function updatePadicColorVisuals() {
    if (!padicModeActive || !padicColorMode) {
        updateParticleVisuals();
        return;
    }
    const cols = geometry.attributes.customColor.array;
    const sizes = geometry.attributes.size.array;
    const color = new THREE.Color();
    const maxV = Math.ceil(Math.log(MAX_POINTS) / Math.log(padicP));

    for (let n = 1; n <= activePointCount; n++) {
        const i = n - 1;
        if (!isCompositeVisible(n)) { sizes[i] = 0.0; continue; }

        const v = Math.min(padicVal[n], maxV);
        if (v === 0) {
            // not divisible by p — outermost shell, dim
            color.setHSL(0.6, 0.3, 0.25);
            sizes[i] = isPrimeArray[n] ? 70.0 : 22.0;
        } else {
            // hue sweeps through layers: v=1 cyan, v=2 green, v=3 yellow, higher → red/magenta
            const hue = (1.0 - Math.min(v / maxV, 1.0)) * 0.55 + 0.05;
            const lightness = 0.4 + Math.min(v / maxV, 1.0) * 0.35;
            color.setHSL(hue, 1.0, lightness);
            sizes[i] = isPrimeArray[n] ? 80.0 : Math.min(20 + v * 8, 55);
        }
        cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
    }
    _clearAboveActive();
    geometry.attributes.customColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Number Theoretic Landscape visuals
// ---------------------------------------------------------------------------
function updateNTLVisuals() {
    const cols  = geometry.attributes.customColor.array;
    const sizes = geometry.attributes.size.array;
    const color = new THREE.Color();

    // Compute per-particle raw value for color mapping (only over active range)
    let rawMin = Infinity, rawMax = -Infinity;
    for (let n = 1; n <= activePointCount; n++) {
        const v = _ntlRawValue(n);
        if (v < rawMin) rawMin = v;
        if (v > rawMax) rawMax = v;
    }
    const rawRange = rawMax - rawMin || 1;

    for (let n = 1; n <= activePointCount; n++) {
        const i = n - 1;
        if (!isCompositeVisible(n)) { sizes[i] = 0.0; continue; }

        const raw = _ntlRawValue(n);
        const t = (raw - rawMin) / rawRange; // 0..1 normalized

        const isPrime = !!isPrimeArray[n];
        const isPerfect = PERFECT_NUMBERS.has(n);
        const isHC = HC_NUMBERS.has(n);

        if (isPerfect && ntlHighlightPerfect) {
            color.set(0xffffff);
            sizes[i] = 110.0;
        } else if (isHC && ntlHighlightHC) {
            color.set(0xffdd00);
            sizes[i] = 95.0;
        } else if (ntlFunc === 'mobius') {
            // -1 → red, 0 → dark grey (flat), +1 → cyan
            if (ntl_mu[n] === 0)       { color.setHSL(0.0, 0.0, 0.15); sizes[i] = 20.0; }
            else if (ntl_mu[n] === -1) { color.set(0xff3333); sizes[i] = isPrime ? 80.0 : 45.0; }
            else                       { color.set(0x00ffcc); sizes[i] = isPrime ? 80.0 : 45.0; }
        } else {
            // Hue: low value → blue/purple, high → yellow/red  (like a heatmap)
            const hue = (1.0 - t) * 0.67;   // 0.67=blue → 0=red
            const sat = isPrime ? 0.5 : 1.0;
            const lit = isPrime ? 0.45 : 0.35 + t * 0.35;
            color.setHSL(hue, sat, lit);
            // Size: scaled by height, primes always visible
            if (isPrime) {
                sizes[i] = 70.0;
            } else {
                sizes[i] = Math.max(18, Math.min(85, 18 + t * 67));
            }
        }
        cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
    }
    _clearAboveActive();
    geometry.attributes.customColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
}

function _ntlRawValue(n) {
    if      (ntlFunc === 'd')           return ntl_d[n];
    else if (ntlFunc === 'sigma_ratio') return ntl_sigma[n];
    else if (ntlFunc === 'omega')       return ntl_omega[n];
    else if (ntlFunc === 'log_sigma')   return ntl_sigma[n] > 0 ? Math.log(ntl_sigma[n]) : 0;
    else if (ntlFunc === 'mobius')      return ntl_mu[n];
    else                                return ntl_phi[n] / n;
}

// ---------------------------------------------------------------------------
// Prime Dimension Mode visuals
// ---------------------------------------------------------------------------
function updatePrimeDimVisuals() {
    if (!primeDimModeActive) { updateParticleVisuals(); return; }

    const cols  = geometry.attributes.customColor.array;
    const sizes = geometry.attributes.size.array;
    const color = new THREE.Color();
    const [px, py, pz] = primeDimP;

    for (let n = 1; n <= activePointCount; n++) {
        const i = n - 1;

        const vx = primeDimValX[n];
        const vy = primeDimValY[n];
        const vz = primeDimValZ[n];
        const isOnAxis = (vx > 0 || vy > 0 || vz > 0);

        if (primeDimOnlyChosen && !isOnAxis) { sizes[i] = 0.0; continue; }
        if (!isCompositeVisible(n)) { sizes[i] = 0.0; continue; }

        if (!isOnAxis) {
            // Not a multiple of any chosen prime — dim, small
            color.setHSL(0.6, 0.2, 0.15);
            sizes[i] = isPrimeArray[n] ? 45.0 : 18.0;
        } else if (isPrimeArray[n]) {
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
    _clearAboveActive();
    geometry.attributes.customColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Particle visuals
// ---------------------------------------------------------------------------
function isCompositeVisible(n) {
    const isComp = !isPrimeArray[n] && n > 1;
    if (!isComp) return true; 
    if (compositeMode === 'none') return false;
    if (compositeMode === 'odd') return n % 2 !== 0;
    if (compositeMode === 'even') return n % 2 === 0;
    return true; 
}

function updateParticleVisuals() {
    if (sieveModeActive)                     { _sieveFlushVisuals(); return; }
    if (ntlModeActive)                       { updateNTLVisuals(); return; }
    if (primeDimModeActive)                  { updatePrimeDimVisuals(); return; }
    if (padicModeActive && padicColorMode)   { updatePadicColorVisuals(); return; }
    const cols = geometry.attributes.customColor.array;
    const sizes = geometry.attributes.size.array;
    const color = new THREE.Color(); // reused, no allocation per iteration

    // Pre-parse type colors into RGB floats once per call
    const typeRGB = {};
    for (const t of NUMBER_TYPES) {
        color.set(t.color);
        typeRGB[t.key] = [color.r, color.g, color.b];
    }

    const isTypes = colorMode === 'types';
    const isDepth = colorMode === 'depth';

    // For 'depth' mode we need maxDepth — compute in a single pass alongside the main loop
    // by deferring depth coloring to a second mini-pass; cheaper than the previous double-pass
    // when activePointCount is small.
    let maxDepth = 1;
    if (isDepth) {
        for (let i = 0; i < activePointCount; i++) {
            const d2 = targetPositions[i*3]**2 + targetPositions[i*3+1]**2 + targetPositions[i*3+2]**2;
            if (d2 > maxDepth) maxDepth = d2;
        }
        maxDepth = Math.sqrt(maxDepth);
    }

    for (let n = 1; n <= activePointCount; n++) {
        const i = n - 1;

        if (!isCompositeVisible(n)) { sizes[i] = 0.0; continue; }

        const tkey = numberType[n];

        if (isTypes) {
            if (!typeVisibility[tkey]) { sizes[i] = 0.0; continue; }
            const rgb = typeRGB[tkey];
            const tdef = particleTypeDef[n];
            cols[i*3] = rgb[0]; cols[i*3+1] = rgb[1]; cols[i*3+2] = rgb[2];
            sizes[i] = tdef.size;
        } else {
            if (n === 1) {
                color.set(0xffd700); sizes[i] = 120.0;
            } else if (isPrimeArray[n]) {
                sizes[i] = 80.0;
                if      (colorMode === 'spectrum') { color.setHSL(0.55 + (n/MAX_POINTS)*0.3, 1.0, 0.6); }
                else if (colorMode === 'mod6') {
                    if      (n === 2) color.setHSL(0.08, 1.0, 0.65);
                    else if (n === 3) color.setHSL(0.33, 1.0, 0.65);
                    else if (n % 6 === 1) color.setHSL(0.57, 1.0, 0.60);
                    else                  color.setHSL(0.85, 1.0, 0.60);
                }
                else if (colorMode === 'mod10') { color.setHSL((n % 10) / 10.0, 0.9, 0.6); }
                else if (colorMode === 'twin') {
                    const tw = n > 2 && (isPrimeArray[n-2] || (n+2 <= MAX_POINTS && isPrimeArray[n+2]));
                    color.setHSL(tw ? 0.12 : 0.62, 1.0, tw ? 0.72 : 0.55);
                }
                else if (colorMode === 'gap') {
                    const g = primeGaps[n] || 2;
                    color.setHSL((1.0 - Math.min(g, 72) / 72) * 0.65, 1.0, 0.6);
                }
                else if (isDepth) {
                    const dx=targetPositions[i*3], dy=targetPositions[i*3+1], dz=targetPositions[i*3+2];
                    color.setHSL(0.55 + (Math.sqrt(dx*dx+dy*dy+dz*dz) / maxDepth) * 0.45, 1.0, 0.6);
                }
            } else {
                color.set(0x3a3a5c);
                sizes[i] = 28.0;
            }
            cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
        }
    }
    _clearAboveActive();
    geometry.attributes.customColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Target positions
// ---------------------------------------------------------------------------
// Cache the *unscaled* candidate ordering as a flat Float32Array (xyz interleaved).
// Spacing changes only multiply, so we keep this around as long as layout/fillMode/stride
// don't change. Switching layouts discards the previous array — no multi-layout cache.
let _candidateCacheKey = '';
let _candidateCacheFlat = null;
let _candidateCacheLen = 0;

function calculateTargetPositions() {
    const cacheKey = `${currentLayout}|${currentFillMode}|${linearStride}`;
    if (cacheKey !== _candidateCacheKey || !_candidateCacheFlat) {
        let candidates = [];
        let range = 45;
        if (currentLayout === 'tetra' || currentLayout === 'rhombic') range = 58;
        if (currentLayout === 'triangular') range = 62;
        if (currentLayout === 'omnitruncated') range = 36;
        if (currentLayout === 'gyroid') range = 55;

        if (currentLayout === 'cube') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) candidates.push({x,y,z});
        } else if (currentLayout === 'hexagonal' || currentLayout === 'triangular') {
            const s3=Math.sqrt(3);
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) candidates.push({x:x+(Math.abs(y)%2)*0.5,y:y*(s3/2),z});
        } else if (currentLayout === 'octahedral' || currentLayout === 'bitruncated') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) { candidates.push({x,y,z}); candidates.push({x:x+0.5,y:y+0.5,z:z+0.5}); }
        } else if (currentLayout === 'tetra' || currentLayout === 'rhombic') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) if(Math.abs(x+y+z)%2===0) candidates.push({x,y,z});
        } else if (currentLayout === 'omnitruncated') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) { candidates.push({x:x*2,y:y*2,z:z*2}); candidates.push({x:x*2+1,y:y*2+1,z:z*2+1}); }
        } else if (currentLayout === 'aperiodic') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
                const s=(x*123+y*456+z*789);
                candidates.push({x:x+Math.sin(s)*0.5,y:y+Math.cos(s)*0.5,z:z+Math.sin(s*0.5)*0.5});
            }
        } else if (currentLayout === 'hcp') {
            const s3=Math.sqrt(3),cz=Math.sqrt(2/3);
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
                const even=(Math.abs(z)%2===0);
                candidates.push({x:x+(Math.abs(y)%2)*0.5+(even?0:0.5),y:y*(s3/2)+(even?0:s3/6),z:z*cz});
            }
        } else if (currentLayout === 'diamond_c') {
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
                if(Math.abs(x+y+z)%2===0) { candidates.push({x,y,z}); candidates.push({x:x+0.5,y:y+0.5,z:z+0.5}); }
            }
        } else if (currentLayout === 'gyroid') {
            const sc=0.3;
            for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
                const f=Math.abs(Math.sin(x*sc)*Math.cos(y*sc)+Math.sin(y*sc)*Math.cos(z*sc)+Math.sin(z*sc)*Math.cos(x*sc));
                if(f<0.5) candidates.push({x,y,z});
            }
        }

        if      (currentFillMode==='shell')   candidates.sort((a,b)=>(a.x*a.x+a.y*a.y+a.z*a.z)-(b.x*b.x+b.y*b.y+b.z*b.z));
        else if (currentFillMode==='cubic')   candidates.sort((a,b)=>Math.max(Math.abs(a.x),Math.abs(a.y),Math.abs(a.z))-Math.max(Math.abs(b.x),Math.abs(b.y),Math.abs(b.z)));
        else if (currentFillMode==='diamond') candidates.sort((a,b)=>(Math.abs(a.x)+Math.abs(a.y)+Math.abs(a.z))-(Math.abs(b.x)+Math.abs(b.y)+Math.abs(b.z)));
        else if (currentFillMode==='linear') {
            if (linearStride<=0) {
                candidates.sort((a,b)=>(a.z-b.z)||(a.y-b.y)||(a.x-b.x));
            } else {
                const W=linearStride;
                const xMin=candidates.reduce((m,c)=>Math.min(m,c.x),Infinity);
                candidates.sort((a,b)=>{
                    if(a.z!==b.z) return a.z-b.z;
                    const sA=Math.floor((a.x-xMin)/W), sB=Math.floor((b.x-xMin)/W);
                    if(sA!==sB) return sA-sB;
                    if(a.y!==b.y) return a.y-b.y;
                    return a.x-b.x;
                });
            }
        }
        else if (currentFillMode==='vortex')  candidates.sort((a,b)=>(Math.abs(a.z-b.z)>0.5?a.z-b.z:Math.atan2(a.y,a.x)-Math.atan2(b.y,b.x)));
        else if (currentFillMode==='outside') candidates.sort((a,b)=>(b.x*b.x+b.y*b.y+b.z*b.z)-(a.x*a.x+a.y*a.y+a.z*a.z));
        else if (currentFillMode==='zorder') {
            let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity,z0=Infinity,z1=-Infinity;
            for(const c of candidates){if(c.x<x0)x0=c.x;if(c.x>x1)x1=c.x;if(c.y<y0)y0=c.y;if(c.y>y1)y1=c.y;if(c.z<z0)z0=c.z;if(c.z>z1)z1=c.z;}
            const scl=255/Math.max(x1-x0,y1-y0,z1-z0,1);
            for(const c of candidates){
                const ix=Math.round((c.x-x0)*scl),iy=Math.round((c.y-y0)*scl),iz=Math.round((c.z-z0)*scl);
                let m=0; for(let i=0;i<8;i++) m|=((ix>>i&1)<<(3*i))|((iy>>i&1)<<(3*i+1))|((iz>>i&1)<<(3*i+2));
                c._m=m;
            }
            candidates.sort((a,b)=>a._m-b._m);
        }
        else if (currentFillMode==='modular') {
            const M=6,bkts=Array.from({length:M},()=>[]);
            for(const c of candidates) bkts[Math.floor(((Math.atan2(c.y,c.x)+Math.PI)/(2*Math.PI))*M)%M].push(c);
            const d2=c=>c.x*c.x+c.y*c.y+c.z*c.z;
            for(const b of bkts) b.sort((a,b)=>d2(a)-d2(b));
            candidates=[];
            const ml=Math.max(...bkts.map(b=>b.length));
            for(let k=0;k<ml;k++) for(let r=0;r<M;r++) if(k<bkts[r].length) candidates.push(bkts[r][k]);
        }

        // Flatten to Float32Array — spacing changes will then be a tight multiply loop.
        // Cap at MAX_POINTS so we don't waste memory on the long tail of unused candidates.
        const cap = Math.min(candidates.length, MAX_POINTS);
        const flat = new Float32Array(cap * 3);
        for (let i = 0; i < cap; i++) {
            const c = candidates[i];
            flat[i*3] = c.x; flat[i*3+1] = c.y; flat[i*3+2] = c.z;
        }
        _candidateCacheKey = cacheKey;
        _candidateCacheFlat = flat;
        _candidateCacheLen = cap;
        candidates = null;  // help GC drop the object array
    }

    // Only fill base positions up to the current active range (+ any previously-rendered slack
    // so shrinking activePointCount doesn't leave stale lerp targets). On a spacing change we
    // hit this hot path with the cached flat array — just a multiply, no object access.
    const baseLim = Math.min(Math.max(activePointCount, _maxRenderedCount), _candidateCacheLen);
    const flat = _candidateCacheFlat;
    const s = currentSpacing;
    for (let i = 0; i < baseLim * 3; i++) {
        baseTargetPositions[i] = flat[i] * s;
    }
    // Zero-out any range above the cached candidates (rare — only if a layout has < activePointCount points)
    for (let i = baseLim * 3; i < Math.max(activePointCount, _maxRenderedCount) * 3; i++) {
        baseTargetPositions[i] = 0;
    }
    if (padicModeActive) {
        applyPadicPositions();
    } else if (primeDimModeActive) {
        applyPrimeDimPositions();
        buildPrimeDimAxisObjects();
    } else {
        // Zeta and NTL are both Z-axis overlays — they always *add* on top of the lattice base,
        // never override it. computeZetaOffsets is async (worker), so apply the current overlays
        // immediately for snappy feedback; the worker result will refresh again when it lands.
        if (ntlModeActive) computeNTLOffsets();
        if (zetaModeActive) computeZetaOffsets(zetaZeroCount);
        applyPositionOverlays();
    }
}

// ---------------------------------------------------------------------------
// Particles / shaders
// ---------------------------------------------------------------------------
function createParticles() {
    geometry = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_POINTS * 3);
    const nums = new Float32Array(MAX_POINTS);
    for (let n = 1; n <= MAX_POINTS; n++) {
        nums[n-1] = n;
        pos[(n-1)*3]   = (Math.random()-0.5)*5000;
        pos[(n-1)*3+1] = (Math.random()-0.5)*5000;
        pos[(n-1)*3+2] = (Math.random()-0.5)*5000;
    }
    geometry.setAttribute('position',    new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('number',      new THREE.BufferAttribute(nums, 1));
    geometry.setAttribute('customColor', new THREE.BufferAttribute(new Float32Array(MAX_POINTS*3), 3));
    geometry.setAttribute('size',        new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1));
    updateParticleVisuals();

    const material = new THREE.ShaderMaterial({
        uniforms: {
            atlas:       { value: createNumberAtlas() },
            starTex:     { value: createGlowTexture() },
            uShowLabels: { value: 1.0 },
            uViewHeight: { value: window.innerHeight }
        },
        vertexShader: `
            attribute float size; attribute float number; attribute vec3 customColor;
            uniform float uViewHeight;
            varying vec3 vColor; varying float vNumber; varying float vDistance; varying float vSize;
            void main() {
                vColor = customColor; vNumber = number; vSize = size;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vDistance = -mvPosition.z;
                // scale point size proportionally to viewport height so density stays
                // consistent regardless of window/screen size
                gl_PointSize = max(size * (uViewHeight * 1.5 / vDistance), 0.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform sampler2D atlas; uniform sampler2D starTex; uniform float uShowLabels; uniform float uViewHeight;
            varying vec3 vColor; varying float vNumber; varying float vDistance; varying float vSize;
            void main() {
                float n = floor(vNumber + 0.5);
                if (n < 0.5 || vSize < 0.1) discard;
                float currentPointSize = max(vSize * (uViewHeight * 1.5 / vDistance), 0.0);
                float isPrime = step(50.0, vSize);
                float labelFar  = uViewHeight * 3.5;
                float labelNear = uViewHeight * 1.1;
                float numMix = uShowLabels * isPrime * smoothstep(labelFar, labelNear, vDistance);
                vec4 starColor = vec4(vColor * 1.5, 1.0) * texture2D(starTex, gl_PointCoord);
                if (numMix > 0.01 && currentPointSize > 6.0) {
                    float numDigits = 1.0;
                    if (n >= 9.5)   numDigits = 2.0;
                    if (n >= 99.5)  numDigits = 3.0;
                    if (n >= 999.5) numDigits = 4.0;
                    if (n >= 9999.5)numDigits = 5.0;
                    if (n >= 99999.5)numDigits = 6.0;
                    float mX = 0.10; float mY = 0.175;
                    vec2 pc = (gl_PointCoord - vec2(mX, mY)) / vec2(1.0 - 2.0*mX, 1.0 - 2.0*mY);
                    if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) {
                        gl_FragColor = starColor;
                    } else {
                        float digitIndex = floor(pc.x * numDigits + 0.001);
                        float localX = fract(pc.x * numDigits + 0.001);
                        float power = pow(10.0, numDigits - 1.0 - digitIndex);
                        float digit = mod(floor(n / power), 10.0);
                        vec2 numUV = vec2((digit + localX) / 10.0, 1.0 - pc.y);
                        vec4 numTex = texture2D(atlas, numUV);
                        gl_FragColor = mix(starColor, vec4(vColor * 2.5, numTex.a), numMix);
                    }
                } else {
                    gl_FragColor = starColor;
                }
                if (gl_FragColor.a < 0.01) discard;
            }
        `,
        blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, depthTest: true
    });
    points = new THREE.Points(geometry, material);
    scene.add(points);
}

function createNumberAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const slotW = 102.4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < 10; i++) {
        const cx = i * slotW + slotW * 0.5;
        const cy = 64;

        // --- Nixie tube glow layers (back to front) ---

        // outermost diffuse halo
        ctx.font = '108px "Nixie One", serif';
        ctx.shadowColor = 'rgba(255, 120, 20, 0.25)';
        ctx.shadowBlur = 40;
        ctx.fillStyle = 'rgba(255, 100, 10, 0.18)';
        ctx.fillText(i.toString(), cx, cy);

        // mid glow
        ctx.shadowColor = 'rgba(255, 160, 40, 0.6)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = 'rgba(255, 140, 30, 0.55)';
        ctx.fillText(i.toString(), cx, cy);

        // tight inner glow
        ctx.shadowColor = 'rgba(255, 200, 80, 0.9)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ff9922';
        ctx.fillText(i.toString(), cx, cy);

        // bright hot core
        ctx.shadowColor = 'rgba(255, 240, 160, 1.0)';
        ctx.shadowBlur = 2;
        ctx.fillStyle = '#ffe0a0';
        ctx.fillText(i.toString(), cx, cy);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
}

function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32,32,0,32,32,32);
    grad.addColorStop(0,'white');
    grad.addColorStop(0.2,'rgba(255,255,255,0.8)');
    grad.addColorStop(0.5,'rgba(255,255,255,0.3)');
    grad.addColorStop(1,'transparent');
    ctx.fillStyle = grad; ctx.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// WebXR
// ---------------------------------------------------------------------------
async function enterVR() {
    if (!vrSupported) return;
    if (vrSession) { await vrSession.end(); return; }
    try {
        const session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor','bounded-floor','hand-tracking']
        });
        vrSession = session;
        renderer.xr.setSession(session);
        controls.enabled = false;
        controls.autoRotate = false;
        renderer.xr.getCamera().position.set(0,1600,4000);
        session.addEventListener('end', () => {
            vrSession = null;
            controls.enabled = true;
            controls.autoRotate = true;
            document.getElementById('vr-btn').textContent = 'Enter VR';
        });
        document.getElementById('vr-btn').textContent = 'Exit VR';
    } catch(e) { console.error('VR session failed:', e); }
}

// ---------------------------------------------------------------------------
// Resize / animate
// ---------------------------------------------------------------------------
let _vpW = window.innerWidth, _vpH = window.innerHeight;

function onWindowResize() {
    _vpW = window.innerWidth; _vpH = window.innerHeight;
    renderer.setSize(_vpW, _vpH);
    camera.aspect = _vpW / _vpH; camera.fov = 60; camera.updateProjectionMatrix();
    if (points) points.material.uniforms.uViewHeight.value = _vpH;
    if (stereoMode !== 'off') {
        cameraL.aspect = (_vpW/2)/_vpH; cameraR.aspect = (_vpW/2)/_vpH;
        cameraL.updateProjectionMatrix(); cameraR.updateProjectionMatrix();
    }
}

// lerp convergence: stop updating GPU buffer when all points are close enough
const LERP_THRESHOLD_SQ = 0.25; // 0.5 units per axis
let _lastTime = 0;

function animate(now = 0) {
    const dt = Math.min((now - _lastTime) / 1000, 0.1); // seconds, clamped to 100ms
    _lastTime = now;

    if (sieveModeActive) sieveTick(dt);

    if (autoGrow && activePointCount < MAX_POINTS) {
        growSpeed *= 1.005;
        activePointCount = Math.min(MAX_POINTS, activePointCount + Math.floor(growSpeed));
        // throttle DOM updates to every 10 frames during auto-grow
        if (++growUICounter % 10 === 0) { updateUI(); updateParticleVisuals(); }
        lerpActive = true;
    }

    if (lerpActive) {
        const p = geometry.attributes.position.array;
        // Only lerp particles that are actually drawn — invisible particles
        // (n > activePointCount) don't need to chase their targets.
        const limit = activePointCount * 3;
        let maxDeltaSq = 0;
        for (let i = 0; i < limit; i++) {
            const delta = (targetPositions[i] - p[i]) * lerpSpeed;
            p[i] += delta;
            if (delta * delta > maxDeltaSq) maxDeltaSq = delta * delta;
        }
        geometry.attributes.position.needsUpdate = true;
        if (maxDeltaSq < LERP_THRESHOLD_SQ) lerpActive = false;
    }

    if (!vrSession) controls.update();

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, _vpW, _vpH);
    renderer.clear();

    if (vrSession) {
        renderer.render(scene, camera);
    } else if (stereoMode !== 'off') {
        const eyeSep = 45;
        cameraL.copy(camera); cameraR.copy(camera);
        cameraL.aspect=(_vpW/2)/_vpH; cameraL.updateProjectionMatrix();
        cameraR.aspect=(_vpW/2)/_vpH; cameraR.updateProjectionMatrix();
        cameraL.translateX(-eyeSep); cameraR.translateX(eyeSep);
        renderer.setScissorTest(true);
        renderer.setViewport(0,0,_vpW/2,_vpH); renderer.setScissor(0,0,_vpW/2,_vpH);
        renderer.render(scene, stereoMode==='parallel' ? cameraL : cameraR);
        renderer.setViewport(_vpW/2,0,_vpW/2,_vpH); renderer.setScissor(_vpW/2,0,_vpW/2,_vpH);
        renderer.render(scene, stereoMode==='parallel' ? cameraR : cameraL);
        renderer.setScissorTest(false);
    } else {
        renderer.render(scene, camera);
    }
}

const _nixieFont = new FontFace(
    'Nixie One',
    "url(https://fonts.gstatic.com/s/nixieone/v17/lW-8wjkKLXjg5y2o2uUoUA.woff2) format('woff2')," +
    "url(https://fonts.gstatic.com/s/nixieone/v17/lW-8wjkKLXjg5y2o2uUoUA.ttf) format('truetype')"
);

// Boot sequence: kick off worker init and font load in parallel, show progress bar,
// then run init() once both have settled. Either side can fail without blocking the app —
// font load races against a 5s ceiling so a flaky CDN can't stall startup.
async function boot() {
    _setBootStage('Loading font…', 2);
    const fontPromise = Promise.race([
        _nixieFont.load().then(f => document.fonts.add(f)).catch(() => {}),
        new Promise(r => setTimeout(r, 5000)),
    ]);
    _setBootStage('Spinning up worker…', 5);
    try {
        await initWorker();
    } catch (e) {
        console.error('Worker init failed, falling back to main-thread sieves', e);
        _fallbackBuildOnMainThread();
    }
    await fontPromise;
    _setBootStage('Building lattice…', 99);
    init();
    _setBootStage('Ready', 100);
    requestAnimationFrame(() => _hideBootOverlay());
}

// Fallback: if Worker isn't available (very old browsers, file:// without server, etc.),
// rebuild sieves and tables synchronously on the main thread.
function _fallbackBuildOnMainThread() {
    isPrimeArray.fill(1);
    isPrimeArray[0] = isPrimeArray[1] = 0;
    for (let i = 2; i * i <= MAX_POINTS; i++) {
        if (isPrimeArray[i]) for (let j = i * i; j <= MAX_POINTS; j += i) isPrimeArray[j] = 0;
    }
    let prev = 2;
    for (let i = 3; i <= MAX_POINTS; i++) {
        if (isPrimeArray[i]) { primeGaps[prev] = Math.min(i - prev, 255); prev = i; }
    }
    // NTL tables
    const sigmaSum = new Float64Array(MAX_POINTS + 1);
    const divCount = new Uint16Array(MAX_POINTS + 1);
    for (let d = 1; d <= MAX_POINTS; d++) {
        for (let m = d; m <= MAX_POINTS; m += d) { divCount[m]++; sigmaSum[m] += d; }
    }
    for (let n = 1; n <= MAX_POINTS; n++) { ntl_d[n] = divCount[n]; ntl_sigma[n] = sigmaSum[n] / n; }
    for (let n = 1; n <= MAX_POINTS; n++) ntl_mu[n] = 1;
    const sp = new Int32Array(MAX_POINTS + 1);
    for (let i = 2; i <= MAX_POINTS; i++) {
        if (sp[i] === 0) for (let j = i; j <= MAX_POINTS; j += i) if (sp[j] === 0) sp[j] = i;
    }
    for (let n = 2; n <= MAX_POINTS; n++) {
        let m = n, sf = true, c = 0;
        while (m > 1) { const p = sp[m]; let e = 0; while (m % p === 0) { m = (m/p)|0; e++; } c++; if (e>1) sf=false; }
        ntl_omega[n] = c;
        ntl_mu[n] = sf ? (c % 2 === 0 ? 1 : -1) : 0;
    }
    for (let n = 0; n <= MAX_POINTS; n++) ntl_phi[n] = n;
    for (let p = 2; p <= MAX_POINTS; p++) {
        if (ntl_phi[p] === p) for (let m = p; m <= MAX_POINTS; m += p) ntl_phi[m] -= (ntl_phi[m]/p)|0;
    }
    ntl_phi[1] = 1;
    _workerReady = false;  // worker not usable; zeta will compute synchronously below
}

boot();
