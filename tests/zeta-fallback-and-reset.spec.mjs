// Regression tests for review #271: sync-fallback NaN for N>100, and raw not cleared at N=0.
import { test, expect } from '@playwright/test';

async function boot(page, { blockWorker }) {
    if (blockWorker) await page.route('**/worker.js', r => r.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => page.locator('#boot-stage').textContent(), { timeout: 45_000 }).toBe('Ready');
}

const stat = (page, idx) => page.evaluate(i => {
    const s = window.__APP_STATE__;
    return { off: s.zetaOffsets[i], raw: s.zetaOffsetsRaw[i] };
}, idx);

async function setN(page, n) {
    // Set value + fire input like a user drag; unlike locator.fill() this tolerates
    // out-of-range requests (the browser clamps to the slider's current max).
    await page.locator('#zeta-n-slider').evaluate((el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, n);
}

test.describe('zeta N handling', () => {
    test('sync fallback (worker blocked): no NaN for N>100', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { blockWorker: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();
        await setN(page, 101);
        const r = await page.evaluate(() => {
            const s = window.__APP_STATE__;
            let nan = 0;
            for (let i = 0; i < s.MAX_POINTS; i++) if (!Number.isFinite(s.zetaOffsets[i])) nan++;
            return { nan, v99: s.zetaOffsets[99] };
        });
        expect(r.nan).toBe(0);
        expect(Number.isFinite(r.v99)).toBe(true);
    });

    test('N back to 0 clears both normalized and raw (worker path)', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { blockWorker: false });
        await page.locator('#group-zeta-toggle .toggle-row').click();
        await setN(page, 100);
        await expect.poll(async () => (await stat(page, 99)).raw, { timeout: 60_000 }).not.toBe(0);
        await setN(page, 0);
        const r = await stat(page, 99);
        expect(r.off).toBe(0);
        expect(r.raw).toBe(0);
    });

    // Review #275: displayed N must equal the N actually computed in fallback.
    test('sync fallback: displayed N matches effective N (cap 100); worker path keeps 1000', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { blockWorker: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();
        await setN(page, 1000);
        const ui = () => page.evaluate(() => ({
            slider: +document.querySelector('#zeta-n-slider').value,
            max: +document.querySelector('#zeta-n-slider').max,
            label: document.querySelector('#zeta-n-val').textContent.trim(),
            note: document.querySelector('#zeta-n-note')?.textContent ?? '',
            state: window.__APP_STATE__.zetaZeroCount,
        }));
        const a = await ui();
        expect(a.state).toBe(100);
        expect(a.slider).toBe(100);
        expect(a.label).toBe('100');
        expect(a.max).toBe(100);
        expect(a.note).toContain('100');
        // computed result equals an explicit N=100 result
        const v1000 = await stat(page, 99);
        await setN(page, 100);
        const v100 = await stat(page, 99);
        expect(v1000.off).toBe(v100.off);
        expect(v1000.raw).toBe(v100.raw);
    });

    test('worker path: slider range and label stay at N=1000', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { blockWorker: false });
        await page.locator('#group-zeta-toggle .toggle-row').click();
        await setN(page, 1000);
        const u = await page.evaluate(() => ({
            max: +document.querySelector('#zeta-n-slider').max,
            label: document.querySelector('#zeta-n-val').textContent.trim(),
            state: window.__APP_STATE__.zetaZeroCount,
            note: document.querySelector('#zeta-n-note')?.textContent ?? '',
        }));
        expect(u).toEqual({ max: 1000, label: '1000', state: 1000, note: '' });
    });
});
