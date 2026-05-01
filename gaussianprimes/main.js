// Gaussian Prime Visualizer
// Visualizes primes in various algebraic number fields on a 2D plane.

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let currentField = 'gaussian';
let viewRange    = 20;       // half-width in lattice units
let highlightedP = null;     // rational prime to decompose
let showNorms    = false;
let showGrid     = true;
let showAxes     = true;
let showLabels   = true;
let sym4Only     = false;    // show only first quadrant × 4-fold symmetry

// Pan / zoom
let panX = 0, panY = 0;     // in canvas pixels
let scale = 1;               // extra zoom multiplier

// Drag
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let dragPanX = 0, dragPanY = 0;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas    = document.getElementById('main-canvas');
const ctx       = canvas.getContext('2d');
const tooltip   = document.getElementById('tooltip');

// ── Field definitions ─────────────────────────────────────────────────────────
// Each field describes how to detect primes and how to colour them.

const FIELDS = {
    gaussian: {
        name: 'ℤ[i]',
        basis: [1, 0, 0, 1],   // [e1.re, e1.im, e2.re, e2.im]
        norm: (a, b) => a*a + b*b,
        isPrime: gaussianIsPrime,
        classify: gaussianClassify,
        description:
            'Gaussian integers ℤ[i] = {a+bi : a,b∈ℤ}.\n' +
            'Norm: N(a+bi) = a²+b².\n' +
            'A rational prime p splits if p≡1(mod 4),\n' +
            'stays inert if p≡3(mod 4), and\n' +
            '2 ramifies as −i(1+i)².',
        ufdExample: null,
    },
    eisenstein: {
        name: 'ℤ[ω]',
        basis: [1, 0, -0.5, 0.8660254037844386],  // ω = e^(2πi/3)
        norm: (a, b) => a*a - a*b + b*b,
        isPrime: eisensteinIsPrime,
        classify: eisensteinClassify,
        description:
            'Eisenstein integers ℤ[ω], ω = e^(2πi/3).\n' +
            'Norm: N(a+bω) = a²−ab+b².\n' +
            'p splits if p≡1(mod 3),\n' +
            'stays inert if p≡2(mod 3), and\n' +
            '3 ramifies as −ω²(1−ω)².',
        ufdExample: null,
    },
    zsqrt2n: {
        name: 'ℤ[√−2]',
        basis: [1, 0, 0, 1.4142135623730951],
        norm: (a, b) => a*a + 2*b*b,
        isPrime: (a, b) => isImagQuadPrime(a, b, (x, y) => x*x + 2*y*y),
        classify: (p) => classifyImagQuad(p, 2),
        description:
            'ℤ[√−2] = {a + b√−2 : a,b∈ℤ}.\n' +
            'Norm: N(a+b√−2) = a²+2b².\n' +
            'UFD (class number 1).\n' +
            'p splits if −2 is a QR mod p.',
        ufdExample: null,
    },
    zsqrt5n: {
        name: 'ℤ[√−5]',
        basis: [1, 0, 0, 2.23606797749979],
        norm: (a, b) => a*a + 5*b*b,
        isPrime: (a, b) => isImagQuadPrime(a, b, (a, b) => a*a + 5*b*b),
        classify: (p) => classifyImagQuad(p, 5),
        description:
            'ℤ[√−5]: class number 2 — NOT a UFD!\n' +
            '6 = 2·3 = (1+√−5)(1−√−5)\n' +
            'Two distinct factorisations.\n' +
            'Ideals restore unique factorisation.',
        ufdExample: '6 = 2·3 = (1+√−5)·(1−√−5)',
    },
    zsqrt2: {
        name: 'ℤ[√2]',
        basis: [1, 0, 0, 1.4142135623730951],  // vertical = √2 direction (real)
        norm: (a, b) => Math.abs(a*a - 2*b*b),
        isPrime: (a, b) => isRealQuadPrime(a, b, 2),
        classify: (p) => classifyRealQuad(p, 2),
        description:
            'Real quadratic field ℤ[√2].\n' +
            'Norm: N(a+b√2) = |a²−2b²|.\n' +
            'UFD. Infinitely many units.\n' +
            'Fundamental unit: 1+√2.',
        ufdExample: null,
    },
    zsqrt3: {
        name: 'ℤ[√3]',
        basis: [1, 0, 0, 1.7320508075688772],
        norm: (a, b) => Math.abs(a*a - 3*b*b),
        isPrime: (a, b) => isRealQuadPrime(a, b, 3),
        classify: (p) => classifyRealQuad(p, 3),
        description:
            'Real quadratic field ℤ[√3].\n' +
            'Norm: N(a+b√3) = |a²−3b²|.\n' +
            'UFD. Fundamental unit: 2+√3.',
        ufdExample: null,
    },
};

// ── Small prime sieve ─────────────────────────────────────────────────────────

const SIEVE_MAX = 100000;
const sieve = new Uint8Array(SIEVE_MAX + 1).fill(1);
sieve[0] = sieve[1] = 0;
for (let i = 2; i * i <= SIEVE_MAX; i++) {
    if (sieve[i]) for (let j = i*i; j <= SIEVE_MAX; j += i) sieve[j] = 0;
}

function isRationalPrime(n) {
    n = Math.abs(n);
    if (n < 2) return false;
    if (n <= SIEVE_MAX) return sieve[n] === 1;
    if (n % 2 === 0) return false;
    for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
    return true;
}

// ── Gaussian integer primality & classification ───────────────────────────────

// A Gaussian integer z = a+bi is prime iff:
//   (a=0,|b| prime, |b|≡3 mod 4) or (b=0,|a| prime, |a|≡3 mod 4) or
//   (a²+b² is a rational prime)
function gaussianIsPrime(a, b) {
    if (a === 0 && b === 0) return false;
    if (a === 0) {
        const ab = Math.abs(b);
        return isRationalPrime(ab) && ab % 4 === 3;
    }
    if (b === 0) {
        const aa = Math.abs(a);
        return isRationalPrime(aa) && aa % 4 === 3;
    }
    const n = a*a + b*b;
    return isRationalPrime(n);
}

// Returns 'prime'|'inert'|'split'|'ramified'|'composite'|'unit'
function gaussianClassify(a, b) {
    if (a === 0 && b === 0) return 'zero';
    const na = Math.abs(a), nb = Math.abs(b);
    if ((na === 1 && nb === 0) || (na === 0 && nb === 1)) return 'unit';
    if (gaussianIsPrime(a, b)) {
        const norm = na*na + nb*nb;
        if (norm === 2) return 'ramified';          // 1+i (factor of 2)
        if (nb === 0 && isRationalPrime(na) && na % 4 === 3) return 'inert';
        if (na === 0 && isRationalPrime(nb) && nb % 4 === 3) return 'inert';
        return 'split';
    }
    return 'composite';
}

// ── Eisenstein integer primality & classification ─────────────────────────────

// Eisenstein integers ℤ[ω], norm N(a+bω) = a²−ab+b²
function eisensteinIsPrime(a, b) {
    if (a === 0 && b === 0) return false;
    const n = a*a - a*b + b*b;
    if (n < 0) return false;
    if (isRationalPrime(n)) return true;
    // Inert: p≡2 mod 3, and a+bω is associate to p
    // Associates of rational p are: p, -p, pω, -pω, pω², -pω²
    // Simplest check: norm = p² for rational prime p≡2 mod 3
    const sq = Math.round(Math.sqrt(n));
    if (sq * sq === n && isRationalPrime(sq) && sq % 3 === 2) return true;
    return false;
}

function eisensteinClassify(a, b) {
    if (a === 0 && b === 0) return 'zero';
    const n = a*a - a*b + b*b;
    if (n === 1) return 'unit';   // units: ±1, ±ω, ±ω²
    if (!eisensteinIsPrime(a, b)) return 'composite';
    if (n === 3) return 'ramified';  // 3 ramifies as -ω²(1-ω)²
    const sq = Math.round(Math.sqrt(n));
    if (sq * sq === n && isRationalPrime(sq) && sq % 3 === 2) return 'inert';
    return 'split';
}

// ── Imaginary quadratic field ℤ[√-d] ─────────────────────────────────────────

function isImagQuadPrime(a, b, normFn) {
    if (a === 0 && b === 0) return false;
    const n = normFn(a, b);
    if (n <= 0) return false;
    if (isRationalPrime(n)) return true;
    // Inert primes appear as (p,0) where p is inert
    if (b === 0) {
        const pa = Math.abs(a);
        return isRationalPrime(pa);  // will be coloured by classify
    }
    return false;
}

function classifyImagQuad(p, d) {
    // p: rational prime. Returns 'split'|'inert'|'ramified'
    if (p === 2) {
        // d≡3 mod 8 → split, d≡7 mod 8 → split but...
        // simple Legendre: (-d/2) via Kronecker
        const dmod8 = d % 8;
        if (d % 2 === 0) return 'ramified';
        return (dmod8 === 1 || dmod8 === 7) ? 'split' : 'inert';
    }
    if (p === d) return 'ramified';
    // Legendre symbol (-d / p)
    const leg = legendreSymbol(-d, p);
    if (leg === 1) return 'split';
    if (leg === -1) return 'inert';
    return 'ramified';
}

function legendreSymbol(a, p) {
    // Euler criterion: a^((p-1)/2) mod p
    a = ((a % p) + p) % p;
    if (a === 0) return 0;
    let result = modpow(a, (p - 1) >> 1, p);
    return result === p - 1 ? -1 : result;
}

function modpow(base, exp, mod) {
    let result = 1;
    base %= mod;
    while (exp > 0) {
        if (exp & 1) result = result * base % mod;
        base = base * base % mod;
        exp >>= 1;
    }
    return result;
}

// ── Real quadratic field ℤ[√d] ────────────────────────────────────────────────

function isRealQuadPrime(a, b, d) {
    if (a === 0 && b === 0) return false;
    const n = Math.abs(a*a - d*b*b);
    if (n === 0) return false;
    return isRationalPrime(n);
}

function classifyRealQuad(p, d) {
    if (p * p === d) return 'ramified';
    if (!isRationalPrime(p)) return 'composite';
    const leg = legendreSymbol(d, p);
    if (leg === 1) return 'split';
    if (leg === -1) return 'inert';
    return 'ramified';
}

// ── Decomposition of rational prime p in a field ──────────────────────────────

// Returns list of {a, b, label} for the prime factors of p in the current field
function decomposeRationalPrime(p, field) {
    if (!isRationalPrime(p)) return [];
    const results = [];
    const fd = FIELDS[field];
    const range = Math.ceil(Math.sqrt(p)) + 2;

    if (field === 'gaussian') {
        // Find all Gaussian primes z with N(z)=p
        for (let a = -range; a <= range; a++) {
            for (let b = -range; b <= range; b++) {
                if (a === 0 && b === 0) continue;
                const n = a*a + b*b;
                if (n === p && gaussianIsPrime(a, b)) {
                    results.push({ a, b, label: formatGaussian(a, b) });
                }
            }
        }
        return results;
    }

    if (field === 'eisenstein') {
        for (let a = -range; a <= range; a++) {
            for (let b = -range; b <= range; b++) {
                if (a === 0 && b === 0) continue;
                const n = a*a - a*b + b*b;
                if (n === p && eisensteinIsPrime(a, b)) {
                    results.push({ a, b, label: formatEisenstein(a, b) });
                }
            }
        }
        return results;
    }

    if (field === 'zsqrt2n') {
        const rangeB = Math.ceil(Math.sqrt(p / 2)) + 2;
        for (let a = -range; a <= range; a++) {
            for (let b = -rangeB; b <= rangeB; b++) {
                if (a === 0 && b === 0) continue;
                const n = a*a + 2*b*b;
                if (n === p && isImagQuadPrime(a, b, (a,b) => a*a+2*b*b)) {
                    results.push({ a, b, label: `${a}+${b}√−2` });
                }
            }
        }
        return results;
    }

    // For others just indicate the classification
    return [];
}

// ── Format helpers ────────────────────────────────────────────────────────────

function formatGaussian(a, b) {
    if (b === 0) return `${a}`;
    if (a === 0) return `${b}i`;
    return `${a}${b >= 0 ? '+' : ''}${b}i`;
}

function formatEisenstein(a, b) {
    if (b === 0) return `${a}`;
    if (a === 0) return `${b}ω`;
    return `${a}${b >= 0 ? '+' : ''}${b}ω`;
}

// ── Coordinate transforms ─────────────────────────────────────────────────────

function getTransform() {
    const fd = FIELDS[currentField];
    // Use CSS dimensions so mouse coords (offsetX/Y) align with drawing coords
    const W = canvas.clientWidth, H = canvas.clientHeight;
    // cell size in pixels
    const cellPx = Math.min(W, H) / (viewRange * 2) * scale;
    // Basis vectors in pixels (column-major)
    const e1x = fd.basis[0] * cellPx, e1y = -fd.basis[1] * cellPx;
    const e2x = fd.basis[2] * cellPx, e2y = -fd.basis[3] * cellPx;
    // Origin at canvas centre + pan
    const ox = W / 2 + panX;
    const oy = H / 2 + panY;
    return { ox, oy, e1x, e1y, e2x, e2y, cellPx };
}

function latticeToCanvas(a, b) {
    const t = getTransform();
    return {
        x: t.ox + a * t.e1x + b * t.e2x,
        y: t.oy + a * t.e1y + b * t.e2y,
    };
}

function canvasToLattice(cx, cy) {
    const t = getTransform();
    const dx = cx - t.ox, dy = cy - t.oy;
    // Solve: dx = a*e1x + b*e2x, dy = a*e1y + b*e2y
    const det = t.e1x * t.e2y - t.e2x * t.e1y;
    if (Math.abs(det) < 1e-10) return { a: 0, b: 0 };
    const a = (dx * t.e2y - t.e2x * dy) / det;
    const b = (t.e1x * dy - dx * t.e1y) / det;
    return { a: Math.round(a), b: Math.round(b) };
}

// ── Colour map ────────────────────────────────────────────────────────────────

function classColour(cls) {
    switch (cls) {
        case 'prime':     return '#ffd700';
        case 'inert':     return '#ff6644';
        case 'split':     return '#44aaff';
        case 'ramified':  return '#ff44ff';
        case 'unit':      return '#00f2ff';
        case 'composite': return null;        // drawn differently
        case 'zero':      return '#ffffff';
        default:          return '#888';
    }
}

// ── Draw ──────────────────────────────────────────────────────────────────────

function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#010102';
    ctx.fillRect(0, 0, W, H);

    const fd = FIELDS[currentField];
    const t = getTransform();

    // Compute visible lattice range
    const extra = 2;
    const halfA = Math.ceil(viewRange / scale) + extra;
    const halfB = Math.ceil(viewRange / scale) + extra;

    // ── Grid lines ────────────────────────────────────────────────────────────
    if (showGrid) {
        ctx.strokeStyle = 'rgba(0,242,255,0.07)';
        ctx.lineWidth = 0.5;

        // Lines parallel to e2 (varying a)
        for (let a = -halfA; a <= halfA; a++) {
            const p0 = latticeToCanvas(a, -halfB);
            const p1 = latticeToCanvas(a, halfB);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
        }
        // Lines parallel to e1 (varying b)
        for (let b = -halfB; b <= halfB; b++) {
            const p0 = latticeToCanvas(-halfA, b);
            const p1 = latticeToCanvas(halfA, b);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
        }
    }

    // ── Axes ──────────────────────────────────────────────────────────────────
    if (showAxes) {
        ctx.strokeStyle = 'rgba(0,242,255,0.35)';
        ctx.lineWidth = 1.2;

        const pa0 = latticeToCanvas(-halfA, 0), pa1 = latticeToCanvas(halfA, 0);
        ctx.beginPath(); ctx.moveTo(pa0.x, pa0.y); ctx.lineTo(pa1.x, pa1.y); ctx.stroke();

        const pb0 = latticeToCanvas(0, -halfB), pb1 = latticeToCanvas(0, halfB);
        ctx.beginPath(); ctx.moveTo(pb0.x, pb0.y); ctx.lineTo(pb1.x, pb1.y); ctx.stroke();
    }

    // ── Decomposition lines ───────────────────────────────────────────────────
    let decompPoints = [];
    if (highlightedP && isRationalPrime(highlightedP)) {
        decompPoints = decomposeRationalPrime(highlightedP, currentField);
        if (decompPoints.length > 0) {
            const origin = latticeToCanvas(0, 0);
            ctx.strokeStyle = 'rgba(255,215,0,0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            for (const dp of decompPoints) {
                const pt = latticeToCanvas(dp.a, dp.b);
                ctx.beginPath();
                ctx.moveTo(origin.x, origin.y);
                ctx.lineTo(pt.x, pt.y);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
    }

    // ── Dots ──────────────────────────────────────────────────────────────────
    const dotR = Math.max(1.5, t.cellPx * 0.18);
    const labelThreshold = 14;   // px per cell before labels show

    for (let a = -halfA; a <= halfA; a++) {
        for (let b = -halfB; b <= halfB; b++) {
            // sym4Only: only first quadrant's points for Gaussian
            if (sym4Only && currentField === 'gaussian' && (a < 0 || b < 0)) continue;

            const pos = latticeToCanvas(a, b);
            if (pos.x < -20 || pos.x > W + 20 || pos.y < -20 || pos.y > H + 20) continue;

            const cls = classifyPoint(a, b);
            if (cls === 'zero') {
                // Draw origin marker
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, dotR * 1.4, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }

            const isDecomp = decompPoints.some(dp => dp.a === a && dp.b === b);

            if (cls === 'composite') {
                // Draw small dimmed square
                const s = Math.max(1, dotR * 0.55);
                ctx.fillStyle = 'rgba(40,50,80,0.7)';
                ctx.fillRect(pos.x - s, pos.y - s, s*2, s*2);
                continue;
            }

            const col = classColour(cls);
            if (!col) continue;

            // Glow for primes
            const isPrimeClass = cls === 'prime' || cls === 'inert' || cls === 'split' || cls === 'ramified';

            if (isPrimeClass || isDecomp) {
                const r = isDecomp ? dotR * 2.2 : dotR * 1.6;
                const grd = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, r * 2.5);
                grd.addColorStop(0, col + 'cc');
                grd.addColorStop(1, col + '00');
                ctx.fillStyle = grd;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, r * 2.5, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, isDecomp ? dotR * 1.6 : dotR, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, dotR * 0.6, 0, Math.PI * 2);
                ctx.fill();
            }

            // Norm label
            if (showNorms && t.cellPx > labelThreshold && isPrimeClass) {
                const norm = fd.norm(a, b);
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.font = `${Math.max(7, t.cellPx * 0.22)}px Orbitron`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(norm, pos.x, pos.y + dotR + 1);
            }

            // Coordinate label
            if (showLabels && t.cellPx > labelThreshold * 1.5 && isPrimeClass) {
                ctx.fillStyle = col + 'bb';
                ctx.font = `${Math.max(6, t.cellPx * 0.18)}px Orbitron`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                const lab = fieldLabel(a, b);
                ctx.fillText(lab, pos.x, pos.y - dotR - 1);
            }
        }
    }

    // ── Decomposition highlight rings ─────────────────────────────────────────
    for (const dp of decompPoints) {
        const pos = latticeToCanvas(dp.a, dp.b);
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, dotR * 2.5, 0, Math.PI * 2);
        ctx.stroke();

        if (t.cellPx > 10) {
            ctx.fillStyle = '#ffd700';
            ctx.font = `${Math.max(7, t.cellPx * 0.2)}px Orbitron`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(dp.label, pos.x, pos.y - dotR * 3);
        }
    }

    // ── Axis labels ───────────────────────────────────────────────────────────
    if (showAxes) {
        ctx.fillStyle = 'rgba(0,242,255,0.7)';
        ctx.font = '11px Orbitron';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const axisEnd = latticeToCanvas(halfA - 1, 0);
        ctx.fillText(axisLabel1(), axisEnd.x - 10, axisEnd.y - 4);

        ctx.textAlign = 'right';
        const axisEnd2 = latticeToCanvas(0, halfB - 1);
        ctx.fillText(axisLabel2(), axisEnd2.x + 18, axisEnd2.y + 14);
    }
}

function classifyPoint(a, b) {
    const fd = FIELDS[currentField];
    switch (currentField) {
        case 'gaussian':   return gaussianClassify(a, b);
        case 'eisenstein': return eisensteinClassify(a, b);
        case 'zsqrt2n': {
            if (a === 0 && b === 0) return 'zero';
            const n = a*a + 2*b*b;
            if (n === 1) return 'unit';
            if (isImagQuadPrime(a, b, (a,b) => a*a+2*b*b)) {
                if (n === 2) return 'ramified';
                const sq = Math.round(Math.sqrt(n));
                if (sq*sq === n && isRationalPrime(sq)) {
                    return sq % 8 === 3 || sq % 8 === 5 ? 'inert' : 'split';
                }
                return isRationalPrime(n) ? 'split' : 'prime';
            }
            return 'composite';
        }
        case 'zsqrt5n': {
            if (a === 0 && b === 0) return 'zero';
            const n = a*a + 5*b*b;
            if (n === 1) return 'unit';
            if (isImagQuadPrime(a, b, (a,b) => a*a+5*b*b)) {
                if (n === 5) return 'ramified';
                const sq = Math.round(Math.sqrt(n));
                if (sq*sq === n && isRationalPrime(sq)) return 'inert';
                return isRationalPrime(n) ? 'split' : 'prime';
            }
            return 'composite';
        }
        case 'zsqrt2': {
            if (a === 0 && b === 0) return 'zero';
            const n = Math.abs(a*a - 2*b*b);
            if (n === 1) return 'unit';
            if (isRealQuadPrime(a, b, 2)) {
                // 2 ramifies in ℤ[√2]: norm is a power of 2
                if (n > 0 && (n & (n - 1)) === 0) return 'ramified';
                return isRationalPrime(n) ? 'split' : 'prime';
            }
            return 'composite';
        }
        case 'zsqrt3': {
            if (a === 0 && b === 0) return 'zero';
            const n = Math.abs(a*a - 3*b*b);
            if (n === 1) return 'unit';
            if (isRealQuadPrime(a, b, 3)) {
                // 3 ramifies in ℤ[√3]: norm is a power of 3
                let k = n;
                while (k > 1 && k % 3 === 0) k = Math.floor(k / 3);
                if (k === 1) return 'ramified';
                return isRationalPrime(n) ? 'split' : 'prime';
            }
            return 'composite';
        }
    }
    return 'composite';
}

function fieldLabel(a, b) {
    switch (currentField) {
        case 'gaussian':   return formatGaussian(a, b);
        case 'eisenstein': return formatEisenstein(a, b);
        case 'zsqrt2n':    return b === 0 ? `${a}` : `${a}${b>=0?'+':''}${b}√−2`;
        case 'zsqrt5n':    return b === 0 ? `${a}` : `${a}${b>=0?'+':''}${b}√−5`;
        case 'zsqrt2':     return b === 0 ? `${a}` : `${a}${b>=0?'+':''}${b}√2`;
        case 'zsqrt3':     return b === 0 ? `${a}` : `${a}${b>=0?'+':''}${b}√3`;
    }
    return `${a}`;
}

function axisLabel1() {
    switch (currentField) {
        case 'gaussian': return 'Re';
        case 'eisenstein': return '1';
        default: return '1';
    }
}

function axisLabel2() {
    switch (currentField) {
        case 'gaussian': return 'Im';
        case 'eisenstein': return 'ω';
        case 'zsqrt2n': return '√−2';
        case 'zsqrt5n': return '√−5';
        case 'zsqrt2': return '√2';
        case 'zsqrt3': return '√3';
    }
    return 'Im';
}

// ── UI update ─────────────────────────────────────────────────────────────────

function updateFieldInfo() {
    const fd = FIELDS[currentField];
    document.getElementById('field-description').textContent = fd.description;
    document.getElementById('ufd-example').textContent = fd.ufdExample || '';
}

function updatePrimeInfo(p) {
    const el = document.getElementById('prime-info');
    if (!p || !isRationalPrime(p)) {
        el.textContent = '';
        return;
    }
    const decompPoints = decomposeRationalPrime(p, currentField);
    let classStr = '';
    switch (currentField) {
        case 'gaussian': {
            if (p === 2) classStr = 'ramified: 2 = −i(1+i)²';
            else if (p % 4 === 1) classStr = `splits: N=${p}`;
            else classStr = 'inert (stays prime)';
            break;
        }
        case 'eisenstein': {
            if (p === 3) classStr = 'ramified: 3 = −ω²(1−ω)²';
            else if (p % 3 === 1) classStr = `splits: N=${p}`;
            else classStr = 'inert (stays prime)';
            break;
        }
        default:
            classStr = decompPoints.length > 0 ? 'splits' : 'inert or ramified';
    }
    const labels = decompPoints.map(dp => dp.label).join(', ');
    el.textContent = `p=${p}: ${classStr}` + (labels ? `\n→ ${labels}` : '');
}

// ── Control handlers ──────────────────────────────────────────────────────────

function setField(val) {
    currentField = val;
    highlightedP = null;
    document.getElementById('prime-input').value = '';
    document.getElementById('prime-info').textContent = '';
    updateFieldInfo();
    draw();
}

function setRange(val) {
    viewRange = val;
    document.getElementById('range-val').textContent = val;
    draw();
}

function highlightPrime(p) {
    highlightedP = (p >= 2 && isRationalPrime(p)) ? p : null;
    updatePrimeInfo(p || null);
    draw();
}

function clearHighlight() {
    highlightedP = null;
    document.getElementById('prime-input').value = '';
    document.getElementById('prime-info').textContent = '';
    draw();
}

function toggleNorms() {
    showNorms = !showNorms;
    document.getElementById('toggle-norms').classList.toggle('on', showNorms);
    draw();
}
function toggleGrid() {
    showGrid = !showGrid;
    document.getElementById('toggle-grid').classList.toggle('on', showGrid);
    draw();
}
function toggleAxes() {
    showAxes = !showAxes;
    document.getElementById('toggle-axes').classList.toggle('on', showAxes);
    draw();
}
function toggleLabels() {
    showLabels = !showLabels;
    document.getElementById('toggle-labels').classList.toggle('on', showLabels);
    draw();
}
function toggleSym4() {
    sym4Only = !sym4Only;
    document.getElementById('toggle-sym4').classList.toggle('on', sym4Only);
    draw();
}

// ── Mouse / touch ─────────────────────────────────────────────────────────────

function pointerDown(x, y) {
    isDragging = true;
    dragStartX = x;
    dragStartY = y;
    dragPanX = panX;
    dragPanY = panY;
}

function pointerMove(x, y) {
    if (isDragging) {
        panX = dragPanX + (x - dragStartX);
        panY = dragPanY + (y - dragStartY);
        draw();
    }

    // Tooltip
    const { a, b } = canvasToLattice(x, y);
    const cls = classifyPoint(a, b);
    if (cls === 'composite' || cls === 'zero') {
        tooltip.style.display = 'none';
        return;
    }
    const fd = FIELDS[currentField];
    const norm = fd.norm(a, b);
    const label = fieldLabel(a, b);
    let lines = [`${label}`, `type: ${cls}`, `norm: ${norm}`];
    if (cls === 'inert' || cls === 'split' || cls === 'ramified') {
        lines.push(`rational: ${Math.round(Math.sqrt(Math.abs(norm)))}`);
    }
    tooltip.textContent = lines.join('\n');
    tooltip.style.display = 'block';
    tooltip.style.left = (x + 14) + 'px';
    tooltip.style.top  = (y - 10) + 'px';
}

function pointerUp() {
    isDragging = false;
}

function wheelZoom(e, cx, cy) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    // Keep the lattice point under the pointer fixed:
    // canvas origin is at (W/2 + panX, H/2 + panY), so pointer offset from
    // origin is (cx - W/2 - panX). After scaling, pan must shift by the
    // difference so that offset stays at the same canvas pixel.
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const ox = W / 2 + panX;
    const oy = H / 2 + panY;
    panX += (cx - ox) * (factor - 1);
    panY += (cy - oy) * (factor - 1);
    scale *= factor;
    scale = Math.max(0.2, Math.min(scale, 30));
    draw();
}

canvas.addEventListener('mousedown', e => pointerDown(e.offsetX, e.offsetY));
canvas.addEventListener('mousemove', e => {
    pointerMove(e.offsetX, e.offsetY);
});
canvas.addEventListener('mouseup',   () => { pointerUp(); tooltip.style.display = 'none'; });
canvas.addEventListener('mouseleave',() => { pointerUp(); tooltip.style.display = 'none'; });
canvas.addEventListener('wheel',     e => wheelZoom(e, e.offsetX, e.offsetY), { passive: false });

// Touch
let lastTouchDist = 0;
canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
        const t = e.touches[0];
        pointerDown(t.clientX - canvas.getBoundingClientRect().left,
                    t.clientY - canvas.getBoundingClientRect().top);
    } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.hypot(dx, dy);
    }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 1) {
        const t = e.touches[0];
        pointerMove(t.clientX - canvas.getBoundingClientRect().left,
                    t.clientY - canvas.getBoundingClientRect().top);
    } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / lastTouchDist;
        lastTouchDist = dist;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - canvas.getBoundingClientRect().left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - canvas.getBoundingClientRect().top;
        panX = midX + (panX - midX) * factor;
        panY = midY + (panY - midY) * factor;
        scale *= factor;
        scale = Math.max(0.2, Math.min(scale, 30));
        draw();
    }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', () => pointerUp());

// ── Resize ────────────────────────────────────────────────────────────────────

function resize() {
    const container = document.getElementById('canvas-container');
    const dpr = window.devicePixelRatio || 1;
    const W = container.clientWidth;
    const H = container.clientHeight;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
}

window.addEventListener('resize', resize);

// ── Expose to HTML onchange handlers ─────────────────────────────────────────

window.setField       = setField;
window.setRange       = setRange;
window.highlightPrime = highlightPrime;
window.clearHighlight = clearHighlight;
window.toggleNorms    = toggleNorms;
window.toggleGrid     = toggleGrid;
window.toggleAxes     = toggleAxes;
window.toggleLabels   = toggleLabels;
window.toggleSym4     = toggleSym4;

// ── Boot ──────────────────────────────────────────────────────────────────────

updateFieldInfo();
resize();
