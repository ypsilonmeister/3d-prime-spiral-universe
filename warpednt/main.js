// Warped Number Theory Universe Explorer
// Educational visualisation of metric spaces on integers.
// NOT a rigorous implementation of Arakelov geometry — conceptual only.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Riemann zeta zeros (imaginary parts) ─────────────────────────────────────
const ZETA_ZEROS = [
    14.134725, 21.022040, 25.010858, 30.424876, 32.935062,
    37.586178, 40.918719, 43.327073, 48.005151, 49.773832,
    52.970321, 56.446247, 59.347044, 60.831779, 65.112544,
    67.079811, 69.546401, 72.067157, 75.704691, 77.144840,
];

// ── Number theory tables ──────────────────────────────────────────────────────
const MAX_N = 32001;

const _sieve = new Uint8Array(MAX_N + 1).fill(1);
_sieve[0] = _sieve[1] = 0;
for (let i = 2; i * i <= MAX_N; i++)
    if (_sieve[i]) for (let j = i * i; j <= MAX_N; j += i) _sieve[j] = 0;

const _spf = new Uint16Array(MAX_N + 1); // smallest prime factor
for (let i = 0; i <= MAX_N; i++) _spf[i] = i;
for (let i = 2; i * i <= MAX_N; i++)
    if (_spf[i] === i) for (let j = i * i; j <= MAX_N; j += i)
        if (_spf[j] === j) _spf[j] = i;

function isPrime(n) { return n >= 2 && _sieve[n] === 1; }

function padicValuation(n, p) {
    if (n === 0) return Infinity;
    if (p <= 1) return 0;  // guard against infinite loop
    let v = 0;
    while (n % p === 0) { n = Math.floor(n / p); v++; }
    return v;
}

function padicNorm(n, p) {
    const v = padicValuation(n, p);
    return v === Infinity ? 0 : Math.pow(p, -v);
}

function mobius(n) {
    if (n === 1) return 1;
    let k = n, factors = 0;
    while (k > 1) {
        const p = _spf[k];
        k = Math.floor(k / p);
        if (k % p === 0) return 0;
        factors++;
    }
    return factors % 2 === 0 ? 1 : -1;
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentMetric  = 'padic';
let padicPrime     = 2;
let warpStrength   = 1.0;
let pointCount     = 8000;
let currentLayout  = 'spiral';
let colorMode      = 'prime';
let einsteinMode   = false;
let zetaOverlay    = false;
let autoRotate     = true;
let showLabels     = true;
let lerpActive     = false;
const LERP_SPEED   = 0.04;
const LERP_EPS_SQ  = 1e-6;

// Metric blend weights (adelic mode) — stored as fractions [0,1] matching slider/100
const blendWeights = { euclidean: 0, log: 0, p2: 1, p3: 0, p5: 0 };

// ── Three.js scene ────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');
const renderer  = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x010102);
scene.fog = new THREE.FogExp2(0x010102, 0.008);

const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 2000);
camera.position.set(0, 0, 180);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.4;

// ── Shader ────────────────────────────────────────────────────────────────────
const vertexShader = /* glsl */`
attribute float size;
attribute vec3  customColor;
attribute float number;

uniform float uViewH;

varying vec3  vColor;
varying float vDist;
varying float vSize;
varying float vNumber;

void main() {
    vColor  = customColor;
    vNumber = number;
    vSize   = size;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist   = -mv.z;
    gl_PointSize = max(size * (uViewH * 1.2 / vDist), 0.0);
    gl_Position  = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */`
uniform sampler2D starTex;

varying vec3  vColor;
varying float vDist;
varying float vSize;
varying float vNumber;

void main() {
    if (vSize < 0.1) discard;
    vec2 uv  = gl_PointCoord;
    vec4 tex = texture2D(starTex, uv);
    if (tex.a < 0.01) discard;
    gl_FragColor = vec4(vColor * tex.rgb * 1.6, tex.a);
}
`;

// Radial glow texture
function makeStarTex() {
    const size = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const cx = cv.getContext('2d');
    const grd = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0,    'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.6,  'rgba(255,255,255,0.2)');
    grd.addColorStop(1,    'rgba(255,255,255,0)');
    cx.fillStyle = grd;
    cx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cv);
}

const material = new THREE.ShaderMaterial({
    uniforms: {
        starTex:  { value: makeStarTex() },
        uViewH:   { value: container.clientHeight },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
});

// ── Geometry & attributes ─────────────────────────────────────────────────────
const MAX_POINTS = 32000;

const geometry       = new THREE.BufferGeometry();
const positions      = new Float32Array(MAX_POINTS * 3);
const targetPos      = new Float32Array(MAX_POINTS * 3);
const basePos        = new Float32Array(MAX_POINTS * 3);  // euclidean base
const colors         = new Float32Array(MAX_POINTS * 3);
const sizes          = new Float32Array(MAX_POINTS);
const numbers        = new Float32Array(MAX_POINTS);

geometry.setAttribute('position',    new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('customColor', new THREE.BufferAttribute(colors,    3));
geometry.setAttribute('size',        new THREE.BufferAttribute(sizes,     1));
geometry.setAttribute('number',      new THREE.BufferAttribute(numbers,   1));
geometry.setDrawRange(0, pointCount);

const points = new THREE.Points(geometry, material);
scene.add(points);

// ── Position calculation ──────────────────────────────────────────────────────

// Base layout positions (euclidean, before metric warp)
function computeBaseLayout() {
    const N = pointCount;
    if (currentLayout === 'line') {
        for (let i = 0; i < N; i++) {
            const n = i + 1;
            basePos[i*3]   = (n / N - 0.5) * 200;
            basePos[i*3+1] = 0;
            basePos[i*3+2] = 0;
        }
    } else if (currentLayout === 'shell') {
        // Fibonacci sphere
        const phi = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < N; i++) {
            const y   = 1 - (i / (N - 1)) * 2;
            const r   = Math.sqrt(1 - y * y);
            const th  = phi * i;
            const R   = 80;
            basePos[i*3]   = R * r * Math.cos(th);
            basePos[i*3+1] = R * y;
            basePos[i*3+2] = R * r * Math.sin(th);
        }
    } else {
        // Ulam spiral variant (3D)
        for (let i = 0; i < N; i++) {
            const n   = i + 1;
            const ang = n * 0.618033988749 * Math.PI * 2;  // golden angle
            const r   = Math.sqrt(n) * 2.2;
            const h   = (n / N - 0.5) * 60;
            basePos[i*3]   = r * Math.cos(ang);
            basePos[i*3+1] = h;
            basePos[i*3+2] = r * Math.sin(ang);
        }
    }
}

// Metric distance: maps integer n to a scalar distance from "origin"
function metricDist(n) {
    if (n <= 0) return 0;
    switch (currentMetric) {
        case 'euclidean': return n;
        case 'log':       return Math.log(n + 1);
        case 'padic':     return padicNorm(n, padicPrime);
        case 'adelic':    return adelicDist(n);
        case 'arakelov':  return arakelovDist(n);
    }
    return n;
}

function adelicDist(n) {
    const w = blendWeights;
    const total = w.euclidean + w.log + w.p2 + w.p3 + w.p5;
    if (total < 1e-9) return 1;
    return (
        w.euclidean * (n / MAX_N) +
        w.log  * (Math.log(n + 1) / Math.log(MAX_N)) +
        w.p2   * padicNorm(n, 2) +
        w.p3   * padicNorm(n, 3) +
        w.p5   * padicNorm(n, 5)
    ) / total;
}

// Arakelov-style: combines log with archimedean and non-archimedean data
function arakelovDist(n) {
    const arch    = Math.log(n + 1) / Math.log(MAX_N);
    const nonarch = (padicNorm(n, 2) + padicNorm(n, 3) + padicNorm(n, 5)) / 3;
    return (arch + nonarch) / 2;
}

// Einstein warp: prime density in neighbourhood bends space
function einsteinWarp(i, baseR) {
    const n = i + 1;
    // Count primes in [n-10, n+10]
    let density = 0;
    for (let k = Math.max(2, n - 10); k <= Math.min(MAX_N, n + 10); k++)
        if (isPrime(k)) density++;
    const kappa = 1 + density * 0.15;  // curvature factor
    return baseR * kappa;
}

// Zeta oscillation along y-axis
function zetaOffset(n, numZeros) {
    let sum = 0;
    for (let k = 0; k < Math.min(numZeros, ZETA_ZEROS.length); k++) {
        const gamma = ZETA_ZEROS[k];
        sum += Math.sin(gamma * Math.log(n)) / Math.sqrt(gamma);
    }
    return sum * 4;
}

function computeTargetPositions() {
    computeBaseLayout();
    const N = pointCount;

    for (let i = 0; i < N; i++) {
        const n = i + 1;

        // Base position from layout
        const bx = basePos[i*3], by = basePos[i*3+1], bz = basePos[i*3+2];
        const baseR = Math.sqrt(bx*bx + by*by + bz*bz) + 1e-9;

        // Euclidean distance used for normalization
        const eucR = (n / MAX_N) * 100;

        // Target metric distance, normalised to [0, 100] for consistent radius scaling.
        // euclidean and log are computed directly; adelic/arakelov/padic return [0,1] already.
        let normM;
        switch (currentMetric) {
            case 'euclidean': normM = (n / MAX_N) * 100; break;
            case 'log':       normM = (Math.log(n + 1) / Math.log(MAX_N)) * 100; break;
            case 'padic':     normM = padicNorm(n, padicPrime) * 100; break;
            default:          normM = metricDist(n) * 100; break;  // adelic/arakelov: already [0,1]
        }

        // Blend between base layout direction × euclidean radius and metric-warped radius
        const warpedR = normM;
        const blendedR = eucR * (1 - warpStrength) + warpedR * warpStrength;

        // Scale base position to blended radius
        const scale = blendedR / baseR;
        let tx = bx * scale;
        let ty = by * scale;
        let tz = bz * scale;

        // Einstein warp — clamp factor to avoid blow-up when blendedR ≈ 0
        if (einsteinMode) {
            const safeR = Math.max(blendedR, 0.1);
            const ef = Math.min(einsteinWarp(i, safeR) / safeR, 3.0);
            tx *= ef; ty *= ef; tz *= ef;
        }

        // Zeta overlay along y
        if (zetaOverlay) {
            ty += zetaOffset(n, 10);
        }

        targetPos[i*3]   = tx;
        targetPos[i*3+1] = ty;
        targetPos[i*3+2] = tz;
    }

    lerpActive = true;
}

// ── Color & size update ───────────────────────────────────────────────────────

function updateVisuals() {
    const N = pointCount;
    const col = geometry.attributes.customColor.array;
    const sz  = geometry.attributes.size.array;
    const num = geometry.attributes.number.array;

    // Pre-compute metric range for normalization
    let maxM = 1;
    if (colorMode === 'metric') {
        for (let i = 0; i < N; i++) {
            const d = metricDist(i + 1);
            if (d > maxM) maxM = d;
        }
    }

    for (let i = 0; i < N; i++) {
        const n = i + 1;
        num[i] = n;

        let r = 0.3, g = 0.3, b = 0.3;
        let s = 3.0;

        switch (colorMode) {
            case 'prime': {
                if (isPrime(n)) {
                    r = 1.0; g = 0.85; b = 0.0;   // gold
                    s = 8.0;
                } else {
                    // Hue from smallest prime factor
                    const p = _spf[n];
                    const hue = ((p * 37) % 360) / 360;
                    const [hr, hg, hb] = hsl(hue, 0.6, 0.35);
                    r = hr; g = hg; b = hb;
                    s = 3.5;
                }
                break;
            }
            case 'padic': {
                const v = padicValuation(n, padicPrime);
                const t = Math.min(v / 6, 1);
                r = 0.0 + t * 0.0;
                g = 0.3 + t * 0.7;
                b = 1.0 - t * 0.5;
                s = 3.5 + t * 8;
                break;
            }
            case 'metric': {
                const d = metricDist(n) / maxM;
                // Cool → warm gradient
                r = d;
                g = 0.3 * (1 - d);
                b = 1.0 - d;
                s = 4.0;
                break;
            }
            case 'mobius': {
                const mu = mobius(n);
                if (mu === 1)       { r = 0.2; g = 0.8; b = 1.0; s = 5.0; }
                else if (mu === -1) { r = 1.0; g = 0.3; b = 0.2; s = 5.0; }
                else                { r = 0.2; g = 0.2; b = 0.2; s = 2.0; }
                break;
            }
        }

        col[i*3] = r; col[i*3+1] = g; col[i*3+2] = b;
        sz[i] = s;
    }

    geometry.attributes.customColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
    geometry.attributes.number.needsUpdate = true;
}

// HSL helper
function hsl(h, s, l) {
    const c  = (1 - Math.abs(2*l - 1)) * s;
    const x  = c * (1 - Math.abs((h * 6) % 2 - 1));
    const m  = l - c / 2;
    let r=0, g=0, b=0;
    const h6 = h * 6;
    if      (h6 < 1) { r=c; g=x; }
    else if (h6 < 2) { r=x; g=c; }
    else if (h6 < 3) { g=c; b=x; }
    else if (h6 < 4) { g=x; b=c; }
    else if (h6 < 5) { r=x; b=c; }
    else             { r=c; b=x; }
    return [r+m, g+m, b+m];
}

// ── Animate ───────────────────────────────────────────────────────────────────

let _lastTime = 0;

function animate(now = 0) {
    const dt = Math.min((now - _lastTime) / 1000, 0.1);
    _lastTime = now;

    // Lerp positions
    if (lerpActive) {
        const pos = geometry.attributes.position.array;
        const limit = pointCount * 3;
        let maxDSq = 0;
        for (let i = 0; i < limit; i++) {
            const delta = (targetPos[i] - pos[i]) * LERP_SPEED;
            pos[i] += delta;
            if (delta * delta > maxDSq) maxDSq = delta * delta;
        }
        geometry.attributes.position.needsUpdate = true;
        if (maxDSq < LERP_EPS_SQ) lerpActive = false;
    }

    controls.update();
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

// ── Resize ────────────────────────────────────────────────────────────────────

function resize() {
    const W = container.clientWidth, H = container.clientHeight;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    material.uniforms.uViewH.value = H;
}
window.addEventListener('resize', resize);

// ── Raycaster for hover ───────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 2.5;
const mouse = new THREE.Vector2(-9999, -9999);
const hoverEl = document.getElementById('hover-info');

container.addEventListener('mousemove', e => {
    const rect = container.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

    hoverEl.style.left = (e.clientX + 14) + 'px';
    hoverEl.style.top  = (e.clientY - 10) + 'px';

    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(points);
    if (hits.length > 0) {
        const idx = hits[0].index;
        const n   = idx + 1;
        const md  = metricDist(n).toFixed(4);
        const pv  = padicValuation(n, padicPrime);
        const mu  = mobius(n);
        const tag = isPrime(n) ? 'PRIME' : `spf=${_spf[n]}`;
        hoverEl.textContent =
            `n = ${n}  [${tag}]\n` +
            `metric(${currentMetric}): ${md}\n` +
            `|n|_${padicPrime} = ${padicNorm(n, padicPrime).toFixed(4)}  (v=${pv})\n` +
            `μ(n) = ${mu}`;
        hoverEl.style.display = 'block';
    } else {
        hoverEl.style.display = 'none';
    }
});
container.addEventListener('mouseleave', () => { hoverEl.style.display = 'none'; });

// ── Control handlers ──────────────────────────────────────────────────────────

function rebuild() {
    geometry.setDrawRange(0, pointCount);
    computeTargetPositions();
    updateVisuals();
}

function setMetric(val) {
    currentMetric = val;
    updateMetricDescription();
    computeTargetPositions();
    updateVisuals();
}

function setWarp(val) {
    warpStrength = val / 100;
    document.getElementById('warp-val').textContent = (val / 100).toFixed(2);
    computeTargetPositions();
}

function setBlend(key, val) {
    blendWeights[key] = val / 100;  // slider is 0-100; store as fraction [0,1]
    document.getElementById(`blend-${key}-val`).textContent = val;
    if (currentMetric === 'adelic') computeTargetPositions();
}

function setPadicPrime(val) {
    padicPrime = val;
    if (currentMetric === 'padic') computeTargetPositions();
    if (colorMode === 'padic') updateVisuals();
}

function setCount(val) {
    pointCount = val;
    document.getElementById('count-val').textContent = val;
    rebuild();
}

function setLayout(val) {
    currentLayout = val;
    rebuild();
}

function setColorMode(val) {
    colorMode = val;
    updateVisuals();
}

function toggleEinstein() {
    einsteinMode = !einsteinMode;
    document.getElementById('toggle-einstein').classList.toggle('on', einsteinMode);
    computeTargetPositions();
}

function toggleZeta() {
    zetaOverlay = !zetaOverlay;
    document.getElementById('toggle-zeta').classList.toggle('on', zetaOverlay);
    computeTargetPositions();
}

function toggleRotate() {
    autoRotate = !autoRotate;
    controls.autoRotate = autoRotate;
    document.getElementById('toggle-rotate').classList.toggle('on', autoRotate);
}

function toggleLabels() {
    showLabels = !showLabels;
    document.getElementById('toggle-labels').classList.toggle('on', showLabels);
}

// ── Metric descriptions ───────────────────────────────────────────────────────

const METRIC_DESCRIPTIONS = {
    euclidean:
        '|n| — standard distance on ℝ.\n' +
        'Primes appear irregular, thinning\n' +
        'by the prime number theorem.\n' +
        'The familiar number line.',
    log:
        'log n — logarithmic metric.\n' +
        'Equal steps on a log scale.\n' +
        'Prime density becomes nearly\n' +
        'uniform (PNT: π(x) ~ x/ln x).',
    padic:
        '|n|_p = p^{-v_p(n)} — p-adic norm.\n' +
        'Divisibility by p contracts\n' +
        'numbers toward the origin.\n' +
        'Powers of p cluster at center.',
    adelic:
        'Adelic = blend of archimedean\n' +
        '(Euclidean/log) and non-arch\n' +
        '(multiple p-adic) metrics.\n' +
        'Adjust blend sliders freely.',
    arakelov:
        'Arakelov-style: combines the\n' +
        'archimedean place (log) with\n' +
        'three non-archimedean places.\n' +
        '⚠ Conceptual only — not rigorous.',
};

function updateMetricDescription() {
    document.getElementById('metric-description').textContent =
        METRIC_DESCRIPTIONS[currentMetric] || '';
}

// ── Expose to HTML ────────────────────────────────────────────────────────────
window.setMetric      = setMetric;
window.setWarp        = setWarp;
window.setBlend       = setBlend;
window.setPadicPrime  = setPadicPrime;
window.setCount       = setCount;
window.setLayout      = setLayout;
window.setColorMode   = setColorMode;
window.toggleEinstein = toggleEinstein;
window.toggleZeta     = toggleZeta;
window.toggleRotate   = toggleRotate;
window.toggleLabels   = toggleLabels;

// ── Boot ──────────────────────────────────────────────────────────────────────
updateMetricDescription();
rebuild();
