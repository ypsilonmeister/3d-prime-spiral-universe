// Number-theoretic and arithmetic functions

export function padicValuation(n, p) {
    if (n === 0) return Infinity;
    if (p <= 1) return 0; // guard against infinite loops
    let v = 0;
    while (n % p === 0) {
        n = (n / p) | 0;
        v++;
    }
    return v;
}

export function padicNorm(n, p) {
    const v = padicValuation(n, p);
    return v === Infinity ? 0 : Math.pow(p, -v);
}

export function mobius(n, spf) {
    if (n === 1) return 1;
    let k = n, factors = 0;
    while (k > 1) {
        const p = spf[k];
        if (p <= 1) break; // safety check
        k = (k / p) | 0;
        if (k % p === 0) return 0;
        factors++;
    }
    return factors % 2 === 0 ? 1 : -1;
}

// Bulk NTL tables computation using sieving techniques
export function computeNtlTables(MAX, spf, progress) {
    const defaultProgress = () => {};
    const reportProgress = progress || defaultProgress;

    // ---- d(n), sigma(n) via divisor sieve ----
    reportProgress('ntl_d_sigma', 0);
    const sigmaSum = new Float64Array(MAX + 1);
    const divCount = new Uint16Array(MAX + 1);
    for (let d = 1; d <= MAX; d++) {
        for (let m = d; m <= MAX; m += d) {
            divCount[m]++;
            sigmaSum[m] += d;
        }
        if ((d & 0x3FFF) === 0) {
            reportProgress('ntl_d_sigma', (d / MAX) * 100);
        }
    }
    
    const ntl_d = new Uint16Array(MAX + 1);
    const ntl_sigma = new Float32Array(MAX + 1);
    for (let n = 1; n <= MAX; n++) {
        ntl_d[n] = divCount[n];
        ntl_sigma[n] = sigmaSum[n] / n;
    }
    reportProgress('ntl_d_sigma', 100);

    // ---- omega(n) and Mobius mu(n) via smallest-prime-factor sieve ----
    reportProgress('ntl_omega_mu', 0);
    const ntl_omega = new Uint8Array(MAX + 1);
    const ntl_mu = new Int8Array(MAX + 1);
    ntl_mu[1] = 1;
    
    for (let n = 2; n <= MAX; n++) {
        let m = n, squareFree = true, cnt = 0;
        while (m > 1) {
            const p = spf[m];
            if (p <= 1) break; // safety check
            let exp = 0;
            while (m % p === 0) {
                m = (m / p) | 0;
                exp++;
            }
            cnt++;
            if (exp > 1) squareFree = false;
        }
        ntl_omega[n] = cnt;
        ntl_mu[n] = squareFree ? (cnt % 2 === 0 ? 1 : -1) : 0;
        if ((n & 0x7FFF) === 0) {
            reportProgress('ntl_omega_mu', (n / MAX) * 100);
        }
    }
    reportProgress('ntl_omega_mu', 100);

    // ---- Euler totient ----
    reportProgress('ntl_phi', 0);
    const ntl_phi = new Uint32Array(MAX + 1);
    for (let n = 0; n <= MAX; n++) {
        ntl_phi[n] = n;
    }
    for (let p = 2; p <= MAX; p++) {
        if (ntl_phi[p] === p) {
            for (let m = p; m <= MAX; m += p) {
                ntl_phi[m] -= (ntl_phi[m] / p) | 0;
            }
        }
    }
    ntl_phi[1] = 1;
    reportProgress('ntl_phi', 100);

    return { ntl_d, ntl_sigma, ntl_omega, ntl_mu, ntl_phi };
}
