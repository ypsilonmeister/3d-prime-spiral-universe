// Tests for Issue #8 PR 2: progressive partial sums (zeta_partial) emission,
// time-based throttling (D3), offsets/rawOffsets consistency, live rendering,
// progress text showing rendered zero count, stale partial isolation, and D6 fallback invariant.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const PARTIAL_HARNESS = fileURLToPath(new URL('./helpers/worker-zeta-partial-harness.mjs', import.meta.url));
const ZETA_ZEROS_1000 = [...readFileSync(fileURLToPath(new URL('../shared/zeta-zeros-1000.js', import.meta.url)), 'utf8')
    .replace(/\/\/.*$/gm, '').matchAll(/\d+\.\d+/g)].map(m => parseFloat(m[0]));

// Independent reference: -sum_{k<N} 2 Re(x^rho_k / rho_k) with rho_k = 1/2 + i*gamma_k.
function refRaw(x, N) {
    const L = Math.log(x), sx = Math.sqrt(x);
    let s = 0;
    for (let k = 0; k < N; k++) {
        const g = ZETA_ZEROS_1000[k];
        const re = sx * Math.cos(g * L), im = sx * Math.sin(g * L);
        s += (re * 0.5 + im * g) / (0.25 + g * g);
    }
    return -2 * s;
}

async function boot(page, { blockWorker = false, spyZeta = false } = {}) {
    if (spyZeta) {
        await page.addInitScript(() => {
            window.__zetaEvents = [];
            window.__workerOnMessage = null;
            const Orig = window.Worker;
            window.Worker = class extends Orig {
                set onmessage(fn) {
                    const wrapped = (e) => {
                        fn.call(this, e);
                        const m = e.data;
                        if (m && (m.type === 'zeta_partial' || m.type === 'zeta_done')) {
                            const s = window.__APP_STATE__;
                            window.__zetaEvents.push({
                                t: performance.now(),
                                type: m.type,
                                reqId: m.reqId,
                                doneK: m.type === 'zeta_partial' ? m.doneK : m.N,
                                targetN: m.targetN ?? m.N,
                                stateComputedN: s?.zetaComputedN,
                                stateComputing: s?.zetaComputing,
                                lerpActive: s?.lerpActive,
                                sliderVal: document.getElementById('zeta-n-slider')?.value,
                                nLabel: document.getElementById('zeta-n-val')?.innerText,
                                progressText: document.getElementById('zeta-progress-text')?.textContent,
                                progressVisible: document.getElementById('zeta-progress-wrap')?.style.display !== 'none',
                                raw99: s?.zetaOffsetsRaw?.[99],
                                off99: s?.zetaOffsets?.[99],
                                targetZ99: s?.targetPositions?.[99 * 3 + 2],
                                baseZ99: s?.baseTargetPositions?.[99 * 3 + 2],
                            });
                        }
                    };
                    window.__workerOnMessage = wrapped;
                    super.onmessage = wrapped;
                }
            };
        });
    }
    if (blockWorker) await page.route('**/worker.js', r => r.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => page.locator('#boot-stage').textContent(), { timeout: 45_000 }).toBe('Ready');
}

async function setSlider(page, selector, v) {
    await page.locator(selector).evaluate((el, val) => {
        el.value = String(val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
}

test.describe('worker zeta_partial protocol (Node)', () => {
    test('emits time-throttled partials matching exact partial sums, preserves cache, and isolates cancel/supersede', () => {
        const out = JSON.parse(execFileSync(
            process.execPath,
            ['--no-warnings', PARTIAL_HARNESS, '4001'],
            { encoding: 'utf8', maxBuffer: 1 << 24 }
        ));

        // Fast path, cache hit, and N=0 never emit zeta_partial
        expect(out.fastPartials).toBe(0);
        expect(out.hitPartials).toBe(0);
        expect(out.zeroPartials).toBe(0);

        // Incremental 100 -> 1000 (fake clock 150ms/chunk -> first chunk immediate at 120, then every 450ms)
        const partials = out.inc1000.partials;
        expect(partials.length).toBeGreaterThanOrEqual(10);
        expect(partials[0].doneK).toBe(120);
        expect(partials[0].t).toBe(150);

        let prevDone = 100;
        let prevT = null;
        for (const p of partials) {
            expect(p.reqId).toBe(5);
            expect(p.targetN).toBe(1000);
            expect(p.doneK).toBeGreaterThan(prevDone);
            expect(p.doneK).toBeLessThan(1000);
            if (prevT !== null) {
                expect(p.t - prevT).toBeGreaterThanOrEqual(350);
                expect(p.t - prevT).toBeLessThanOrEqual(450);
            }
            expect(p.offsetsIsF32).toBe(true);
            expect(p.rawIsF32).toBe(true);
            expect(p.distinctBuffers).toBe(true);
            expect(p.transferOk).toBe(true);
            expect(p.rawBitEqual).toBe(true);
            expect(p.offsetsBitEqual).toBe(true);
            prevDone = p.doneK;
            prevT = p.t;
        }
        // Final zeta_done matches single-pass N=1000 bit-for-bit
        expect(out.inc1000.doneN).toBe(1000);
        expect(out.inc1000.doneRecomputed).toBe(true);
        expect(out.inc1000.doneRawBitEqual).toBe(true);
        expect(out.inc1000.doneOffsetsBitEqual).toBe(true);

        // Cancel right after a partial (with poisoned transferred buffers): zero stray messages, cache intact
        expect(out.cancel.cancelAtK).toBeGreaterThanOrEqual(80);
        expect(out.cancel.strayAfterCancel).toEqual([]);
        expect(out.cancel.cacheHitRecomputed).toBe(false);
        expect(out.cancel.cacheHitPartials).toBe(0);
        expect(out.cancel.cacheHitRawBitEqual).toBe(true);
        expect(out.cancel.cacheHitOffsetsBitEqual).toBe(true);
        expect(out.cancel.resumePartials.length).toBeGreaterThanOrEqual(1);
        expect(out.cancel.resumePartials[0].doneK).toBe(out.cancel.cancelAtK + 20);
        for (const p of out.cancel.resumePartials) {
            expect(p.rawBitEqual).toBe(true);
            expect(p.offsetsBitEqual).toBe(true);
        }
        expect(out.cancel.resumeDoneRawBitEqual).toBe(true);
        expect(out.cancel.resumeDoneOffsetsBitEqual).toBe(true);

        // Supersede shrinking N (0 -> 1000 superseded by N=60): no stale partials, bit-exact final
        expect(out.supersedeShrink.strayShrink).toEqual([]);
        expect(out.supersedeShrink.partials.length).toBeGreaterThanOrEqual(1);
        expect(out.supersedeShrink.partials[0]).toMatchObject({
            reqId: 12, doneK: 20, targetN: 60, rawBitEqual: true, offsetsBitEqual: true,
        });
        expect(out.supersedeShrink.doneN).toBe(60);
        expect(out.supersedeShrink.doneRawBitEqual).toBe(true);
        expect(out.supersedeShrink.doneOffsetsBitEqual).toBe(true);

        // Supersede growing N (0 -> 1000 superseded at >=80 by N=160): resumes cleanly, no stale partials
        expect(out.supersedeGrow.strayGrow).toEqual([]);
        expect(out.supersedeGrow.partials.length).toBeGreaterThanOrEqual(1);
        expect(out.supersedeGrow.partials[0]).toMatchObject({
            reqId: 15,
            doneK: out.supersedeGrow.growSupersededAtK + 20,
            targetN: 160,
            rawBitEqual: true,
            offsetsBitEqual: true,
        });
        expect(out.supersedeGrow.doneN).toBe(160);
        expect(out.supersedeGrow.doneRawBitEqual).toBe(true);
        expect(out.supersedeGrow.doneOffsetsBitEqual).toBe(true);
    });

    test('real-clock MAX=320000 partial emission intervals stay within D3 350-450ms and match bit-exact final result', () => {
        const out = JSON.parse(execFileSync(
            process.execPath,
            ['--no-warnings', PARTIAL_HARNESS, '320000', '--real-clock', '100', '350'],
            { encoding: 'utf8', maxBuffer: 1 << 24 }
        ));

        expect(out.firstK).toBe(120);
        expect(out.partialsCount).toBeGreaterThanOrEqual(5);
        expect(out.intervalsMs.length).toBe(out.partialsCount - 1);
        for (const dt of out.intervalsMs) {
            expect(dt).toBeGreaterThanOrEqual(350);
            expect(dt).toBeLessThanOrEqual(450);
        }
        expect(out.doneRawBitEqual).toBe(true);
        expect(out.doneOffsetsBitEqual).toBe(true);
    });
});

test.describe('zeta partial sums live rendering & isolation (Browser)', () => {
    test('N=100 -> 1000 renders progressive partial sums, updates targetPositions, and shows rendered count in progress text', async ({ page }) => {
        test.setTimeout(180_000);
        await boot(page, { spyZeta: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();

        // Warm cache to N=100 first
        await setSlider(page, '#zeta-n-slider', 100);
        await expect.poll(async () => page.evaluate(() => {
            const s = window.__APP_STATE__;
            return s.zetaComputedN === 100 && !s.zetaComputing;
        }), { timeout: 60_000 }).toBe(true);

        // Clear recorded events and trigger N=100 -> 1000
        const tStart = await page.evaluate(() => {
            window.__zetaEvents = [];
            return performance.now();
        });
        await setSlider(page, '#zeta-n-slider', 1000);

        // Wait for final completion
        await expect.poll(async () => page.evaluate(() => {
            const s = window.__APP_STATE__;
            return s.zetaComputedN === 1000 && !s.zetaComputing;
        }), { timeout: 120_000 }).toBe(true);

        const events = await page.evaluate(() => window.__zetaEvents);
        const partials = events.filter(e => e.type === 'zeta_partial' && e.targetN === 1000);
        const done = events.find(e => e.type === 'zeta_done' && e.doneK === 1000);

        expect(done).toBeTruthy();
        expect(partials.length).toBeGreaterThanOrEqual(2);
        expect(partials[0].doneK).toBe(120);

        let prevDone = 100;
        for (const p of partials) {
            expect(p.t).toBeLessThan(done.t);
            expect(p.doneK).toBeGreaterThan(prevDone);
            expect(p.doneK).toBeLessThan(1000);
            expect(p.stateComputedN).toBe(p.doneK);
            expect(p.stateComputing).toBe(true);
            expect(p.lerpActive).toBe(true);
            // Slider and label stay on the user's target (1000) while progress text reports rendered zeros
            expect(p.sliderVal).toBe('1000');
            expect(p.nLabel).toBe('1000');
            expect(p.progressVisible).toBe(true);
            expect(p.progressText).toContain(`Showing ${p.doneK} / 1000 zeros`);
            // applyPositionOverlays committed offsets into targetPositions (baseZ + off === targetZ)
            expect(Math.abs((p.baseZ99 + p.off99) - p.targetZ99)).toBeLessThan(1e-3);
            // rawOffsets at index 99 (x = 100) matches independent partial zero sum for 0..doneK
            const expectedRaw = refRaw(100, p.doneK);
            expect(Math.abs(p.raw99 - expectedRaw)).toBeLessThan(1e-4 * Math.max(1, Math.abs(expectedRaw)));
            prevDone = p.doneK;
        }

        // Verify wave actually evolves across partials and converges to N=1000
        const distinctRaws = new Set(partials.map(p => p.raw99));
        expect(distinctRaws.size).toBeGreaterThanOrEqual(2);
        const expected1000 = refRaw(100, 1000);
        expect(Math.abs(done.raw99 - expected1000)).toBeLessThan(1e-4 * Math.max(1, Math.abs(expected1000)));
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();

        const ttfpPartial = Math.round(partials[0].t - tStart);
        const ttfc = Math.round(done.t - tStart);
        console.log(`Zeta 100->1000 partial metrics: TTFPR=${ttfpPartial}ms, partials=${partials.length}, TTFC=${ttfc}ms`);
    });

    test('changing N or exiting Zeta mid-flight drops stale zeta_partial messages cleanly', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { spyZeta: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();

        // Start 0 -> 1000 and wait for first zeta_partial
        await setSlider(page, '#zeta-n-slider', 1000);
        await expect.poll(async () => page.evaluate(() => (
            window.__zetaEvents.some(e => e.type === 'zeta_partial' && e.targetN === 1000)
        )), { timeout: 20_000, intervals: [50] }).toBe(true);

        const oldReqId = await page.evaluate(() => (
            window.__zetaEvents.find(e => e.type === 'zeta_partial' && e.targetN === 1000).reqId
        ));

        // Change N to 50 mid-flight (superseding reqId), then inject a stale zeta_partial with oldReqId
        await setSlider(page, '#zeta-n-slider', 50);
        const staleInjectedIgnored = await page.evaluate((staleId) => {
            const s = window.__APP_STATE__;
            const beforeComputed = s.zetaComputedN;
            const beforeRaw99 = s.zetaOffsetsRaw[99];
            const beforeOff99 = s.zetaOffsets[99];
            const sentinelOff = new Float32Array(s.MAX_POINTS).fill(9999);
            const sentinelRaw = new Float32Array(s.MAX_POINTS).fill(-9999);
            window.__workerOnMessage({
                data: {
                    type: 'zeta_partial',
                    reqId: staleId,
                    doneK: 777,
                    targetN: 1000,
                    offsets: sentinelOff,
                    rawOffsets: sentinelRaw,
                },
            });
            return {
                computedUnchanged: s.zetaComputedN === beforeComputed,
                rawUnchanged: s.zetaOffsetsRaw[99] === beforeRaw99,
                offUnchanged: s.zetaOffsets[99] === beforeOff99,
            };
        }, oldReqId);
        expect(staleInjectedIgnored).toEqual({
            computedUnchanged: true,
            rawUnchanged: true,
            offUnchanged: true,
        });

        // Wait for N=50 completion and confirm exact N=50 values (no contamination from N=1000)
        await expect.poll(async () => page.evaluate(() => {
            const s = window.__APP_STATE__;
            return s.zetaComputedN === 50 && !s.zetaComputing;
        }), { timeout: 60_000 }).toBe(true);

        const raw50 = await page.evaluate(() => window.__APP_STATE__.zetaOffsetsRaw[99]);
        const expected50 = refRaw(100, 50);
        expect(Math.abs(raw50 - expected50)).toBeLessThan(1e-4 * Math.max(1, Math.abs(expected50)));

        // Start 0 -> 1000 again, wait for a partial, then exit Zeta mode and inject stale partial
        await page.evaluate(() => { window.__zetaEvents = []; });
        await setSlider(page, '#zeta-n-slider', 1000);
        await expect.poll(async () => page.evaluate(() => (
            window.__zetaEvents.some(e => e.type === 'zeta_partial' && e.targetN === 1000)
        )), { timeout: 20_000, intervals: [50] }).toBe(true);

        const cancelReqId = await page.evaluate(() => (
            window.__zetaEvents.find(e => e.type === 'zeta_partial' && e.targetN === 1000).reqId
        ));

        await page.locator('#group-zeta-toggle .toggle-row').click();
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();

        const afterCancelInject = await page.evaluate((staleId) => {
            const s = window.__APP_STATE__;
            window.__workerOnMessage({
                data: {
                    type: 'zeta_partial',
                    reqId: staleId,
                    doneK: 440,
                    targetN: 1000,
                    offsets: new Float32Array(s.MAX_POINTS).fill(1234),
                    rawOffsets: new Float32Array(s.MAX_POINTS).fill(-1234),
                },
            });
            return {
                computedN: s.zetaComputedN,
                computing: s.zetaComputing,
                raw99: s.zetaOffsetsRaw[99],
                off99: s.zetaOffsets[99],
            };
        }, cancelReqId);
        expect(afterCancelInject).toEqual({
            computedN: 0,
            computing: false,
            raw99: 0,
            off99: 0,
        });
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();
    });

    test('pre-rAF N change immediately invalidates in-flight partials/progress/done before next frame', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { spyZeta: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();

        // Start 0 -> 600 and wait for the first zeta_partial
        await setSlider(page, '#zeta-n-slider', 600);
        await expect.poll(async () => page.evaluate(() => (
            window.__zetaEvents.some(e => e.type === 'zeta_partial' && e.targetN === 600)
        )), { timeout: 20_000, intervals: [50] }).toBe(true);

        const oldReqId = await page.evaluate(() => (
            window.__zetaEvents.find(e => e.type === 'zeta_partial' && e.targetN === 600).reqId
        ));

        // In the exact same JS turn (strictly BEFORE rafThrottle's next rAF fires):
        //   1. Dispatch slider input to N=50
        //   2. Deliver stale progress, zeta_partial, and zeta_done with oldReqId
        // State buffers, zetaComputedN, targetPositions, and progress UI must stay untouched.
        const preRafResult = await page.evaluate((staleId) => {
            const s = window.__APP_STATE__;
            const beforeComputed = s.zetaComputedN;
            const beforeRaw99 = s.zetaOffsetsRaw[99];
            const beforeOff99 = s.zetaOffsets[99];
            const beforeTargetZ99 = s.targetPositions[99 * 3 + 2];

            const slider = document.getElementById('zeta-n-slider');
            slider.value = '50';
            slider.dispatchEvent(new Event('input', { bubbles: true }));

            window.__workerOnMessage({
                data: {
                    type: 'progress',
                    stage: 'zeta',
                    reqId: staleId,
                    startK: 0,
                    doneK: 40,
                    targetN: 600,
                    pct: 6.7,
                },
            });
            window.__workerOnMessage({
                data: {
                    type: 'zeta_partial',
                    reqId: staleId,
                    doneK: 40,
                    targetN: 600,
                    offsets: new Float32Array(s.MAX_POINTS).fill(1234),
                    rawOffsets: new Float32Array(s.MAX_POINTS).fill(-1234),
                },
            });
            const wrap = document.getElementById('zeta-progress-wrap');
            const afterPartialHidden = wrap?.style.display === 'none';
            const afterPartialText = document.getElementById('zeta-progress-text')?.textContent || '';
            const afterPartialComputed = s.zetaComputedN;
            const afterPartialRaw99 = s.zetaOffsetsRaw[99];

            window.__workerOnMessage({
                data: {
                    type: 'zeta_done',
                    reqId: staleId,
                    N: 600,
                    offsets: new Float32Array(s.MAX_POINTS).fill(5678),
                    rawOffsets: new Float32Array(s.MAX_POINTS).fill(-5678),
                    recomputed: true,
                },
            });

            const text = document.getElementById('zeta-progress-text')?.textContent || '';
            return {
                requestedN: s.zetaZeroCount,
                afterPartialComputedUnchanged: afterPartialComputed === beforeComputed,
                afterPartialRawUnchanged: afterPartialRaw99 === beforeRaw99,
                afterPartialHidden,
                afterPartialText,
                computedUnchanged: s.zetaComputedN === beforeComputed,
                rawUnchanged: s.zetaOffsetsRaw[99] === beforeRaw99,
                offUnchanged: s.zetaOffsets[99] === beforeOff99,
                targetUnchanged: s.targetPositions[99 * 3 + 2] === beforeTargetZ99,
                progressHidden: wrap?.style.display === 'none',
                progressText: text,
            };
        }, oldReqId);

        expect(preRafResult).toEqual({
            requestedN: 50,
            afterPartialComputedUnchanged: true,
            afterPartialRawUnchanged: true,
            afterPartialHidden: true,
            afterPartialText: '',
            computedUnchanged: true,
            rawUnchanged: true,
            offUnchanged: true,
            targetUnchanged: true,
            progressHidden: true,
            progressText: '',
        });

        // After the deferred rAF runs, N=50 must complete with exact N=50 values.
        await expect.poll(async () => page.evaluate(() => {
            const s = window.__APP_STATE__;
            return s.zetaComputedN === 50 && !s.zetaComputing;
        }), { timeout: 60_000 }).toBe(true);

        const raw50 = await page.evaluate(() => window.__APP_STATE__.zetaOffsetsRaw[99]);
        const expected50 = refRaw(100, 50);
        expect(Math.abs(raw50 - expected50)).toBeLessThan(1e-4 * Math.max(1, Math.abs(expected50)));

        // Also verify defense-in-depth in worker-client.js when state.zetaZeroCount diverges
        // directly (without going through slider input) while a request is in flight.
        await page.evaluate(() => { window.__zetaEvents = []; });
        await setSlider(page, '#zeta-n-slider', 600);
        await expect.poll(async () => page.evaluate(() => (
            window.__zetaEvents.some(e => e.type === 'zeta_partial' && e.targetN === 600)
        )), { timeout: 20_000, intervals: [50] }).toBe(true);

        const activeReqId = await page.evaluate(() => (
            window.__zetaEvents.find(e => e.type === 'zeta_partial' && e.targetN === 600).reqId
        ));

        const directDivergenceIgnored = await page.evaluate((reqId) => {
            const s = window.__APP_STATE__;
            const beforeComputed = s.zetaComputedN;
            const beforeRaw99 = s.zetaOffsetsRaw[99];
            const beforeOff99 = s.zetaOffsets[99];
            s.zetaZeroCount = 50; // direct state mutation without bumping reqId
            window.__workerOnMessage({
                data: {
                    type: 'zeta_partial',
                    reqId,
                    doneK: 80,
                    targetN: 600,
                    offsets: new Float32Array(s.MAX_POINTS).fill(4321),
                    rawOffsets: new Float32Array(s.MAX_POINTS).fill(-4321),
                },
            });
            return {
                computedUnchanged: s.zetaComputedN === beforeComputed,
                rawUnchanged: s.zetaOffsetsRaw[99] === beforeRaw99,
                offUnchanged: s.zetaOffsets[99] === beforeOff99,
            };
        }, activeReqId);

        expect(directDivergenceIgnored).toEqual({
            computedUnchanged: true,
            rawUnchanged: true,
            offUnchanged: true,
        });
    });

    test('sync fallback (D6=A) completes synchronously with no partial progress UI', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { blockWorker: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();

        await setSlider(page, '#zeta-n-slider', 60);
        await expect.poll(async () => page.evaluate(() => window.__APP_STATE__.zetaComputedN), { timeout: 30_000 }).toBe(60);

        const snap = await page.evaluate(() => ({
            computing: window.__APP_STATE__.zetaComputing,
            computedN: window.__APP_STATE__.zetaComputedN,
            raw99: window.__APP_STATE__.zetaOffsetsRaw[99],
            progressHidden: document.getElementById('zeta-progress-wrap')?.style.display === 'none',
            progressText: document.getElementById('zeta-progress-text')?.textContent || '',
        }));
        const expected60 = refRaw(100, 60);
        expect(snap.computing).toBe(false);
        expect(snap.computedN).toBe(60);
        expect(snap.progressHidden).toBe(true);
        expect(snap.progressText).toBe('');
        expect(Math.abs(snap.raw99 - expected60)).toBeLessThan(1e-4 * Math.max(1, Math.abs(expected60)));
    });
});
