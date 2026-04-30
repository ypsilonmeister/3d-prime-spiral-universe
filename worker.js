// PrimeCrystal compute worker
// Handles long-running number theory computations off the main thread:
//   - Sieve of Eratosthenes (primes + gaps)
//   - Number Theoretic tables (d, sigma, omega, mu, phi)
//   - Riemann zeta wave offsets

// First 100 non-trivial zeros of the Riemann zeta function (imaginary parts γ_n)
// Source: Andrew Odlyzko's tables — must match main.js
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

let MAX = 0;
let _lnCache = null;
let _sqrtCache = null;
let _zetaDenom = null;

function progress(stage, pct) {
    self.postMessage({ type: 'progress', stage, pct });
}

function buildSieves(maxPoints) {
    MAX = maxPoints;
    progress('primes', 0);

    // ---- Sieve of Eratosthenes ----
    const isPrime = new Uint8Array(MAX + 1);
    isPrime.fill(1);
    isPrime[0] = isPrime[1] = 0;
    for (let i = 2; i * i <= MAX; i++) {
        if (isPrime[i]) for (let j = i * i; j <= MAX; j += i) isPrime[j] = 0;
    }
    const gaps = new Uint8Array(MAX + 2);
    let prev = 2;
    for (let i = 3; i <= MAX; i++) {
        if (isPrime[i]) { gaps[prev] = Math.min(i - prev, 255); prev = i; }
    }
    progress('primes', 100);

    // ---- d(n), sigma(n) via simple sieve ----
    progress('ntl_d_sigma', 0);
    const sigmaSum = new Float64Array(MAX + 1);
    const divCount = new Uint16Array(MAX + 1);
    for (let d = 1; d <= MAX; d++) {
        for (let m = d; m <= MAX; m += d) {
            divCount[m]++;
            sigmaSum[m] += d;
        }
        if ((d & 0x3FFF) === 0) progress('ntl_d_sigma', (d / MAX) * 100);
    }
    const ntl_d = new Uint16Array(MAX + 1);
    const ntl_sigma = new Float32Array(MAX + 1);
    for (let n = 1; n <= MAX; n++) {
        ntl_d[n] = divCount[n];
        ntl_sigma[n] = sigmaSum[n] / n;
    }
    progress('ntl_d_sigma', 100);

    // ---- omega(n) and Mobius mu(n) via smallest-prime-factor sieve ----
    progress('ntl_omega_mu', 0);
    const ntl_mu = new Int8Array(MAX + 1);
    for (let n = 1; n <= MAX; n++) ntl_mu[n] = 1;
    const smallestPrime = new Int32Array(MAX + 1);
    for (let i = 2; i <= MAX; i++) {
        if (smallestPrime[i] === 0) {
            for (let j = i; j <= MAX; j += i) {
                if (smallestPrime[j] === 0) smallestPrime[j] = i;
            }
        }
    }
    const ntl_omega = new Uint8Array(MAX + 1);
    for (let n = 2; n <= MAX; n++) {
        let m = n, squareFree = true, cnt = 0;
        while (m > 1) {
            const p = smallestPrime[m];
            let exp = 0;
            while (m % p === 0) { m = (m / p) | 0; exp++; }
            cnt++;
            if (exp > 1) squareFree = false;
        }
        ntl_omega[n] = cnt;
        ntl_mu[n] = squareFree ? (cnt % 2 === 0 ? 1 : -1) : 0;
        if ((n & 0x7FFF) === 0) progress('ntl_omega_mu', (n / MAX) * 100);
    }
    progress('ntl_omega_mu', 100);

    // ---- Euler totient ----
    progress('ntl_phi', 0);
    const ntl_phi = new Uint32Array(MAX + 1);
    for (let n = 0; n <= MAX; n++) ntl_phi[n] = n;
    for (let p = 2; p <= MAX; p++) {
        if (ntl_phi[p] === p) {
            for (let m = p; m <= MAX; m += p) {
                ntl_phi[m] -= (ntl_phi[m] / p) | 0;
            }
        }
    }
    ntl_phi[1] = 1;
    progress('ntl_phi', 100);

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
