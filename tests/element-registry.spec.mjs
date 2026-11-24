import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function listJs(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listJs(p) : p.endsWith('.js') ? [p] : [];
  });
}

async function waitForReady(page) {
  await expect.poll(
    async () => page.locator('#boot-stage').textContent(),
    { timeout: 45_000, message: 'App should finish booting' },
  ).toBe('Ready');
  await expect(page.locator('#boot-overlay')).toBeHidden({ timeout: 5_000 });
}

test.describe('element registry (Issue #33)', () => {
  test('every getElement() ID used in app/ is registered in initElements and exists in index.html', () => {
    const panels = readFileSync(join(root, 'app/ui/panels.js'), 'utf8');
    const block = panels.match(/const ids = \[([\s\S]*?)\];/)[1];
    const registered = new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));

    const used = new Set();
    for (const f of listJs(join(root, 'app'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/getElement\(\s*['"]([^'"]+)['"]\s*\)/g)) used.add(m[1]);
      // dynamic IDs cannot be checked statically; fail loudly instead of skipping silently
      for (const m of src.matchAll(/getElement\(\s*(?!['"])([^)]+)\)/g)) {
        if (!f.endsWith('panels.js')) throw new Error(`Dynamic getElement(${m[1]}) in ${f}: use a literal ID`);
      }
    }
    expect(used.size).toBeGreaterThan(60);

    expect([...used].filter((id) => !registered.has(id))).toEqual([]);

    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect([...used].filter((id) => !html.includes(`id="${id}"`))).toEqual([]);
  });

  test('nav buttons actually navigate to sub-apps', async ({ page }) => {
    const targets = [
      ['#nav-warped', /\/warpednt\/index\.html$/],
      ['#nav-gaussian', /\/gaussianprimes\/index\.html$/],
      ['#nav-music', /\/primemusic\/index\.html$/],
    ];
    for (const [sel, url] of targets) {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForReady(page);
      await page.locator(sel).click();
      await expect(page).toHaveURL(url);
    }
  });

  test('center / hide-ui / random-triple / sieve step & reset buttons take effect', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    // hide-ui-btn: toggles overlay visibility
    expect(await page.evaluate(() => window.__APP_STATE__.uiVisible)).toBe(true);
    await page.locator('#hide-ui-btn').evaluate((el) => el.click());
    await expect(page.locator('#ui-overlay')).toHaveClass(/hidden/);
    expect(await page.evaluate(() => window.__APP_STATE__.uiVisible)).toBe(false);
    await page.locator('#hide-ui-btn').evaluate((el) => el.click());
    await expect(page.locator('#ui-overlay')).not.toHaveClass(/hidden/);

    // center-btn: camera jumps to the '1' position
    const cam = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      s.camera.position.set(1, 2, 3);
      document.getElementById('center-btn').click();
      const t = s.targetPositions;
      return { pos: s.camera.position.toArray(), want: [t[0] + 3000, t[1] + 3000, t[2] + 5000] };
    });
    // render loop may nudge the camera a frame later, so allow a small tolerance
    cam.pos.forEach((v, i) => expect(Math.abs(v - cam.want[i])).toBeLessThan(5));

    // primedim-random-btn: picks a sorted triple of distinct primes and syncs the selects
    const tri = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      s.primeDimP = [0, 0, 0];
      document.getElementById('primedim-random-btn').click();
      return {
        p: s.primeDimP,
        sel: ['x', 'y', 'z'].map((a) => Number(document.getElementById(`primedim-${a}-select`).value)),
      };
    });
    expect(tri.p).toHaveLength(3);
    expect(new Set(tri.p).size).toBe(3);
    expect(tri.p.every((v) => v > 1)).toBe(true);
    expect(tri.sel).toEqual(tri.p);

    // sieve-step-btn / sieve-reset-btn
    await page.locator('#sw-sieve').click();
    await expect.poll(() => page.evaluate(() => window.__APP_STATE__.sieveModeActive)).toBe(true);
    await page.locator('#sieve-step-btn').click();
    const afterStep = await page.evaluate(() => window.__APP_STATE__.sieveCurrentP);
    expect(afterStep).toBeGreaterThan(2);
    await page.locator('#sieve-reset-btn').click();
    expect(await page.evaluate(() => window.__APP_STATE__.sieveCurrentP)).toBe(2);
  });
});
