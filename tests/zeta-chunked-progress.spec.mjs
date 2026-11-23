// Tests for Issue #8 PR 1: chunked async zeta computation, work-relative progress UI,
// zeta_cancel protocol, Explicit Mode timeout prevention, and fallback incremental S cache.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHUNKED_HARNESS = fileURLToPath(new URL('./helpers/worker-zeta-chunked-harness.mjs', import.meta.url));

async function boot(page, { blockWorker = false, spyWorker = false } = {}) {
    if (spyWorker) {
        await page.addInitScript(() => {
            window.__posted = [];
            const Orig = window.Worker;
            window.Worker = class extends Orig {
                postMessage(m, ...r) {
                    if (m && m.type) window.__posted.push({ type: m.type, reqId: m.reqId, N: m.N });
                    return super.postMessage(m, ...r);
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

test.describe('worker chunked zeta protocol (Node)', () => {
    test('progress emission (D4), cancellation, intermediate cache resume, and bit-identical results', () => {
        const out = JSON.parse(execFileSync(
            process.execPath,
            ['--no-warnings', CHUNKED_HARNESS, '4001'],
            { encoding: 'utf8', maxBuffer: 1 << 24 }
        ));

        // Fast path (0 -> 10) and cache hit (10 -> 10) emit zero progress messages (D4).
        expect(out.fast).toEqual({ progressCount: 0, recomputed: true, N: 10 });
        expect(out.hit).toEqual({ progressCount: 0, recomputed: false, N: 10 });

        // Incremental chunked path (10 -> 100): work-relative pct = (doneK - 10) / 90 * 100.
        expect(out.inc100.recomputed).toBe(true);
        expect(out.inc100.N).toBe(100);
        expect(out.inc100.progress.length).toBeGreaterThanOrEqual(4);
        let prevDone = -1;
        let prevPct = -1;
        for (const p of out.inc100.progress) {
            expect(p.reqId).toBe(3);
            expect(p.startK).toBe(10);
            expect(p.targetN).toBe(100);
            expect(p.doneK).toBeGreaterThan(prevDone);
            expect(p.doneK).toBeLessThan(100);
            expect(p.pct).toBeGreaterThan(prevPct);
            expect(p.pct).toBeCloseTo(((p.doneK - 10) / 90) * 100, 6);
            prevDone = p.doneK;
            prevPct = p.pct;
        }
        expect(out.inc100.rawBitEqual).toBe(true);
        expect(out.inc100.offsetsBitEqual).toBe(true);

        // Incremental 100 -> 1000 matches single-pass master calculation bit-for-bit.
        expect(out.inc1000.recomputed).toBe(true);
        expect(out.inc1000.N).toBe(1000);
        expect(out.inc1000.progressCount).toBeGreaterThanOrEqual(40);
        expect(out.inc1000.firstProgress).toMatchObject({ reqId: 4, startK: 100, doneK: 100, targetN: 1000, pct: 0 });
        expect(out.inc1000.lastProgress.doneK).toBeLessThan(1000);
        expect(out.inc1000.lastProgress.doneK).toBeGreaterThan(900);
        expect(out.inc1000.rawBitEqual).toBe(true);
        expect(out.inc1000.offsetsBitEqual).toBe(true);

        // zeta_cancel stops job without stray replies, preserves partial cache, and resumes cleanly.
        expect(out.cancel.cancelAtK).toBeGreaterThanOrEqual(60);
        expect(out.cancel.strayAfterCancel).toEqual([]);
        expect(out.cancel.resumeExactProgressCount).toBe(0);
        expect(out.cancel.resumeExactRecomputed).toBe(false);
        expect(out.cancel.resumeExactRawBitEqual).toBe(true);
        expect(out.cancel.resumeExactOffsetsBitEqual).toBe(true);
        expect(out.cancel.resume200FirstProgress.startK).toBe(out.cancel.cancelAtK);
        expect(out.cancel.resume200FirstProgress.targetN).toBe(200);
        expect(out.cancel.resume200ProgressCount).toBeGreaterThanOrEqual(2);
        expect(out.cancel.resume200RawBitEqual).toBe(true);
        expect(out.cancel.resume200OffsetsBitEqual).toBe(true);

        // Superseding mid-flight request drops old reqId and resumes from committed partial sum.
        expect(out.supersede.supersededAtK).toBeGreaterThanOrEqual(40);
        expect(out.supersede.strayFromOld).toEqual([]);
        expect(out.supersede.firstProgress.startK).toBe(out.supersede.supersededAtK);
        expect(out.supersede.firstProgress.targetN).toBe(120);
        expect(out.supersede.rawBitEqual).toBe(true);
        expect(out.supersede.offsetsBitEqual).toBe(true);
    });
});

test.describe('zeta progress UI, cancellation, and Explicit Mode interop (Browser)', () => {
    test('N=100 -> 1000 displays work-relative progress and hides on completion; fast path & cache hit stay hidden', async ({ page }) => {
        test.setTimeout(180_000);
        await boot(page);
        await page.locator('#group-zeta-toggle .toggle-row').click();

        // Fast path (0 -> 10): progress bar remains hidden
        await setSlider(page, '#zeta-n-slider', 10);
        await expect.poll(async () => page.evaluate(() => window.__APP_STATE__.zetaComputedN), { timeout: 20_000 }).toBe(10);
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();

        // Bring cache to N=100
        await setSlider(page, '#zeta-n-slider', 100);
        await expect.poll(async () => page.evaluate(() => {
            const s = window.__APP_STATE__;
            return s.zetaComputedN === 100 && !s.zetaComputing;
        }), { timeout: 60_000 }).toBe(true);
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();

        // Cache hit (amplitude change at N=100): progress bar remains hidden
        await setSlider(page, '#zeta-amp-slider', 2.0);
        await page.waitForTimeout(300);
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();

        // Heavy incremental computation: N=100 -> 1000
        const t0 = Date.now();
        await setSlider(page, '#zeta-n-slider', 1000);

        await expect(page.locator('#zeta-progress-wrap')).toBeVisible({ timeout: 10_000 });
        const tFirstProgress = Date.now() - t0;

        // Observe progress advancing monotonically before completion
        let firstSeenDone = null;
        let sawAdvance = false;
        await expect.poll(async () => {
            const snap = await page.evaluate(() => ({
                computing: window.__APP_STATE__.zetaComputing,
                doneK: window.__APP_STATE__.zetaComputedN,
                targetN: window.__APP_STATE__.zetaTargetN,
                pct: window.__APP_STATE__.zetaProgressPct,
                text: document.getElementById('zeta-progress-text')?.textContent || '',
                val: document.getElementById('zeta-progress')?.value || 0,
            }));
            if (snap.computing && snap.targetN === 1000) {
                if (firstSeenDone === null) firstSeenDone = snap.doneK;
                if (snap.doneK > firstSeenDone && snap.pct > 0 && snap.text.includes('/ 1000')) {
                    sawAdvance = true;
                }
            }
            return sawAdvance;
        }, { timeout: 30_000, intervals: [100] }).toBe(true);

        // Wait for final completion and verify progress hides cleanly
        await expect.poll(async () => page.evaluate(() => {
            const s = window.__APP_STATE__;
            return s.zetaComputedN === 1000 && !s.zetaComputing && s.zetaOffsetsRaw[99] !== 0;
        }), { timeout: 120_000 }).toBe(true);
        const tFinalComplete = Date.now() - t0;

        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();
        console.log(`Zeta 100->1000 metrics: TTFP=${tFirstProgress}ms, TTFC=${tFinalComplete}ms`);
    });

    test('cancelling mid-flight N=1000 via N change or Zeta exit hides progress and drops stale updates', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { spyWorker: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();
        await setSlider(page, '#zeta-n-slider', 1000);

        // Wait until chunked calculation is actively underway
        await expect.poll(async () => page.evaluate(() => {
            const s = window.__APP_STATE__;
            return s.zetaComputing && s.zetaComputedN >= 20;
        }), { timeout: 20_000, intervals: [100] }).toBe(true);
        await expect(page.locator('#zeta-progress-wrap')).toBeVisible();

        // Exit Zeta Mode mid-flight -> sends zeta_cancel, hides progress, clears offsets
        await page.locator('#group-zeta-toggle .toggle-row').click();
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();

        const sentCancel = await page.evaluate(() => window.__posted.some(m => m.type === 'zeta_cancel'));
        expect(sentCancel).toBe(true);

        // Wait to confirm no stale progress or zeta_done overwrites cleared state
        await page.waitForTimeout(1500);
        const afterExit = await page.evaluate(() => ({
            computing: window.__APP_STATE__.zetaComputing,
            raw99: window.__APP_STATE__.zetaOffsetsRaw[99],
            off99: window.__APP_STATE__.zetaOffsets[99],
        }));
        expect(afterExit).toEqual({ computing: false, raw99: 0, off99: 0 });
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();
    });

    test('entering Explicit Mode during N=1000 cancels Zeta, hides progress UI, and completes without timeout/fallback', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { spyWorker: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();
        await setSlider(page, '#zeta-n-slider', 1000);

        // Wait until Worker is actively inside the N=1000 chunked loop
        await expect.poll(async () => page.evaluate(() => {
            const s = window.__APP_STATE__;
            return s.zetaComputing && s.zetaComputedN >= 20;
        }), { timeout: 20_000, intervals: [100] }).toBe(true);
        await expect(page.locator('#zeta-progress-wrap')).toBeVisible();

        // Tighten explicit timeout well below remaining Zeta time (~20s) to prove cancellation prevents timeout
        await page.evaluate(() => { window.__APP_STATE__.explicitRequestTimeoutMs = 5000; });

        const tSwitch = Date.now();
        await page.locator('#group-explicit-toggle .toggle-row').click();

        // Zeta progress UI must not interfere with Explicit Mode (even though Zeta overlay stays enabled)
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();

        // Explicit Mode must complete promptly on the worker without falling back
        await expect.poll(async () => page.evaluate(() => {
            const i = window.__APP_STATE__.explicitInfo;
            return i && !i.pending && i.N != null ? { fallback: i.fallback, M: i.M, N: i.N } : null;
        }), { timeout: 15_000, intervals: [100] }).toEqual({ fallback: false, M: 1600, N: 1000 });

        const cancelLatency = Date.now() - tSwitch;
        const sentCancel = await page.evaluate(() => window.__posted.some(m => m.type === 'zeta_cancel'));
        expect(sentCancel).toBe(true);
        await expect(page.locator('#zeta-progress-wrap')).toBeHidden();
        console.log(`Explicit switch during Zeta N=1000 latency: ${cancelLatency}ms`);
    });

    test('sync fallback incremental S cache (D6): growing N computes only delta zeros with exact results', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { blockWorker: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();

        // Compute N=20 first
        await setSlider(page, '#zeta-n-slider', 20);
        await expect.poll(async () => page.evaluate(() => window.__APP_STATE__.zetaComputedN), { timeout: 20_000 }).toBe(20);

        // Instrument Math.cos and grow N: 20 -> 30 (only 10 additional zeros, not 30)
        await page.evaluate(() => {
            window.__cosCalls = 0;
            const orig = Math.cos;
            Math.cos = (x) => { window.__cosCalls++; return orig(x); };
        });

        await setSlider(page, '#zeta-n-slider', 30);
        await expect.poll(async () => page.evaluate(() => window.__APP_STATE__.zetaComputedN), { timeout: 20_000 }).toBe(30);

        const incremental = await page.evaluate(() => ({
            cosCalls: window.__cosCalls,
            raw99: window.__APP_STATE__.zetaOffsetsRaw[99],
            off99: window.__APP_STATE__.zetaOffsets[99],
        }));

        // 10 * 320,000 = 3,200,000 (full recompute for N=30 would be 9,600,000)
        expect(incremental.cosCalls).toBeGreaterThan(3_000_000);
        expect(incremental.cosCalls).toBeLessThan(5_000_000);

        // Shrink to N=5 (resets S), then compute N=30 from scratch and compare bit-exact
        await setSlider(page, '#zeta-n-slider', 5);
        await expect.poll(async () => page.evaluate(() => window.__APP_STATE__.zetaComputedN), { timeout: 20_000 }).toBe(5);
        await setSlider(page, '#zeta-n-slider', 30);
        await expect.poll(async () => page.evaluate(() => window.__APP_STATE__.zetaComputedN), { timeout: 20_000 }).toBe(30);

        const fresh = await page.evaluate(() => ({
            raw99: window.__APP_STATE__.zetaOffsetsRaw[99],
            off99: window.__APP_STATE__.zetaOffsets[99],
        }));
        expect(incremental.raw99).toBe(fresh.raw99);
        expect(incremental.off99).toBe(fresh.off99);
    });
});
