// Regression test for review #283: sync fallback reuses raw + max|raw| while effective N is unchanged.
import { test, expect } from '@playwright/test';

async function boot(page, { blockWorker }) {
    if (blockWorker) await page.route('**/worker.js', r => r.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => page.locator('#boot-stage').textContent(), { timeout: 45_000 }).toBe('Ready');
}

const setN = async (page, n) => {
    await page.locator('#zeta-n-slider').evaluate((el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, n);
};

test.describe('zeta sync fallback cache', () => {
    // Review #283: fallback must reuse raw + max|raw| while the effective N is unchanged.
    test('sync fallback: amplitude/spacing changes do not recompute the zero sum', async ({ page }) => {
        test.setTimeout(120_000);
        await boot(page, { blockWorker: true });
        await page.locator('#group-zeta-toggle .toggle-row').click();
        await setN(page, 20);
        const setSlider = (id, v) => page.locator(id).evaluate((el, val) => {
            el.value = String(val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, v);
        const snap = () => page.evaluate(() => {
            const s = window.__APP_STATE__;
            return { off: s.zetaOffsets[999], raw: s.zetaOffsetsRaw[999], spacing: s.currentSpacing, amp: s.zetaAmplitude };
        });
        const base = await snap();
        // count Math.cos calls across the parameter changes
        await page.evaluate(() => {
            window.__cosCalls = 0;
            const orig = Math.cos;
            Math.cos = (x) => { window.__cosCalls++; return orig(x); };
        });
        await setSlider('#zeta-amp-slider', 2.5);
        await page.waitForTimeout(300);
        const a = await snap();
        // spacing: set state directly (the spacing slider also rebuilds the whole lattice, which is
        // unrelated heavy work), then nudge the zeta recompute through the amplitude slider.
        await page.evaluate(() => { window.__APP_STATE__.currentSpacing = 120; });
        await setSlider('#zeta-amp-slider', 2.5);
        await page.waitForTimeout(300);
        const b = await snap();
        const cos = await page.evaluate(() => window.__cosCalls);
        // a full recompute is 6,400,000 calls (N=20 x 320,000 points); allow a little unrelated render noise
        expect(cos).toBeLessThan(10_000);
        // raw unchanged; normalization follows amplitude and spacing
        expect(a.raw).toBe(base.raw);
        expect(b.raw).toBe(base.raw);
        expect(a.off).toBeCloseTo(base.off * 2.5 / base.amp, 3);
        expect(b.off).toBeCloseTo(base.off * (2.5 / base.amp) * (b.spacing / base.spacing), 3);
        // N change still recomputes (cache keyed by effective N)
        await setN(page, 2);
        expect(await page.evaluate(() => window.__cosCalls)).toBeGreaterThan(500_000); // 2 x 320,000
    });
});
