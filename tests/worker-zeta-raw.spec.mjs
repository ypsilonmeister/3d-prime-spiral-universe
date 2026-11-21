// Verifies worker.js zeta output: raw (unnormalized) sum vs an independent
// computation from shared/zeta-zeros-1000.js, the legacy normalized output, and
// the psi reconstruction (docs/explicit-formula-verification.md).
// Runs in Node (no browser): worker.js is executed in a child Node process with a stubbed `self`.
// RH is only assumed in the docs' error-bound discussion; nothing here proves it.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Parse the zeros straight from the data file (independent of worker.js's import path).
const ZETA_ZEROS_1000 = [...readFileSync(fileURLToPath(new URL('../shared/zeta-zeros-1000.js', import.meta.url)), 'utf8')
    .replace(/\/\/.*$/gm, '').matchAll(/\d+\.\d+/g)].map(m => parseFloat(m[0]));

const MAX = 10001;
const LN2PI = Math.log(2 * Math.PI);
const SAMPLES = [100, 1000, 10000];
const NS = [10, 100, 1000];

// Independent reference: complex arithmetic, x^rho / rho with rho = 1/2 + i*gamma.
function refRaw(x, N) {
    const L = Math.log(x), sx = Math.sqrt(x);
    let s = 0;
    for (let k = 0; k < N; k++) {
        const g = ZETA_ZEROS_1000[k];
        // x^rho = sx * (cos(gL) + i sin(gL)); divide by (1/2 + i g) via conjugate
        const re = sx * Math.cos(g * L), im = sx * Math.sin(g * L);
        const d = 0.25 + g * g;
        s += (re * 0.5 + im * g) / d;
    }
    return -2 * s;
}

const HARNESS = fileURLToPath(new URL('./helpers/worker-zeta-harness.mjs', import.meta.url));
// Runs worker.js in a separate Node process; returns one result per N.
function runWorker(Ns, { amplitude = 1.0, spacing = 3.0, xs = SAMPLES } = {}) {
    const out = execFileSync(process.execPath,
        ['--no-warnings', HARNESS, String(MAX), String(amplitude), String(spacing), xs.join(','), Ns.join(',')],
        { encoding: 'utf8', maxBuffer: 1 << 24 });
    return JSON.parse(out);
}

test.describe('worker zeta raw output', () => {
    test('zeros data: 1000 entries, increasing', () => {
        expect(ZETA_ZEROS_1000.length).toBe(1000);
        for (let k = 1; k < 1000; k++) expect(ZETA_ZEROS_1000[k]).toBeGreaterThan(ZETA_ZEROS_1000[k - 1]);
    });

    test('raw matches independent -sum 2Re(x^rho/rho) (Float32 tolerance)', () => {
        for (const r of runWorker(NS)) {
            expect(r.type).toBe('zeta_done');
            expect(r.reqId).toBe(7);
            expect(r.rawIsF32).toBe(true);
            expect(r.rawLen).toBe(MAX);
            for (const x of SAMPLES) {
                const ref = refRaw(x, r.N);
                const got = r.raw[x];
                const tol = 1e-5 * Math.max(1, Math.abs(ref)); // Float32 eps ~6e-8, headroom for summation order
                expect(Math.abs(got - ref), `N=${r.N} x=${x} got=${got} ref=${ref}`).toBeLessThanOrEqual(tol);
            }
        }
    });

    test('offsets (normalized) = raw * spacing*8*amp / max|raw|; max equals target', () => {
        const spacing = 3.0, amplitude = 1.7, target = spacing * 8 * amplitude;
        for (const r of runWorker(NS, { amplitude, spacing })) {
            expect(r.offsetsIsF32).toBe(true);
            expect(r.distinctBuffers).toBe(true);
            expect(Math.abs(r.maxNorm - target) / target).toBeLessThan(1e-5);
            const scale = target / r.maxRaw;
            for (const x of SAMPLES) {
                expect(Math.abs(r.norm[x] - r.raw[x] * scale)).toBeLessThan(1e-5 * target);
            }
        }
    });

    test('N=0 gives all-zero arrays', () => {
        const [r] = runWorker([0]);
        expect(r.nonzero).toBe(0);
        expect(r.distinctBuffers).toBe(true);
    });

    test('psi reconstruction x + raw - ln2pi - 1/2 ln(1-x^-2) is consistent; N=1000 beats N=100', () => {
        // measured psi(x) = sum_{n<=x} Lambda(n) from an independent trial-division sieve
        const psi = new Float64Array(MAX);
        for (let n = 2; n < MAX; n++) {
            let p = 0;
            for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = d; break; }
            if (p === 0) p = n;
            let m = n; while (m % p === 0) m /= p;
            psi[n] = psi[n - 1] + (m === 1 ? Math.log(p) : 0);
        }
        // raw = -sum 2Re(x^rho/rho), so psi0(x) = x + raw - ln(2pi) - 1/2 ln(1-x^-2)
        const raw = Object.fromEntries(runWorker([100, 1000]).map(r => [r.N, r.raw]));
        const recon = (rawN, x) => x + rawN[x] - LN2PI - 0.5 * Math.log(1 - 1 / (x * x));
        const res = {};
        for (const N of [100, 1000]) {
            res[N] = SAMPLES.map(x => psi[x] - recon(raw[N], x));
        }
        // Values in docs/explicit-formula-verification.md (psi residual table)
        const doc = { 100: [0.38, 2.71, -5.70], 1000: [0.03, -0.35, -4.68] };
        for (const N of [100, 1000]) {
            res[N].forEach((r, j) => expect(Math.abs(r - doc[N][j]), `N=${N} x=${SAMPLES[j]} resid=${r}`).toBeLessThan(0.01));
        }
        const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
        expect(rms(res[1000])).toBeLessThan(rms(res[100]));
    });
});
