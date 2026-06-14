// PrimeCrystal compute worker
// Handles long-running number theory computations off the main thread:
//   - Sieve of Eratosthenes (primes + gaps)
//   - Number Theoretic tables (d, sigma, omega, mu, phi)
//   - Riemann zeta wave offsets

// Riemann zeta zeros and number-theory primitives are shared with the main
// thread and sub-apps via shared/ — single source of truth, no drift.
import { ZETA_ZEROS } from './shared/zeta-zeros.js';
import { buildSieve } from './shared/sieve.js';
import { computeNtlTables } from './shared/arithmetic.js';

let MAX = 0;
let _lnCache = null;
let _sqrtCache = null;
let _zetaDenom = null;

function progress(stage, pct) {
    self.postMessage({ type: 'progress', stage, pct });
}

function buildSieves(maxPoints) {
    MAX = maxPoints;
    
    // ---- Sieve of Eratosthenes ----
    progress('primes', 0);
    const { isPrime, gaps, spf } = buildSieve(MAX);
    progress('primes', 100);

    // ---- d(n), sigma(n), omega(n), mu(n), phi(n) via shared arithmetic ----
    const { ntl_d, ntl_sigma, ntl_omega, ntl_mu, ntl_phi } = computeNtlTables(MAX, spf, progress);

    // ---- Math caches for zeta ----
    _lnCache = new Float64Array(MAX);
    _sqrtCache = new Float64Array(MAX);
    for (let i = 0; i < MAX; i++) {
        const x = i + 1;
        _lnCache[i] = Math.log(x);
        _sqrtCache[i] = Math.sqrt(x);
    }
    _zetaDenom = new Float64Array(100);
    for (let k = 0; k < 100; k++) {
        const g = ZETA_ZEROS[k];
        _zetaDenom[k] = 0.25 + g * g;
    }

    return {
        isPrime, gaps, ntl_d, ntl_sigma, ntl_omega, ntl_mu, ntl_phi,
    };
}

function computeZetaOffsets(N, amplitude, spacing) {
    const offsets = new Float32Array(MAX);
    if (N === 0) return offsets;

    for (let i = 0; i < MAX; i++) {
        const lnx   = _lnCache[i];
        const sqrtx = _sqrtCache[i];
        let sum = 0;
        for (let k = 0; k < N; k++) {
            const g = ZETA_ZEROS[k];
            const angle = g * lnx;
            sum += sqrtx * (Math.cos(angle) * 0.5 + Math.sin(angle) * g) / _zetaDenom[k];
        }
        offsets[i] = -2.0 * sum;
    }

    let maxAbs = 0;
    for (let i = 0; i < MAX; i++) {
        const a = Math.abs(offsets[i]);
        if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs > 0) {
        const scale = (spacing * 8.0 * amplitude) / maxAbs;
        for (let i = 0; i < MAX; i++) offsets[i] *= scale;
    }
    return offsets;
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
    } else if (msg.type === 'zeta') {
        const offsets = computeZetaOffsets(msg.N, msg.amplitude, msg.spacing);
        self.postMessage({ type: 'zeta_done', reqId: msg.reqId, offsets }, [offsets.buffer]);
    }
};
