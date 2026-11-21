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
    await page.locator('#zeta-n-slider').fill(String(n));
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
});
