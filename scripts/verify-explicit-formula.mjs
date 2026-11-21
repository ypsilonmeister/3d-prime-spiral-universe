#!/usr/bin/env node
// Quantitative check of the Riemann–von Mangoldt explicit formula (no UI, no dependencies).
//   node scripts/verify-explicit-formula.mjs
//
// psi0(x) = x - sum_{rho: Im rho>0} 2Re(x^rho/rho) - ln(2pi) - (1/2)ln(1 - x^-2)            [psi0 = psi with midpoint value at jumps; sum over Im rho>0 only (conjugates folded into 2Re); Davenport ch.17; Montgomery-Vaughan Thm 12.5]
// psi1(x) = sum_{n<=x} Lambda(n)(x-n) = int_0^x psi(t)dt
//         = x^2/2 - sum_rho x^(rho+1)/(rho(rho+1)) - (zeta'/zeta(0)) x + zeta'/zeta(-1)
//           - sum_{k>=1} x^(1-2k)/(2k(2k-1))
//   with zeta'/zeta(0) = ln(2pi), zeta'/zeta(-1) = 1.98505372440541115...
//   Source: de la Vallée Poussin (1896), Montgomery & Vaughan, Multiplicative Number Theory I, §12.1 Exercise 6
//   (Cambridge UP 2007); same formula as integrating Davenport ch.17's psi formula once.
// RH is ASSUMED only for the error-bound comparison columns; nothing here proves it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSieve } from '../shared/sieve.js';
import {
    buildPsiTables, measuredPsi, measuredPsi1, explicitPsi, explicitPsi1,
    LN2PI, ZP_M1, schoenfeldBound, schoenfeldBound1, SCHOENFELD_X0, logSpacedSamples,
} from '../shared/explicit-formula.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 320000;
const GRID = [100, 300, 1000, 3000, 10000, 30000, 100000, 320000];
const NS = [10, 30, 100, 300, 1000];

function loadZeros(file) {
    const src = readFileSync(join(ROOT, 'shared', file), 'utf8');
    return [...src.replace(/\/\/.*$/gm, '').matchAll(/\d+\.\d+/g)].map(m => parseFloat(m[0]));
}
const zeros = loadZeros('zeta-zeros-1000.js');
if (zeros.length !== 1000) throw new Error('expected 1000 zeros, got ' + zeros.length);

// ---- measured psi / psi1 (shared/explicit-formula.js) ----
const T = buildPsiTables(MAX, buildSieve(MAX).spf);
const { PSI, PSI1 } = T;
const psiMeas = x => measuredPsi(T, x);
const psi1Meas = x => measuredPsi1(T, x);
// explicit formulas with the first N zeros (rho = 1/2 + i gamma)
const psiExp = (x, N) => explicitPsi(x, N, zeros);
const psi1Exp = (x, N) => explicitPsi1(x, N, zeros);

// composite Simpson in u = ln t on [a,b] of f(t) t dt
function integrate(f, a, b, pts) {
    let n = Math.max(200, Math.ceil(pts)); if (n % 2) n++;
    const lo = Math.log(a), h = (Math.log(b) - lo) / n;
    let s = 0;
    for (let i = 0; i <= n; i++) {
        const t = Math.exp(lo + i * h), w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
        s += w * f(t) * t;
    }
    return s * h / 3;
}

const fails = [];
const check = (name, ok, detail) => { console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`); if (!ok) fails.push(name); };

// ---- cross-checks ----
console.log('== Cross-check of psi1 closed form (differences over [x1,x2]) ==');
console.log('   (a) numeric integral of explicit psi_N  vs  psi1_N closed form');
console.log('   (b) numeric integral of measured psi (step function)  vs  psi1 from Lambda');
// (b) exact: integral of the step function psi over integer interval [m,M] = sum_{n=m}^{M-1} psi(n)
{
    const m = 100, M = 320000;
    let acc = 0;
    for (let n = m; n < M; n++) acc += PSI[n];
    const d = PSI1[M] - PSI1[m];
    check('(b) measured psi integral == psi1 Lambda-sum', Math.abs(acc - d) / Math.abs(d) < 1e-9, `int=${acc.toFixed(3)} psi1diff=${d.toFixed(3)} rel=${(Math.abs(acc - d) / d).toExponential(2)}`);
}
for (const N of [10, 100, 1000]) {
    const g = zeros[N - 1];
    let maxRel = 0, maxAbs = 0;
    for (let i = 0; i < GRID.length - 1; i++) {
        const [a, b] = [GRID[i], GRID[i + 1]];
        const num = integrate(t => psiExp(t, N), a, b, 60 * g * Math.log(b / a) / (2 * Math.PI) + 2000);
        const cf = psi1Exp(b, N) - psi1Exp(a, N);
        maxAbs = Math.max(maxAbs, Math.abs(num - cf));
        maxRel = Math.max(maxRel, Math.abs(num - cf) / Math.abs(cf));
    }
    check(`(a) N=${N} explicit-psi integral == psi1 closed form`, maxRel < 1e-8, `max|diff|=${maxAbs.toExponential(2)} maxRel=${maxRel.toExponential(2)}`);
}
// absolute check (constant zeta'/zeta(-1) included): at x=100 the N=1000 residual must be far below the constant (~1.985)
const dense = Array.from(logSpacedSamples(100, MAX, 400), v => v + 0.37);
{
    const r = psi1Meas(100) - psi1Exp(100, 1000);
    check('absolute psi1 at x=100, N=1000 (validates constants)', Math.abs(r) < 0.5, `residual=${r.toFixed(4)} (a wrong constant term would shift this by ~${ZP_M1.toFixed(3)})`);
}

// ---- residual tables ----
const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const f = (v, d = 3) => (v >= 0 ? ' ' : '') + v.toFixed(d);

console.log('\n== psi1 residual (measured - reconstructed) at grid x ==');
console.log(['x', ...NS.map(n => ('N=' + n).padStart(14))].map((s, i) => i ? s : s.padStart(8)).join(' '));
for (const x of GRID) console.log(String(x).padStart(8) + ' ' + NS.map(N => f(psi1Meas(x) - psi1Exp(x, N), 2).padStart(14)).join(' '));
const rmsRows = { grid: [], dense: [], rel: [] };
for (const N of NS) {
    rmsRows.grid.push(rms(GRID.map(x => psi1Meas(x) - psi1Exp(x, N))));
    const dr = dense.map(x => psi1Meas(x) - psi1Exp(x, N));
    rmsRows.dense.push(rms(dr));
    rmsRows.rel.push(rms(dense.map((x, i) => dr[i] / Math.pow(x, 1.5))));
}
console.log('RMS grid  ' + rmsRows.grid.map(v => v.toFixed(2).padStart(14)).join(' '));
console.log('RMS dense ' + rmsRows.dense.map(v => v.toFixed(2).padStart(14)).join(' '));
console.log('RMS/x^1.5 ' + rmsRows.rel.map(v => v.toExponential(3).padStart(14)).join(' ') + '   (dense = 400 log-spaced x in [100,320000])');

console.log('\n== psi residual (measured - reconstructed) at grid x ==');
console.log(['x', ...NS.map(n => ('N=' + n).padStart(10))].map((s, i) => i ? s : s.padStart(8)).join(' '));
for (const x of GRID) console.log(String(x).padStart(8) + ' ' + NS.map(N => f(psiMeas(x) - psiExp(x, N), 2).padStart(10)).join(' '));
const psiRmsGrid = NS.map(N => rms(GRID.map(x => psiMeas(x) - psiExp(x, N))));
console.log('RMS grid  ' + psiRmsGrid.map(v => v.toFixed(2).padStart(10)).join(' '));

// ---- RH-conditional error bounds (RH ASSUMED) ----
console.log('\n== Error vs bound assuming RH (Schoenfeld: |psi(x)-x| <= (1/8pi) sqrt(x) ln^2 x for x>=73.2) ==');
const bnd = schoenfeldBound;
const X0 = SCHOENFELD_X0;
const intBound = x => integrate(bnd, X0, x, 20000);
const head = Math.abs(psi1Meas(X0) - X0 * X0 / 2); // exact |int_0^X0 (psi-t) dt|; bound only claimed for t>=X0
console.log(`  psi1 bound = |psi1(73.2)-73.2^2/2| (measured, ${head.toFixed(3)}) + (1/8pi) int_73.2^x sqrt(t) ln^2 t dt`);
console.log(['x', '|psi-x|', 'bound', 'inside?', '|psi1-x^2/2|', 'psi1 bound', 'inside?'].map((s, i) => s.padStart(i ? 14 : 8)).join(' '));
let allInside = true, closedFormRel = 0;
for (const x of GRID) {
    const e = Math.abs(psiMeas(x) - x), b = bnd(x);
    const e1 = Math.abs(psi1Meas(x) - x * x / 2), b1 = schoenfeldBound1(x, head);
    closedFormRel = Math.max(closedFormRel, Math.abs(b1 - (head + intBound(x))) / b1);
    allInside = allInside && e <= b && e1 <= b1;
    console.log(String(x).padStart(8) + ' ' + [e.toFixed(2), b.toFixed(2), e <= b ? 'yes' : 'NO', e1.toFixed(2), b1.toFixed(2), e1 <= b1 ? 'yes' : 'NO'].map(s => s.padStart(14)).join(' '));
}
check('closed-form B1 == numeric integral (grid)', closedFormRel < 1e-9, 'maxRel=' + closedFormRel.toExponential(2));
check('B1(320000) ~ 6.9466e8 (doc grid)', Math.abs(schoenfeldBound1(320000, head) / 694661718.57 - 1) < 1e-9, schoenfeldBound1(320000, head).toFixed(2));
check('B/B1 are NaN below 73.2', Number.isNaN(schoenfeldBound(73.1)) && Number.isNaN(schoenfeldBound1(50)), 'ok');
console.log(allInside ? '  All grid points inside the (RH-conditional) bounds.' : '  Some grid points are OUTSIDE the bounds.');

// ---- success criterion ----
console.log('\n== Success criterion: psi1 residual RMS decreases with N ==');
const mono = a => a.every((v, i) => i === 0 || v < a[i - 1]);
check('RMS(dense) strictly decreasing in N', mono(rmsRows.dense), rmsRows.dense.map(v => v.toFixed(1)).join(' > '));
check('RMS(dense)/x^1.5 strictly decreasing in N', mono(rmsRows.rel), rmsRows.rel.map(v => v.toExponential(2)).join(' > '));
if (fails.length) { console.log('\nFAILED: ' + fails.join('; ')); process.exit(1); }
console.log('\nALL CHECKS PASSED');
