// PrimeCrystal compute worker
// Handles long-running number theory computations off the main thread:
//   - Sieve of Eratosthenes (primes + gaps)
//   - Number Theoretic tables (d, sigma, omega, mu, phi)
//   - Riemann zeta wave offsets

// Riemann zeta zeros and number-theory primitives are shared with the main
// thread and sub-apps via shared/ — single source of truth, no drift.
import { ZETA_ZEROS_1000 as ZETA_ZEROS } from './shared/zeta-zeros-1000.js';
import { buildSieve } from './shared/sieve.js';
import { computeNtlTables } from './shared/arithmetic.js';
import {
    buildZetaDenom, buildLnSqrtCaches, accumulateZeroSumPsi,
    maxAbs as maxAbsOf, zetaNormScale, scaleInto,
    buildPsiTables, computeExplicitBase, computeExplicitRecon,
} from './shared/explicit-formula.js';

let MAX = 0;
let _lnCache = null;
let _sqrtCache = null;
let _zetaDenom = null;
// Cache of the unnormalized zero sum: S (Float64 positive partial sum, raw = -2S), raw (Float32), maxAbs.
// Valid for the current MAX and cached N only; amplitude/spacing never invalidate it.
let _zetaCache = null;
let _spf = null;       // smallest-prime-factor table kept for the explicit-formula mode
let _psiTables = null; // buildPsiTables(MAX, _spf), built lazily
let _explicitXs = null; // samples of the latest explicit_base request (xMax, M, xs)

function progress(stage, pct) {
    self.postMessage({ type: 'progress', stage, pct });
}

function buildSieves(maxPoints) {
    MAX = maxPoints;
    
    // ---- Sieve of Eratosthenes ----
    progress('primes', 0);
    const { isPrime, gaps, spf } = buildSieve(MAX);
    progress('primes', 100);
    _spf = spf;
    _psiTables = null;

    // ---- d(n), sigma(n), omega(n), mu(n), phi(n) via shared arithmetic ----
    const { ntl_d, ntl_sigma, ntl_omega, ntl_mu, ntl_phi } = computeNtlTables(MAX, spf, progress);

    // ---- Math caches for zeta ----
    const caches = buildLnSqrtCaches(MAX);
    _lnCache = caches.ln;
    _sqrtCache = caches.sq;
    _zetaDenom = buildZetaDenom(ZETA_ZEROS);
    _zetaCache = null;

    return {
        isPrime, gaps, ntl_d, ntl_sigma, ntl_omega, ntl_mu, ntl_phi,
    };
}

// Returns { raw, normalized, recomputed }.
//   raw        = -sum_{k<=N} 2Re(x^rho_k/rho_k) at x = i+1 (unnormalized, Float32Array; fresh copy each call
//                because it is transferred to the main thread)
//   normalized = raw scaled so max|.| = spacing*8*amplitude (the legacy visual offsets)
//   recomputed = whether the zero sum was (re)computed; false when only normalization was redone.
// The zero sum is cached: amplitude/spacing changes only redo the normalization. N growing continues
// from the cached partial sums; N shrinking recomputes.
function computeZetaOffsets(N, amplitude, spacing) {
    const normalized = new Float32Array(MAX);
    N = Math.max(0, Math.min(Math.floor(N) || 0, _zetaDenom ? _zetaDenom.length : 0));
    if (N === 0) { _zetaCache = null; return { raw: new Float32Array(MAX), normalized, recomputed: false }; }

    let recomputed = true;
    if (_zetaCache && _zetaCache.N === N) {
        recomputed = false;
    } else {
        const resume = _zetaCache && _zetaCache.N < N;
        const S = resume ? _zetaCache.S : new Float64Array(MAX);
        accumulateZeroSumPsi(S, _lnCache, _sqrtCache, ZETA_ZEROS, _zetaDenom, resume ? _zetaCache.N : 0, N);
        const rawF32 = new Float32Array(MAX);
        for (let i = 0; i < MAX; i++) rawF32[i] = -2.0 * S[i];
        // Legacy normalization: scale from the Float32-rounded raw values, as before.
        _zetaCache = { N, S, raw: rawF32, maxAbs: maxAbsOf(rawF32) };
    }
    const raw = new Float32Array(_zetaCache.raw); // copy: the cache must survive the transfer
    scaleInto(normalized, raw, zetaNormScale(_zetaCache.maxAbs, spacing, amplitude));
    return { raw, normalized, recomputed };
}

self.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'init') {
        const tables = buildSieves(msg.maxPoints);
        self.postMessage({
            type: 'init_done',
            isPrime:   tables.isPrime,
            gaps:      tables.gaps,
            ntl_d:     tables.ntl_d,
            ntl_sigma: tables.ntl_sigma,
            ntl_omega: tables.ntl_omega,
            ntl_mu:    tables.ntl_mu,
            ntl_phi:   tables.ntl_phi,
        }, [
            tables.isPrime.buffer, tables.gaps.buffer,
            tables.ntl_d.buffer, tables.ntl_sigma.buffer,
            tables.ntl_omega.buffer, tables.ntl_mu.buffer,
            tables.ntl_phi.buffer,
        ]);
    } else if (msg.type === 'explicit_base') {
        // Measured psi1 - x^2/2 and RH-assumed bound at M log-spaced samples in [2, xMax].
        if (!_psiTables) _psiTables = buildPsiTables(MAX, _spf);
        const xMax = Math.min(msg.xMax, MAX);
        const base = computeExplicitBase(xMax, msg.M, _psiTables);
        _explicitXs = { xMax, M: msg.M, xs: base.xs };
        // xs stays cached for explicit_recon, so transfer a copy (a transferred buffer would be detached here).
        const out = { ...base, xs: new Float64Array(base.xs) };
        self.postMessage({ type: 'explicit_done', kind: 'base', reqId: msg.reqId, ...out },
            [out.xs.buffer, out.meas.buffer, out.bound.buffer]);
    } else if (msg.type === 'explicit_recon') {
        const xs = _explicitXs && _explicitXs.xMax === msg.xMax && _explicitXs.M === msg.M
            ? _explicitXs.xs : computeExplicitBase(msg.xMax, msg.M, _psiTables || (_psiTables = buildPsiTables(MAX, _spf))).xs;
        const recon = computeExplicitRecon(xs, msg.N, ZETA_ZEROS);
        self.postMessage({ type: 'explicit_done', kind: 'recon', reqId: msg.reqId, recon }, [recon.buffer]);
    } else if (msg.type === 'zeta') {
        const { raw, normalized, recomputed } = computeZetaOffsets(msg.N, msg.amplitude, msg.spacing);
        // offsets = normalized (backward compatible); rawOffsets = unnormalized sum
        self.postMessage(
            { type: 'zeta_done', reqId: msg.reqId, offsets: normalized, rawOffsets: raw, recomputed },
            [normalized.buffer, raw.buffer]
        );
    }
};
