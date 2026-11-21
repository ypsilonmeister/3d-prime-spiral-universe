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

  // ---- review #289 regressions -------------------------------------------

  // Records every worker instance and the message types posted to it.
  const spyWorkers = page => page.addInitScript(() => {
    const Orig = window.Worker;
    window.__workers = []; window.__posted = [];
    window.Worker = class extends Orig {
      constructor(...a) { super(...a); window.__workers.push(this); }
      postMessage(m, ...r) { window.__posted.push(m && m.type); return super.postMessage(m, ...r); }
    };
  });
  const zetaToggle = page => page.locator('#group-zeta-toggle .toggle-row').click();
  const sliderTo = (page, n) => page.locator('#zeta-n-slider').evaluate((el, v) => {
    el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true }));
  }, n);

  test('Zeta Wave ON then explicit mode: N change sends no zeta request; exit restores zeta settings', async ({ page }) => {
    test.setTimeout(120_000);
    await spyWorkers(page);
    await boot(page);
    await zetaToggle(page);
    await page.evaluate(() => { window.__APP_STATE__.zetaZeroCount = 7; });
    await enter(page);
    await expect.poll(async () => { const i = await info(page); return i && i.N != null && !i.pending; }, { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => { window.__posted.length = 0; });
    await setN(page, 200);
    await page.waitForTimeout(300);
    const posted = await page.evaluate(() => window.__posted.slice());
    expect(posted).toContain('explicit_recon');
    expect(posted).not.toContain('zeta');

    await enter(page); // exit
    const r = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      return { n: s.zetaZeroCount, zeta: s.zetaModeActive, slider: document.getElementById('zeta-n-slider').value };
    });
    expect(r).toEqual({ n: 7, zeta: true, slider: '7' });
  });

  test('explicit mode stops a running Zeta animation', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.locator('#zeta-anim-btn').evaluate(el => el.click());
    await enter(page);
    await expect.poll(() => page.evaluate(() => window.__APP_STATE__.zetaAnimating)).toBe(false);
    await expect(page.locator('#zeta-anim-btn')).toHaveText('Animate');
    await setN(page, 30);
    await page.waitForTimeout(800);
    expect((await info(page)).N).toBe(30);
    expect(await page.evaluate(() => window.__APP_STATE__.zetaZeroCount)).toBe(30);
  });

  test('worker blocked + Zeta ON: N=200 keeps display, state and ribbon N identical', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page, { blockWorker: true });
    await zetaToggle(page);
    await enter(page);
    await expect(page.locator('#explicit-status')).toHaveText('(fallback mode: reduced samples)');
    await setN(page, 200);
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({
      state: window.__APP_STATE__.zetaZeroCount,
      shown: document.getElementById('zeta-n-val').innerText,
      slider: document.getElementById('zeta-n-slider').value,
    }));
    expect((await info(page)).N).toBe(200);
    expect(r).toEqual({ state: 200, shown: '200', slider: '200' });
  });

  test('worker dies after startup: explicit mode falls back to M=400 instead of hanging', async ({ page }) => {
    test.setTimeout(120_000);
    await spyWorkers(page);
    await boot(page);
    await enter(page);
    await expect.poll(async () => { const i = await info(page); return i && i.N != null && !i.pending; }, { timeout: 30_000 }).toBe(true);
    // kill while a recompute is in flight, then fire the error event
    await page.evaluate(() => {
      const el = document.getElementById('zeta-n-slider');
      el.value = '500'; el.dispatchEvent(new Event('input', { bubbles: true }));
      window.__workers[0].dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    });
    await expect.poll(async () => { const i = await info(page); return i && i.fallback === true && i.M === 400 && !i.pending && i.N != null; },
      { timeout: 30_000 }).toBe(true);
    await expect(page.locator('#explicit-status')).toHaveText('(fallback mode: reduced samples)');
    const n = await page.evaluate(() => window.__APP_STATE__.scene.getObjectByName('explicit-group').children.length);
    expect(n).toBe(5);
    await setN(page, 50); // still interactive afterwards
  });
  // ---- review #291 regressions -------------------------------------------

  test('Zeta animation running at entry resumes after exit (and keeps advancing)', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await page.evaluate(() => { window.__APP_STATE__.zetaZeroCount = 40; });
    await page.locator('#zeta-anim-btn').evaluate(el => el.click());
    await expect.poll(() => page.evaluate(() => window.__APP_STATE__.zetaZeroCount), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await enter(page);
    await expect.poll(() => page.evaluate(() => window.__APP_STATE__.zetaAnimating)).toBe(false);
    await setN(page, 30);
    await enter(page); // exit
    const at = await page.evaluate(() => window.__APP_STATE__.zetaZeroCount);
    expect(at).toBeGreaterThanOrEqual(2);
    expect(at).toBeLessThan(40);
    expect(await page.evaluate(() => window.__APP_STATE__.zetaAnimating)).toBe(true);
    await expect(page.locator('#zeta-anim-btn')).toHaveText('Stop');
    await page.waitForTimeout(1500);
    const later = await page.evaluate(() => window.__APP_STATE__.zetaZeroCount);
    expect(later).toBeGreaterThan(at);
    // and it still runs to the original target and stops by itself
    await expect.poll(() => page.evaluate(() => window.__APP_STATE__.zetaAnimating), { timeout: 60_000 }).toBe(false);
    expect(await page.evaluate(() => window.__APP_STATE__.zetaZeroCount)).toBe(40);
  });

  test('Zeta animation stopped before entry stays stopped after exit', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await zetaToggle(page);
    await page.evaluate(() => { window.__APP_STATE__.zetaZeroCount = 7; });
    await enter(page);
    await expect.poll(async () => { const i = await info(page); return i && i.N != null && !i.pending; }, { timeout: 30_000 }).toBe(true);
    await enter(page);
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => ({ anim: window.__APP_STATE__.zetaAnimating, n: window.__APP_STATE__.zetaZeroCount }));
    expect(r).toEqual({ anim: false, n: 7 });
    await expect(page.locator('#zeta-anim-btn')).toHaveText('Animate');
  });

  test('exit with Zeta Wave ON sends exactly one zeta request', async ({ page }) => {
    test.setTimeout(120_000);
    await spyWorkers(page);
    await boot(page);
    await zetaToggle(page);
    await page.evaluate(() => { window.__APP_STATE__.zetaZeroCount = 7; });
    await enter(page);
    await expect.poll(async () => { const i = await info(page); return i && i.N != null && !i.pending; }, { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => { window.__posted.length = 0; });
    await enter(page);
    await page.waitForTimeout(500);
    const posted = await page.evaluate(() => window.__posted.slice());
    expect(posted.filter(t => t === 'zeta')).toEqual(['zeta']);
  });
  test('worker silently stops answering (no error event): request timeout recovers to M=400', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      const Orig = window.Worker;
      window.Worker = class extends Orig {
        postMessage(m, ...r) { if (window.__mute && m && /^explicit_/.test(m.type)) return; return super.postMessage(m, ...r); }
      };
    });
    await boot(page);
    await page.evaluate(() => { window.__mute = true; window.__APP_STATE__.explicitRequestTimeoutMs = 1500; });
    await enter(page);
    await expect.poll(async () => { const i = await info(page); return i && i.fallback === true && i.M === 400 && !i.pending && i.N != null; },
      { timeout: 30_000 }).toBe(true);
    await expect(page.locator('#explicit-status')).toHaveText('(fallback mode: reduced samples)');
    await setN(page, 50);
  });
  // ---- review #293 regressions -------------------------------------------

  test('slider change before entry does not overwrite the animation progress on resume', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await zetaToggle(page);
    await page.evaluate(async () => {
      const m = await import('/app/modes/zeta-anim.js');
      m.runZetaAnimation(1, 12);
      // slider moved and mode entered before the next animation tick
      const el = document.getElementById('zeta-n-slider');
      el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#group-explicit-toggle .toggle-row').click();
    });
    await expect.poll(async () => { const i = await info(page); return i && i.N != null && !i.pending; }, { timeout: 30_000 }).toBe(true);
    await enter(page); // exit
    const at = await page.evaluate(() => ({ n: window.__APP_STATE__.zetaZeroCount, anim: window.__APP_STATE__.zetaAnimating }));
    expect(at.anim).toBe(true);
    expect(at.n).toBeLessThan(12);
    await expect.poll(() => page.evaluate(() => window.__APP_STATE__.zetaAnimating), { timeout: 60_000 }).toBe(false);
    expect(await page.evaluate(() => window.__APP_STATE__.zetaZeroCount)).toBe(12);
  });

  test('N input and exit in the same frame send exactly one zeta request', async ({ page }) => {
    test.setTimeout(120_000);
    await spyWorkers(page);
    await boot(page);
    await zetaToggle(page);
    await page.evaluate(() => { window.__APP_STATE__.zetaZeroCount = 7; });
    await enter(page);
    await expect.poll(async () => { const i = await info(page); return i && i.N != null && !i.pending; }, { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => { window.__posted.length = 0; });
    await page.evaluate(() => {
      const el = document.getElementById('zeta-n-slider');
      el.value = '200'; el.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#group-explicit-toggle .toggle-row').click();
    });
    await page.waitForTimeout(600);
    const posted = await page.evaluate(() => window.__posted.slice());
    expect(posted.filter(t => t === 'zeta')).toEqual(['zeta']);
    expect(await page.evaluate(() => window.__APP_STATE__.zetaZeroCount)).toBe(7);
  });

  test('animation stops on the tick the fallback cap is reached', async ({ page }) => {
    test.setTimeout(120_000);
    await spyWorkers(page);
    await boot(page);
    await zetaToggle(page);
    await page.evaluate(async () => {
      const m = await import('/app/modes/zeta-anim.js');
      m.runZetaAnimation(99, 120);
      document.querySelector('#group-explicit-toggle .toggle-row').click();
    });
    await expect.poll(async () => { const i = await info(page); return i && i.N != null && !i.pending; }, { timeout: 30_000 }).toBe(true);
    // Worker dies while paused in explicit mode -> fallback cap (N=100) applies on resume.
    await page.evaluate(() => {
      const w = window.__workers[0];
      w.terminate();
      w.dispatchEvent(new ErrorEvent('error', { message: 'worker died while paused' }));
    });
    await expect.poll(async () => { const i = await info(page); return i && i.fallback === true && i.M === 400 && !i.pending && i.N != null; },
      { timeout: 30_000 }).toBe(true);
    // Record state immediately after each animation tick fires upon exiting explicit mode.
    await page.evaluate(() => {
      window.__ticks = [];
      const orig = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...a) => orig((...b) => {
        const wasAnim = window.__APP_STATE__.zetaAnimating;
        fn(...b);
        if (wasAnim) {
          window.__ticks.push({
            n: window.__APP_STATE__.zetaZeroCount,
            anim: window.__APP_STATE__.zetaAnimating,
            button: document.getElementById('zeta-anim-btn').textContent,
          });
        }
      }, ms, ...a);
    });
    await enter(page); // exit explicit mode -> resumes 99 -> 120 under fallback cap 100
    await expect.poll(() => page.evaluate(() => window.__ticks.length), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(300); // ensure no extra tick fires after reaching the cap
    const ticks = await page.evaluate(() => window.__ticks);
    expect(ticks).toEqual([{ n: 100, anim: false, button: 'Animate' }]);
    await expect(page.locator('#zeta-anim-btn')).toHaveText('Animate');
    expect(await page.evaluate(() => window.__APP_STATE__.zetaZeroCount)).toBe(100);
  });
});
