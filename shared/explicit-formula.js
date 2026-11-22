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

export const LN2PI = Math.log(2 * Math.PI);

// psi0 fluctuation from the accumulated positive partial zero sum S:
//   psi0_N(x) - x = -2 * S - ln(2pi) - (1/2) ln(1 - x^-2)
export function psiFluctFromZeroSum(x, S) {
    return -2 * S - LN2PI - 0.5 * Math.log(1 - 1 / (x * x));
}

// Single-point explicit psi0 reconstruction with the first N zeros (verification script).
// The zero sum goes through accumulateZeroSumPsi (same code path as the worker / fallback)
// and the correction terms go through psiFluctFromZeroSum (shared with computeExplicitRecon).
// denom (optional): buildZetaDenom(zeros) built once by the caller for a fixed zero set. It must correspond
// to the current values of zeros; when omitted it is computed from the current first N zeros on every call
// (no cache keyed on the array, so mutating zeros is always honoured).
export function explicitPsi(x, N, zeros, denom) {
    if (!denom) denom = buildZetaDenom(Array.prototype.slice.call(zeros, 0, N));
    const S = accumulateZeroSumPsi(new Float64Array(1), [Math.log(x)], [Math.sqrt(x)], zeros, denom, 0, N);
    return x + psiFluctFromZeroSum(x, S[0]);
}

// psi1 explicit formula with the first N zeros:
// x^(rho+1)/(rho(rho+1)), rho(rho+1) = (3/4 - g^2) + 2ig.
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

// ---- explicit-mode orchestration (psi1 / psi curves; pure, shared by worker and main-thread fallback) ----

// Common ASINH_SCALE defaults for the two-stage display transform.
export const ASINH_SCALE = 0.02; // backward-compatible alias for psi1
export const ASINH_SCALE_PSI1 = 0.02;
export const ASINH_SCALE_PSI = 0.25;
export const EXPLICIT_KIND_DEFAULT = 'psi1';

export function explicitScaleParams(kind = EXPLICIT_KIND_DEFAULT) {
    return kind === 'psi'
        ? { scale: ASINH_SCALE_PSI, norm: x => Math.sqrt(x) }
        : { scale: ASINH_SCALE_PSI1, norm: x => x * Math.sqrt(x) };
}

// Measured fluctuation (psi1(x) - x^2/2 or psi(x) - x) and Schoenfeld bound (RH assumed; NaN for x < 73.2)
// over an arbitrary sample array `xs`. `tables` = buildPsiTables(>= floor(max(xs)), spf).
export function computeExplicitBaseForSamples(xs, tables, kind = EXPLICIT_KIND_DEFAULT) {
    const samples = xs instanceof Float64Array ? xs : Float64Array.from(xs);
    const M = samples.length;
    const meas = new Float64Array(M), bound = new Float64Array(M);
    let xMax = 0;
    for (let i = 0; i < M; i++) if (samples[i] > xMax) xMax = samples[i];
    if (kind === 'psi') {
        const boundAtX0 = xMax >= SCHOENFELD_X0 ? schoenfeldBound(SCHOENFELD_X0) : NaN;
        for (let i = 0; i < M; i++) {
            meas[i] = measuredFluctPsi(tables, samples[i]);
            bound[i] = schoenfeldBound(samples[i]);
        }
        return { xs: samples, meas, bound, head: 0, boundAtX0 };
    }
    const head = xMax >= SCHOENFELD_X0 ? Math.abs(measuredFluctPsi1(tables, SCHOENFELD_X0)) : NaN;
    for (let i = 0; i < M; i++) {
        meas[i] = measuredFluctPsi1(tables, samples[i]);
        bound[i] = schoenfeldBound1(samples[i], head);
    }
    return { xs: samples, meas, bound, head, boundAtX0: head };
}

// Measured fluctuation, Schoenfeld bound (RH assumed; NaN for x < 73.2) and boundary value at x = 73.2
// for M log-spaced samples in [2, xMax]. `tables` = buildPsiTables(>= floor(xMax), spf).
export function computeExplicitBase(xMax, M, tables, kind = EXPLICIT_KIND_DEFAULT) {
    return computeExplicitBaseForSamples(logSpacedSamples(2, xMax, M), tables, kind);
}

// Reconstruction fluctuation with the first N zeros (N is clamped to zeros.length):
//   psi1: psi1_N(x) - x^2/2
//   psi:  psi0_N(x) - x = -2 * S_N(x) - ln(2pi) - (1/2)ln(1 - x^-2)
export function computeExplicitRecon(xs, N, zeros, kind = EXPLICIT_KIND_DEFAULT, denom) {
    N = Math.max(0, Math.min(Math.floor(N) || 0, zeros.length));
    const M = xs.length;
    const out = new Float64Array(M);
    if (kind === 'psi') {
        const lnArr = new Float64Array(M), sqrtArr = new Float64Array(M);
        for (let i = 0; i < M; i++) { lnArr[i] = Math.log(xs[i]); sqrtArr[i] = Math.sqrt(xs[i]); }
        const d = denom || buildZetaDenom(zeros);
        const S = accumulateZeroSumPsi(new Float64Array(M), lnArr, sqrtArr, zeros, d, 0, N);
        for (let i = 0; i < M; i++) out[i] = psiFluctFromZeroSum(xs[i], S[i]);
        return out;
    }
    for (let i = 0; i < M; i++) out[i] = explicitPsi1(xs[i], N, zeros) - xs[i] * xs[i] / 2;
    return out;
}

// Truncation residual: measured - reconstructed (same units as measured / reconstructed fluctuations).
export function computeExplicitResidual(meas, recon) {
    const out = new Float64Array(meas.length);
    for (let i = 0; i < meas.length; i++) out[i] = meas[i] - recon[i];
    return out;
}

// Root mean square of a - b.
export function rmsDiff(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s / a.length);
}

// Representative sample metrics for the explicit-mode numeric HUD (mid and max samples).
// Purely reads the arrays produced by the shared functions above — no duplicated math.
export function computeExplicitHud(xs, meas, recon, bound, residual) {
    const M = xs.length;
    if (M === 0) return { rms: NaN, samples: [] };
    const midIdx = Math.floor((M - 1) / 2);
    const maxIdx = M - 1;
    const indices = midIdx === maxIdx ? [maxIdx] : [midIdx, maxIdx];
    const res = residual || computeExplicitResidual(meas, recon);
    const samples = indices.map((index, pos) => ({
        label: indices.length === 1 ? 'max' : (pos === 0 ? 'mid' : 'max'),
        index,
        x: xs[index],
        measured: meas[index],
        recon: recon[index],
        residual: res[index],
        bound: bound[index],
    }));
    return { rms: rmsDiff(meas, recon), samples };
}

// Two-stage display transform, identical for measured / reconstruction / shell (and residual in view B):
//   psi1: u = v / x^{3/2}; y = asinh(u / 0.02); d = amp * y / yRef.
//   psi:  u = v / x^{1/2}; y = asinh(u / 0.25); d = amp * y / yRef.
// Odd and strictly increasing in v, so |v| <= B(x) implies |d(v)| <= d(B(x)).
export function compressedOffset(v, x, yRef, amp = 220, kind = EXPLICIT_KIND_DEFAULT) {
    const { scale, norm } = explicitScaleParams(kind);
    return amp * Math.asinh(v / norm(x) / scale) / yRef;
}
// y_ref = asinh(B(xMax) / norm(xMax) / scale) (falls back to the given reference magnitude when B is undefined).
export function compressionRef(bAtXMax, xMax, kind = EXPLICIT_KIND_DEFAULT) {
    const { scale, norm } = explicitScaleParams(kind);
    return Math.asinh(bAtXMax / norm(xMax) / scale);
}
