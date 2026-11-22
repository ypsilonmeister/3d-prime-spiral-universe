// Automatic verification of the explicit-formula mode's shared data path against the
// canonical figures in docs/explicit-formula-verification.md.
// Runs in Node (no browser); imports shared/explicit-formula.js directly.
// RH is ASSUMED only for the Schoenfeld bound columns; nothing here proves it.
import { test, expect } from '@playwright/test';
import { buildSieve } from '../shared/sieve.js';
import { ZETA_ZEROS_1000 as ZEROS } from '../shared/zeta-zeros-1000.js';
import {
    buildPsiTables, buildZetaDenom, logSpacedSamples,
    computeExplicitBase, computeExplicitBaseForSamples,
    computeExplicitRecon, computeExplicitResidual, computeExplicitHud,
    explicitPsi, psiFluctFromZeroSum, LN2PI,
    rmsDiff, compressedOffset, compressionRef,
    ASINH_SCALE_PSI1, ASINH_SCALE_PSI, SCHOENFELD_X0,
} from '../shared/explicit-formula.js';

const MAX = 320000;
const GRID = [100, 300, 1000, 3000, 10000, 30000, 100000, 320000];

// Tolerance rationale for matching docs/explicit-formula-verification.md:
// The canonical values in docs/explicit-formula-verification.md are formatted with
// `.toFixed(2)` (rounded to 2 decimal places), so the unavoidable rounding discrepancy
// between the full-precision Float64 result and the documented number is at most
// 0.005 (= 0.5 * 10^-2). We add 1e-6 headroom for IEEE-754 / libm trig ULP variance
// across runtimes (total tolerance = 0.005001), which is still strictly smaller than
// one unit in the last printed decimal place (0.01).
const DOC_2DP_TOL = 0.005 + 1e-6;

let tables;
let denom;

test.beforeAll(() => {
    const { spf } = buildSieve(MAX);
    tables = buildPsiTables(MAX, spf);
    denom = buildZetaDenom(ZEROS);
});

test.describe('explicit-formula canonical verification (docs/explicit-formula-verification.md)', () => {
    test('psi1 dense-grid RMS reproduces canonical values for N = 10, 30, 100, 300, 1000', () => {
        // Exact verification grid from scripts/verify-explicit-formula.mjs (line 84):
        // 400 log-spaced samples in [100, 320000], shifted by +0.37 to stay off integer jumps.
        const dense = Float64Array.from(logSpacedSamples(100, MAX, 400), v => v + 0.37);
        const base = computeExplicitBaseForSamples(dense, tables, 'psi1');

        // Canonical "RMS dense" row from docs/explicit-formula-verification.md
        const canonical = [
            { N: 10,   expected: 50399.58 },
            { N: 30,   expected: 17972.58 },
            { N: 100,  expected: 6636.74 },
            { N: 300,  expected: 1980.09 },
            { N: 1000, expected: 512.62 },
        ];

        const rmsValues = [];
        for (const { N, expected } of canonical) {
            const recon = computeExplicitRecon(base.xs, N, ZEROS, 'psi1');
            const residual = computeExplicitResidual(base.meas, recon);
            const rms = rmsDiff(base.meas, recon);
            // Residual RMS computed from computeExplicitResidual must agree with rmsDiff.
            const rmsFromResidual = rmsDiff(residual, new Float64Array(residual.length));
            expect(Math.abs(rms - rmsFromResidual)).toBeLessThan(1e-12);
            expect(
                Math.abs(rms - expected),
                `psi1 dense RMS at N=${N}: got=${rms.toFixed(6)}, expected=${expected} (±${DOC_2DP_TOL})`
            ).toBeLessThanOrEqual(DOC_2DP_TOL);
            expect(rms.toFixed(2)).toBe(expected.toFixed(2));
            rmsValues.push(rms);
        }

        // Strict monotonic convergence of psi1 RMS as N increases.
        for (let i = 1; i < rmsValues.length; i++) {
            expect(rmsValues[i]).toBeLessThan(rmsValues[i - 1]);
        }
    });

    test('psi1 and psi 8-point grid RMS reproduce canonical values (including psi Gibbs non-monotonicity)', () => {
        const basePsi1 = computeExplicitBaseForSamples(GRID, tables, 'psi1');
        const canonicalPsi1Grid = [
            { N: 10,   expected: 51272.87 },
            { N: 30,   expected: 22536.92 },
            { N: 100,  expected: 16384.15 },
            { N: 300,  expected: 3615.14 },
            { N: 1000, expected: 387.46 },
        ];
        for (const { N, expected } of canonicalPsi1Grid) {
            const recon = computeExplicitRecon(basePsi1.xs, N, ZEROS, 'psi1');
            const rms = rmsDiff(basePsi1.meas, recon);
            expect(Math.abs(rms - expected)).toBeLessThanOrEqual(DOC_2DP_TOL);
            expect(rms.toFixed(2)).toBe(expected.toFixed(2));
        }

        const basePsi = computeExplicitBaseForSamples(GRID, tables, 'psi');
        const canonicalPsiGrid = [
            { N: 10,   expected: 30.27 },
            { N: 30,   expected: 31.36 },
            { N: 100,  expected: 13.01 },
            { N: 300,  expected: 6.13 },
            { N: 1000, expected: 9.48 },
        ];
        const psiRms = {};
        for (const { N, expected } of canonicalPsiGrid) {
            const recon = computeExplicitRecon(basePsi.xs, N, ZEROS, 'psi', denom);
            const rms = rmsDiff(basePsi.meas, recon);
            expect(Math.abs(rms - expected)).toBeLessThanOrEqual(DOC_2DP_TOL);
            expect(rms.toFixed(2)).toBe(expected.toFixed(2));
            psiRms[N] = rms;
        }
        // Documents Gibbs oscillation non-monotonicity: N=1000 grid RMS exceeds N=300.
        expect(psiRms[1000]).toBeGreaterThan(psiRms[300]);
    });

    test('RH-assumed Schoenfeld bounds, scaling parameters, and order preservation hold for psi1 and psi', () => {
        expect(ASINH_SCALE_PSI1).toBe(0.02);
        expect(ASINH_SCALE_PSI).toBe(0.25);

        const basePsi1 = computeExplicitBaseForSamples(GRID, tables, 'psi1');
        const basePsi = computeExplicitBaseForSamples(GRID, tables, 'psi');

        // Canonical bound values at x=100 and x=320000 from docs/explicit-formula-verification.md
        expect(Math.abs(basePsi.bound[0] - 8.44)).toBeLessThanOrEqual(DOC_2DP_TOL);
        expect(Math.abs(basePsi.bound[7] - 3616.64)).toBeLessThanOrEqual(DOC_2DP_TOL);
        expect(Math.abs(basePsi1.bound[0] - 334.92)).toBeLessThanOrEqual(DOC_2DP_TOL);
        // For B1(320000) ~ 6.95e8, relative FP rounding in the closed form is ~1e-12 (~7e-4), well within DOC_2DP_TOL.
        expect(Math.abs(basePsi1.bound[7] - 694661718.57)).toBeLessThanOrEqual(DOC_2DP_TOL);

        // Explicit mode full sample paths (M=1600): NaN below 73.2 and compression preserves |v| <= B(x).
        for (const kind of ['psi1', 'psi']) {
            const base = computeExplicitBase(MAX, 1600, tables, kind);
            const recon = computeExplicitRecon(base.xs, 100, ZEROS, kind, denom);
            const residual = computeExplicitResidual(base.meas, recon);
            const yRef = compressionRef(base.bound[base.xs.length - 1], MAX, kind);

            for (let i = 0; i < base.xs.length; i++) {
                const x = base.xs[i];
                if (x < SCHOENFELD_X0) {
                    expect(Number.isNaN(base.bound[i])).toBe(true);
                } else {
                    expect(Math.abs(base.meas[i])).toBeLessThanOrEqual(base.bound[i]);
                    const dMeas = Math.abs(compressedOffset(base.meas[i], x, yRef, 220, kind));
                    const dBound = compressedOffset(base.bound[i], x, yRef, 220, kind);
                    expect(dMeas).toBeLessThanOrEqual(dBound + 1e-12);
                }
            }

            const hud = computeExplicitHud(base.xs, base.meas, recon, base.bound, residual);
            expect(hud.samples).toHaveLength(2);
            expect(hud.samples[0].label).toBe('mid');
            expect(hud.samples[1].label).toBe('max');
            expect(hud.samples[1].x).toBe(MAX);
            expect(hud.rms).toBe(rmsDiff(base.meas, recon));
            for (const s of hud.samples) {
                expect(s.residual).toBe(s.measured - s.recon);
                expect(Number.isFinite(s.bound)).toBe(true);
            }
        }
    });

    test('explicitPsi and computeExplicitRecon("psi") share psiFluctFromZeroSum correction terms', () => {
        for (const [x, S] of [[2, 0.1], [73.2, -1.25], [233, 3.5], [320000, -42.1]]) {
            const expected = -2 * S - LN2PI - 0.5 * Math.log(1 - 1 / (x * x));
            expect(psiFluctFromZeroSum(x, S)).toBe(expected);
        }

        for (const N of [10, 100, 1000]) {
            const batch = computeExplicitRecon(GRID, N, ZEROS, 'psi', denom);
            for (let i = 0; i < GRID.length; i++) {
                const x = GRID[i];
                const single = computeExplicitRecon([x], N, ZEROS, 'psi', denom)[0];
                expect(batch[i]).toBe(single);
                expect(explicitPsi(x, N, ZEROS, denom)).toBe(x + single);
            }
        }
    });
});
