// PR-B: explicit-formula owner mode (minimal rendering).
import { test, expect } from '@playwright/test';

async function boot(page, { blockWorker = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:')) errors.push(m.text());
  });
  if (blockWorker) await page.route('**/worker.js', r => r.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => page.locator('#boot-stage').textContent(), { timeout: 45_000 }).toBe('Ready');
  return errors;
}

const enter = page => page.locator('#group-explicit-toggle .toggle-row').click();
const info = page => page.evaluate(() => {
  const i = window.__APP_STATE__.explicitInfo;
  return i && { M: i.M, N: i.N, rms: i.rms, pending: i.pending, fallback: i.fallback, reconSeq: i.reconSeq };
});
async function setN(page, n) {
  await page.locator('#zeta-n-slider').evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, n);
  await expect.poll(async () => { const i = await info(page); return i && i.N === n && !i.pending; },
    { timeout: 30_000 }).toBe(true);
  return (await info(page)).rms;
}

test.describe('explicit formula mode', () => {
  test('enters, renders without GL errors, and exit restores the lattice', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);
    await enter(page);
    await expect(page.locator('#sw-explicit')).toHaveClass(/on/);
    await expect.poll(async () => { const i = await info(page); return i && i.N != null && !i.pending; },
      { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      const g = s.scene.getObjectByName('explicit-group');
      const names = g ? g.children.map(c => c.name).sort() : [];
      const gl = s.renderer.getContext();
      return { pointsVisible: s.points.visible, names, glError: gl.getError(), M: s.explicitInfo.M };
    });
    expect(r.pointsVisible).toBe(false);
    expect(r.names).toEqual(['explicit-axis', 'explicit-boundary-ring', 'explicit-measured', 'explicit-ribbon', 'explicit-shell']);
    expect(r.glError).toBe(0);
    expect(r.M).toBe(1600);
    await expect(page.locator('#explicit-controls')).toContainText('誤差上限（RH を仮定した場合）');
    await expect(page.locator('#explicit-controls')).toContainText('asinh');

    await enter(page); // toggle off
    await expect(page.locator('#sw-explicit')).not.toHaveClass(/on/);
    const after = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      return { pointsVisible: s.points.visible, group: !!s.scene.getObjectByName('explicit-group'), info: s.explicitInfo };
    });
    expect(after).toEqual({ pointsVisible: true, group: false, info: null });
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('RMS(reconstruction, measured) decreases monotonically N=10 -> 100 -> 1000', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page);
    await enter(page);
    const rms = {};
    for (const n of [10, 100, 1000]) rms[n] = await setN(page, n);
    console.log('RMS psi1 (raw units):', JSON.stringify(rms));
    expect(rms[10]).toBeGreaterThan(rms[100]);
    expect(rms[100]).toBeGreaterThan(rms[1000]);
  });

  test('no shell vertex below x = 73.2; boundary ring sits at 73.2', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await enter(page);
    await expect.poll(async () => { const i = await info(page); return i && i.N != null; }, { timeout: 30_000 }).toBe(true);
    const r = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      const mesh = s.scene.getObjectByName('explicit-shell');
      const xs = s.explicitInfo.shellX;
      return {
        minX: Math.min(...xs), rings: xs.length, seg: s.explicitInfo.shell.segments,
        verts: mesh.geometry.attributes.position.count,
        measuredBelow: s.explicitInfo.samples, // samples incl. x<73.2 exist for measured curve
      };
    });
    expect(r.minX).toBeGreaterThanOrEqual(73.2);
    expect(r.minX).toBe(73.2);
    expect(r.verts).toBe(r.rings * r.seg); // every shell vertex belongs to a ring with x >= 73.2
    expect(r.measuredBelow).toBe(1600);
  });

  test('N change recomputes only the ribbon (measured/shell geometry untouched)', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await enter(page);
    await setN(page, 50);
    const grab = () => page.evaluate(() => {
      const s = window.__APP_STATE__, g = s.scene.getObjectByName('explicit-group');
      return g.children.map(c => [c.name, c.geometry.uuid]);
    });
    const a = await grab();
    await setN(page, 200);
    expect(await grab()).toEqual(a);
  });

  test('worker blocked: reduced samples fallback (M=400) is labelled and works', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page, { blockWorker: true });
    await enter(page);
    await expect(page.locator('#explicit-status')).toHaveText('(fallback mode: reduced samples)');
    const rms = {};
    for (const n of [10, 1000]) rms[n] = await setN(page, n);
    expect((await info(page)).M).toBe(400);
    expect(rms[10]).toBeGreaterThan(rms[1000]);
    // the pre-existing boot-time worker-init failure log is expected here
    expect(errors.filter(e => !e.startsWith('Worker init failed'))).toEqual([]);
  });
});
