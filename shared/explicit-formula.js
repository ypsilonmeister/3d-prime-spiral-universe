// Explicit-formula math core (pure functions, no DOM / no Three.js).
// Single source of truth shared by worker.js, the main-thread zeta fallback
// (app/modes/zeta.js), scripts/verify-explicit-formula.mjs and future modes.
//
//   psi(x)  = sum_{n<=x} Lambda(n)
//   psi1(x) = sum_{n<=x} Lambda(n)(x-n) = x*psi(x) - S1(x),  S1(x) = sum_{n<=x} n Lambda(n)
//   psi0(x) = x - sum_{Im rho>0} 2Re(x^rho/rho) - ln(2pi) - (1/2)ln(1-x^-2)
//   zero sum (psi part, rho = 1/2 + i gamma):
//       Z_N(x) = -sum_{k<=N} 2Re(x^rho_k/rho_k)
//              = -2 sqrt(x) sum_k (cos(g ln x)/2 + g sin(g ln x)) / (1/4 + g^2)
// RH is ASSUMED only for the Schoenfeld bounds below; nothing here proves it.

// ---- sampling ------------------------------------------------------------

// M log-equally-spaced points on [xMin, xMax] (inclusive, M >= 2).
export function logSpacedSamples(xMin, xMax, M) {
    const out = new Float64Array(M);
    if (M === 1) { out[0] = xMin; return out; }
    const lo = Math.log(xMin), step = (Math.log(xMax) - lo) / (M - 1);
    for (let i = 0; i < M; i++) out[i] = Math.exp(lo + step * i);
    out[0] = xMin;
    out[M - 1] = xMax;
    return out;
}

// ---- measured psi / psi1 -------------------------------------------------

// Lambda(n) for n in [0, max] from a smallest-prime-factor table (spf[n] = least prime factor).
export function buildLambda(max, spf) {
    const lam = new Float64Array(max + 1);
    for (let n = 2; n <= max; n++) {
        const p = spf[n];
        let m = n;
        while (m % p === 0) m /= p;
        if (m === 1) lam[n] = Math.log(p);
    }
    return lam;
}

// Cumulative tables over n = 0..max (Float64): PSI[n] = psi(n), S1[n] = sum k Lambda(k), PSI1[n] = psi1(n).
export function buildPsiTables(max, spf) {
    const lam = buildLambda(max, spf);
    const PSI = new Float64Array(max + 1), S1 = new Float64Array(max + 1), PSI1 = new Float64Array(max + 1);
    for (let n = 1; n <= max; n++) {
        PSI[n] = PSI[n - 1] + lam[n];
        S1[n] = S1[n - 1] + n * lam[n];
        PSI1[n] = n * PSI[n] - S1[n];
    }
    return { max, PSI, S1, PSI1 };
}

// Measured psi(x) and psi1(x) at real x in [0, max].
export function measuredPsi(t, x) { return t.PSI[Math.floor(x)]; }
export function measuredPsi1(t, x) { const f = Math.floor(x); return x * t.PSI[f] - t.S1[f]; }
// Measured fluctuations: psi(x) - x and psi1(x) - x^2/2.
export function measuredFluctPsi(t, x) { return measuredPsi(t, x) - x; }
export function measuredFluctPsi1(t, x) { return measuredPsi1(t, x) - x * x / 2; }

// ---- zero sum (psi) ------------------------------------------------------

// zetaDenom[k] = 1/4 + gamma_k^2
export function buildZetaDenom(zeros) {
    const d = new Float64Array(zeros.length);
    for (let k = 0; k < zeros.length; k++) d[k] = 0.25 + zeros[k] * zeros[k];
    return d;
}

// Precomputed ln x and sqrt x for x = 1..count (index i <-> x = i+1).
export function buildLnSqrtCaches(count) {
    const ln = new Float64Array(count), sq = new Float64Array(count);
    for (let i = 0; i < count; i++) { ln[i] = Math.log(i + 1); sq[i] = Math.sqrt(i + 1); }
    return { ln, sq };
}

// Accumulate the positive partial sum  S[i] += sum_{k=kFrom}^{kTo-1} sqrt(x_i)(cos/2 + g sin)/(1/4+g^2)
// for every sample i (so Z_N = -2*S after kFrom=0..kTo=N). Resuming from a previous kTo with the same S
// gives bit-identical results to a single pass, which allows incremental growth of N.
// lnArr/sqrtArr: ln x_i and sqrt x_i; denom: buildZetaDenom(zeros).
export function accumulateZeroSumPsi(S, lnArr, sqrtArr, zeros, denom, kFrom, kTo) {
    const n = S.length;
    for (let i = 0; i < n; i++) {
        const lnx = lnArr[i], sqrtx = sqrtArr[i];
        let sum = S[i];
        for (let k = kFrom; k < kTo; k++) {
            const g = zeros[k];
            const angle = g * lnx;
            sum += sqrtx * (Math.cos(angle) * 0.5 + Math.sin(angle) * g) / denom[k];
        }
        S[i] = sum;
    }
    return S;
}

// Convenience: raw zero sum Z_N(x_i) = -2 * S for the first N zeros, as a new Float64Array.
export function zeroSumPsiRaw(lnArr, sqrtArr, zeros, denom, N) {
    const S = new Float64Array(lnArr.length);
    accumulateZeroSumPsi(S, lnArr, sqrtArr, zeros, denom, 0, N);
    for (let i = 0; i < S.length; i++) S[i] = -2.0 * S[i];
    return S;
}

// Single-point explicit psi0 reconstruction with the first N zeros (verification script).
export function explicitPsi(x, N, zeros) {
    const L = Math.log(x), sx = Math.sqrt(x);
    let s = 0;
    for (let k = 0; k < N; k++) {
        const g = zeros[k], a = g * L;
        s += (0.5 * Math.cos(a) + g * Math.sin(a)) / (0.25 + g * g);
    }
    return x - 2 * sx * s - LN2PI - 0.5 * Math.log(1 - 1 / (x * x));
}

// psi1 explicit formula with the first N zeros:
// x^(rho+1)/(rho(rho+1)), rho(rho+1) = (3/4 - g^2) + 2ig.
export const LN2PI = Math.log(2 * Math.PI);
export const ZP_M1 = 1.98505372440541115; // zeta'/zeta(-1)
export function explicitPsi1(x, N, zeros) {
    const L = Math.log(x), x15 = x * Math.sqrt(x);
    let s = 0;
    for (let k = 0; k < N; k++) {
        const g = zeros[k], a = g * L, c = Math.cos(a), sn = Math.sin(a);
        const dr = 0.75 - g * g, di = 2 * g, d2 = dr * dr + di * di;
        s += (c * dr + sn * di) / d2;
    }
    let tail = 0;
    for (let k = 1; k <= 6; k++) tail += Math.pow(x, 1 - 2 * k) / (2 * k * (2 * k - 1));
    return x * x / 2 - 2 * x15 * s - LN2PI * x + ZP_M1 - tail;
}

// ---- normalization -------------------------------------------------------

// max |a[i]| (the legacy zeta-offset normalization reference).
export function maxAbs(arr) {
    let m = 0;
    for (let i = 0; i < arr.length; i++) { const a = Math.abs(arr[i]); if (a > m) m = a; }
    return m;
}

// Scale so that max|raw| maps to spacing*8*amplitude (1 when raw is all zero).
export function zetaNormScale(maxAbsRaw, spacing, amplitude) {
    return maxAbsRaw > 0 ? (spacing * 8.0 * amplitude) / maxAbsRaw : 1;
}

// out[i] = raw[i] * scale. `out` may be a Float32Array (as in the worker) or the raw array itself.
export function scaleInto(out, raw, scale) {
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] * scale;
    return out;
}

// ---- Schoenfeld bounds (RH assumed) --------------------------------------

export const SCHOENFELD_X0 = 73.2;
const INV_8PI = 1 / (8 * Math.PI);

// B(x) = (1/8pi) sqrt(x) ln^2 x bounds |psi(x)-x| for x >= 73.2 under RH. NaN below the threshold.
export function schoenfeldBound(x) {
    if (!(x >= SCHOENFELD_X0)) return NaN;
    const L = Math.log(x);
    return INV_8PI * Math.sqrt(x) * L * L;
}

// Antiderivative of sqrt(t) ln^2 t:  F(t) = t^{3/2}((2/3)ln^2 t - (8/9) ln t + 16/27).
function bound1Antiderivative(t) {
    const L = Math.log(t);
    return t * Math.sqrt(t) * ((2 / 3) * L * L - (8 / 9) * L + 16 / 27);
}

// B1(x) = (1/8pi) int_{73.2}^{x} sqrt(t) ln^2 t dt, O(1) via the closed form. NaN for x < 73.2.
// `head` (default 0) is added as-is: docs/explicit-formula-verification.md uses
// head = |psi1(73.2) - 73.2^2/2| (measured) for the psi1 bound over [0, x].
export function schoenfeldBound1(x, head = 0) {
    if (!(x >= SCHOENFELD_X0)) return NaN;
    return head + INV_8PI * (bound1Antiderivative(x) - bound1Antiderivative(SCHOENFELD_X0));
}
