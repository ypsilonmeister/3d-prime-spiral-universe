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
    expect(r.names).toEqual(['explicit-axis', 'explicit-boundary-ring', 'explicit-measured', 'explicit-primes', 'explicit-ribbon', 'explicit-rungs', 'explicit-shell']);
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

  test('no shell vertex below x = 73.2; outline shell has upper/lower boundaries + spaced rings and boundary ring at 73.2', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await enter(page);
    await expect.poll(async () => { const i = await info(page); return i && i.N != null; }, { timeout: 30_000 }).toBe(true);
    const r = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      const shellObj = s.scene.getObjectByName('explicit-shell');
      const ringObj = s.scene.getObjectByName('explicit-boundary-ring');
      const xs = s.explicitInfo.shellX;
      return {
        isLineSegments: shellObj.isLineSegments === true,
        isMesh: shellObj.isMesh === true,
        ringIsLineLoop: ringObj.isLineLoop === true,
        ringVerts: ringObj.geometry.attributes.position.count,
        style: s.explicitInfo.shell.style,
        minX: Math.min(...xs),
        samples: s.explicitInfo.shell.samples,
        rings: s.explicitInfo.shell.rings,
        seg: s.explicitInfo.shell.segments,
        verts: shellObj.geometry.attributes.position.count,
        colorHex: shellObj.material.color.getHex(),
        measuredBelow: s.explicitInfo.samples, // samples incl. x<73.2 exist for measured curve
      };
    });
    expect(r.isLineSegments).toBe(true);
    expect(r.isMesh).toBe(false);
    expect(r.ringIsLineLoop).toBe(true);
    expect(r.ringVerts).toBe(r.seg);
    expect(r.style).toBe('outline');
    expect(r.colorHex).toBe(0x8866ff);
    expect(r.minX).toBeGreaterThanOrEqual(73.2);
    expect(r.minX).toBe(73.2);
    expect(r.rings).toBeGreaterThan(0);
    expect(r.rings).toBeLessThan(r.samples); // spaced rings, not a solid tube
    // Upper/lower boundary segments + spaced ring segments, all built strictly from x >= 73.2
    expect(r.verts).toBe(2 * (2 * (r.samples - 1) + r.rings * r.seg));
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
    expect(n).toBe(7);
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

  // ---- PR-C: kind switch, residual view (View B), numeric HUD, GPU leak check ----

  const waitExplicitReady = (page, predicate = () => true) =>
    expect.poll(async () => page.evaluate((predSrc) => {
      const i = window.__APP_STATE__.explicitInfo;
      if (!i || i.N == null || i.pending) return false;
      return new Function('i', `return (${predSrc})(i);`)(i);
    }, predicate.toString()), { timeout: 30_000 }).toBe(true);

  test('kind switch (psi1 <-> psi): shows Gibbs note for psi, applies design scaling, keeps RH-assumed wording', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);
    await enter(page);
    await waitExplicitReady(page, i => i.kind === 'psi1');

    // Default is psi1: Gibbs note hidden, s=0.02 documented
    await expect(page.locator('#explicit-kind-psi1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#explicit-kind-psi')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#explicit-gibbs-note')).toBeHidden();
    await expect(page.locator('#explicit-scale-note')).toContainText('0.02');
    await expect(page.locator('#explicit-controls')).toContainText('誤差上限（RH を仮定した場合）');
    await expect(page.locator('#explicit-controls')).not.toContainText('証明済み');

    const yRefPsi1 = await page.evaluate(async () => {
      const ef = await import('/shared/explicit-formula.js');
      const s = window.__APP_STATE__;
      const expected = ef.compressionRef(s.explicitInfo.hud.samples[1].bound, s.explicitInfo.xMax, 'psi1');
      return { got: s.explicitInfo.yRef, expected };
    });
    expect(Math.abs(yRefPsi1.got - yRefPsi1.expected)).toBeLessThan(1e-12);

    // Switch to psi: Gibbs note visible, s=0.25 scaling applied, shell still starts at 73.2
    await page.locator('#explicit-kind-psi').click();
    await waitExplicitReady(page, i => i.kind === 'psi');
    await expect(page.locator('#explicit-kind-psi')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#explicit-kind-psi1')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#explicit-gibbs-note')).toBeVisible();
    await expect(page.locator('#explicit-gibbs-note')).toContainText('Gibbs');
    await expect(page.locator('#explicit-gibbs-note')).toContainText('単調ではありません');
    await expect(page.locator('#explicit-scale-note')).toContainText('0.25');
    await expect(page.locator('#explicit-controls')).toContainText('誤差上限（RH を仮定した場合）');

    const psiCheck = await page.evaluate(async () => {
      const ef = await import('/shared/explicit-formula.js');
      const s = window.__APP_STATE__;
      const expectedYRef = ef.compressionRef(s.explicitInfo.hud.samples[1].bound, s.explicitInfo.xMax, 'psi');
      const gl = s.renderer.getContext();
      return {
        gotYRef: s.explicitInfo.yRef,
        expectedYRef,
        minShellX: Math.min(...s.explicitInfo.shellX),
        glError: gl.getError(),
      };
    });
    expect(Math.abs(psiCheck.gotYRef - psiCheck.expectedYRef)).toBeLessThan(1e-12);
    expect(psiCheck.minShellX).toBe(73.2);
    expect(psiCheck.glError).toBe(0);

    // Switch back to psi1: Gibbs note hidden again
    await page.locator('#explicit-kind-psi1').click();
    await waitExplicitReady(page, i => i.kind === 'psi1');
    await expect(page.locator('#explicit-gibbs-note')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('residual view (View B): auto-hides shell, restores on View A, and caches measured/shell across N changes', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);
    await enter(page);
    await waitExplicitReady(page, i => i.kind === 'psi1' && i.view === 'a');

    const snapshot = () => page.evaluate(() => {
      const g = window.__APP_STATE__.scene.getObjectByName('explicit-group');
      const byName = Object.fromEntries(g.children.map(c => [c.name, { visible: c.visible, uuid: c.geometry.uuid }]));
      const ribPos = g.getObjectByName('explicit-ribbon').geometry.attributes.position.array;
      return {
        byName,
        shellVisibleInfo: window.__APP_STATE__.explicitInfo.shellVisible,
        ribbonHead: Array.from(ribPos.slice(0, 12)),
        ribbonTail: Array.from(ribPos.slice(-12)),
      };
    });

    const viewA1 = await snapshot();
    expect(viewA1.byName['explicit-shell'].visible).toBe(true);
    expect(viewA1.byName['explicit-boundary-ring'].visible).toBe(true);
    expect(viewA1.byName['explicit-measured'].visible).toBe(true);
    expect(viewA1.byName['explicit-rungs'].visible).toBe(true);
    expect(viewA1.byName['explicit-ribbon'].visible).toBe(true);
    expect(viewA1.shellVisibleInfo).toBe(true);

    // Switch to View B (residual only): shell, boundary ring, rungs, and measured curve hide automatically
    await page.locator('#explicit-view-b').click();
    await expect(page.locator('#explicit-view-b')).toHaveAttribute('aria-pressed', 'true');
    const viewB1 = await snapshot();
    expect(viewB1.byName['explicit-shell'].visible).toBe(false);
    expect(viewB1.byName['explicit-boundary-ring'].visible).toBe(false);
    expect(viewB1.byName['explicit-measured'].visible).toBe(false);
    expect(viewB1.byName['explicit-rungs'].visible).toBe(false);
    expect(viewB1.byName['explicit-axis'].visible).toBe(true);
    expect(viewB1.byName['explicit-ribbon'].visible).toBe(true);
    expect(viewB1.shellVisibleInfo).toBe(false);
    // Ribbon geometry updated in-place to plot residual (different positions from View A reconstruction)
    expect(viewB1.ribbonTail).not.toEqual(viewA1.ribbonTail);
    for (const name of Object.keys(viewA1.byName)) {
      expect(viewB1.byName[name].uuid).toBe(viewA1.byName[name].uuid);
    }

    // Changing N in View B recomputes only reconstruction/residual; measured & shell stay cached and hidden
    await setN(page, 300);
    const viewB2 = await snapshot();
    expect(viewB2.byName['explicit-shell'].visible).toBe(false);
    expect(viewB2.byName['explicit-boundary-ring'].visible).toBe(false);
    expect(viewB2.byName['explicit-measured'].visible).toBe(false);
    expect(viewB2.byName['explicit-rungs'].visible).toBe(false);
    expect(viewB2.ribbonTail).not.toEqual(viewB1.ribbonTail);
    for (const name of Object.keys(viewA1.byName)) {
      expect(viewB2.byName[name].uuid).toBe(viewA1.byName[name].uuid);
    }

    // Returning to View A restores shell, boundary ring, rungs, and measured curve from cache
    await page.locator('#explicit-view-a').click();
    await expect(page.locator('#explicit-view-a')).toHaveAttribute('aria-pressed', 'true');
    const viewA2 = await snapshot();
    expect(viewA2.byName['explicit-shell'].visible).toBe(true);
    expect(viewA2.byName['explicit-boundary-ring'].visible).toBe(true);
    expect(viewA2.byName['explicit-measured'].visible).toBe(true);
    expect(viewA2.byName['explicit-rungs'].visible).toBe(true);
    expect(viewA2.shellVisibleInfo).toBe(true);
    for (const name of Object.keys(viewA1.byName)) {
      expect(viewA2.byName[name].uuid).toBe(viewA1.byName[name].uuid);
    }
    expect(errors).toEqual([]);
  });

  test('numeric HUD displays representative x values matching shared pure functions across kind / N / view', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);
    await enter(page);
    await waitExplicitReady(page, i => i.kind === 'psi1' && i.N === 100);

    const checkHudMatchesShared = async (expectedKind, expectedN, expectedView) => {
      const res = await page.evaluate(async ({ expectedKind, expectedN, expectedView }) => {
        const ef = await import('/shared/explicit-formula.js');
        const { buildSieve } = await import('/shared/sieve.js');
        const { ZETA_ZEROS_1000 } = await import('/shared/zeta-zeros-1000.js');
        const s = window.__APP_STATE__;
        const info = s.explicitInfo;
        const tables = ef.buildPsiTables(info.xMax, buildSieve(info.xMax).spf);
        const base = ef.computeExplicitBase(info.xMax, info.M, tables, expectedKind);
        const recon = ef.computeExplicitRecon(base.xs, expectedN, ZETA_ZEROS_1000, expectedKind);
        const residual = ef.computeExplicitResidual(base.meas, recon);
        const expectedHud = ef.computeExplicitHud(base.xs, base.meas, recon, base.bound, residual);

        const hudEl = document.getElementById('explicit-hud');
        const sampleEls = Array.from(hudEl.querySelectorAll('.explicit-hud-sample'));
        const domRaws = sampleEls.map(el => ({
          label: el.getAttribute('data-sample'),
          raws: Array.from(el.querySelectorAll('.explicit-hud-val')).map(v => Number(v.getAttribute('data-raw'))),
        }));
        return {
          kind: info.kind,
          N: info.N,
          view: info.view,
          text: hudEl.textContent,
          gotHud: info.hud,
          expectedHud,
          domRaws,
        };
      }, { expectedKind, expectedN, expectedView });

      expect(res.kind).toBe(expectedKind);
      expect(res.N).toBe(expectedN);
      expect(res.view).toBe(expectedView);
      expect(res.text).toContain(`N=${expectedN}`);
      expect(res.gotHud.samples).toHaveLength(2);
      expect(Math.abs(res.gotHud.rms - res.expectedHud.rms)).toBeLessThan(1e-9);
      for (let i = 0; i < 2; i++) {
        const g = res.gotHud.samples[i], e = res.expectedHud.samples[i];
        expect(g.label).toBe(e.label);
        expect(g.x).toBe(e.x);
        expect(Math.abs(g.measured - e.measured)).toBeLessThan(1e-9);
        expect(Math.abs(g.recon - e.recon)).toBeLessThan(1e-9);
        expect(Math.abs(g.residual - e.residual)).toBeLessThan(1e-9);
        expect(Math.abs(g.bound - e.bound)).toBeLessThan(1e-9);
        // DOM data-raw values match the exact shared-function values (order reflects View A vs View B)
        const expectedDomOrder = expectedView === 'b'
          ? [e.residual, e.measured, e.recon, e.bound]
          : [e.measured, e.recon, e.residual, e.bound];
        expect(res.domRaws[i].label).toBe(e.label);
        for (let j = 0; j < 4; j++) {
          expect(Math.abs(res.domRaws[i].raws[j] - expectedDomOrder[j])).toBeLessThan(1e-9);
        }
      }
    };

    await checkHudMatchesShared('psi1', 100, 'a');
    await setN(page, 250);
    await checkHudMatchesShared('psi1', 250, 'a');

    await page.locator('#explicit-view-b').click();
    await checkHudMatchesShared('psi1', 250, 'b');
    await expect(page.locator('#explicit-hud')).toContainText('ビュー B');

    await page.locator('#explicit-kind-psi').click();
    await waitExplicitReady(page, i => i.kind === 'psi' && i.N === 250);
    await checkHudMatchesShared('psi', 250, 'b');
    await expect(page.locator('#explicit-hud')).toContainText('B(x)');
    expect(errors).toEqual([]);
  });

  test('GPU resource leak check: repeated enter/exit, kind/view switches, and aborted enter do not leak WebGL resources', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await boot(page);

    const waitFrames = (n = 3) => page.evaluate((count) => new Promise(resolve => {
      let left = count;
      const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }), n);

    const measureGpu = () => page.evaluate(() => {
      const s = window.__APP_STATE__;
      let sceneObjects = 0;
      const materials = new Set();
      s.scene.traverse(o => {
        sceneObjects++;
        if (o.material) {
          for (const m of (Array.isArray(o.material) ? o.material : [o.material])) materials.add(m.uuid);
        }
      });
      const mem = s.renderer.info.memory;
      return {
        geometries: mem.geometries,
        textures: mem.textures,
        programs: s.renderer.info.programs ? s.renderer.info.programs.length : 0,
        sceneObjects,
        materialCount: materials.size,
        hasExplicitGroup: !!s.scene.getObjectByName('explicit-group'),
        glError: s.renderer.getContext().getError(),
      };
    });

    await waitFrames(4);
    const baseline = await measureGpu();
    expect(baseline.hasExplicitGroup).toBe(false);
    expect(baseline.glError).toBe(0);

    const activeStats = [];
    const exitStats = [];

    for (let cycle = 0; cycle < 5; cycle++) {
      await enter(page);
      await waitExplicitReady(page, i => i.N != null);
      // Exercise kind switch, view switch, and N change inside the mode
      if (cycle % 2 === 0) {
        await page.locator('#explicit-kind-psi').click();
        await waitExplicitReady(page, i => i.kind === 'psi');
        await page.locator('#explicit-view-b').click();
        await waitFrames(2);
        await page.locator('#explicit-view-a').click();
        await page.locator('#explicit-kind-psi1').click();
        await waitExplicitReady(page, i => i.kind === 'psi1');
      } else {
        await setN(page, 50 + cycle * 20);
        await page.locator('#explicit-primes-toggle').click();
        await page.locator('#explicit-view-b').click();
        await waitFrames(2);
        await page.locator('#explicit-primes-toggle').click();
        await page.locator('#explicit-view-a').click();
      }
      await waitFrames(3);
      activeStats.push(await measureGpu());

      await enter(page); // exit
      await waitFrames(3);
      exitStats.push(await measureGpu());
    }

    // Rapid enter + immediate exit (aborting in-flight worker rebuild) must also leave zero leaks.
    await page.evaluate(() => {
      const row = document.querySelector('#group-explicit-toggle .toggle-row');
      row.click();
      row.click();
    });
    await waitFrames(4);
    const afterRapid = await measureGpu();

    console.log('GPU leak check baseline:', JSON.stringify(baseline));
    console.log('GPU leak check activeStats:', JSON.stringify(activeStats));
    console.log('GPU leak check exitStats:', JSON.stringify(exitStats));
    console.log('GPU leak check afterRapid:', JSON.stringify(afterRapid));

    for (const st of exitStats) {
      expect(st.geometries).toBe(baseline.geometries);
      expect(st.textures).toBe(baseline.textures);
      expect(st.sceneObjects).toBe(baseline.sceneObjects);
      expect(st.materialCount).toBe(baseline.materialCount);
      expect(st.hasExplicitGroup).toBe(false);
      expect(st.glError).toBe(0);
    }
    expect(afterRapid.geometries).toBe(baseline.geometries);
    expect(afterRapid.textures).toBe(baseline.textures);
    expect(afterRapid.sceneObjects).toBe(baseline.sceneObjects);
    expect(afterRapid.materialCount).toBe(baseline.materialCount);
    expect(afterRapid.hasExplicitGroup).toBe(false);
    expect(afterRapid.glError).toBe(0);

    // Active resource counts must stay bounded/constant across all 5 cycles (no monotonic growth).
    for (const st of activeStats) {
      expect(st.geometries).toBe(activeStats[0].geometries);
      expect(st.textures).toBe(baseline.textures);
      expect(st.sceneObjects).toBe(activeStats[0].sceneObjects);
      expect(st.materialCount).toBe(activeStats[0].materialCount);
      expect(st.glError).toBe(0);
    }
    expect(activeStats[activeStats.length - 1].programs).toBeLessThanOrEqual(activeStats[0].programs);
    expect(errors).toEqual([]);
  });

  // ---- PR-C follow-up: prime markers on reference axis C(u) ---------------

  test('prime markers: count matches app prime table (pi(320000)), positions sit on axis C(u), toggle works, and exit disposes resources', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);

    const baselineGeoms = await page.evaluate(() => window.__APP_STATE__.renderer.info.memory.geometries);
    await enter(page);
    await waitExplicitReady(page, i => i.N != null);

    // Legend includes prime entry and toggle defaults to visible (on)
    await expect(page.locator('#explicit-legend')).toContainText('素数');
    await expect(page.locator('#sw-explicit-primes')).toHaveClass(/on/);
    await expect(page.locator('#sw-explicit-primes')).toHaveAttribute('aria-checked', 'true');
    // RH-assumed wording remains intact
    await expect(page.locator('#explicit-controls')).toContainText('誤差上限（RH を仮定した場合）');

    const check = await page.evaluate(async () => {
      const { explicitAxisPoint } = await import('/app/modes/explicit.js');
      const s = window.__APP_STATE__;
      const g = s.scene.getObjectByName('explicit-group');
      const primesObj = g.getObjectByName('explicit-primes');
      const axisObj = g.getObjectByName('explicit-axis');
      const pos = primesObj.geometry.attributes.position;
      const axisPos = axisObj.geometry.attributes.position;
      const xMax = s.explicitInfo.xMax;
      const isPrime = s.isPrimeArray;

      // Count primes directly from the app's existing prime table and record indices of representative primes.
      const targets = [2, 3, 5, 73, 7919, 104729, 319993];
      const targetSet = new Set(targets);
      const indexByPrime = {};
      let expectedCount = 0;
      for (let p = 2; p <= xMax; p++) {
        if (isPrime[p]) {
          if (targetSet.has(p)) indexByPrime[p] = expectedCount;
          expectedCount++;
        }
      }

      const samples = targets.map(p => {
        const idx = indexByPrime[p];
        const vx = pos.getX(idx), vy = pos.getY(idx), vz = pos.getZ(idx);
        const exp = explicitAxisPoint(p, xMax);
        const dist = Math.hypot(vx - exp.x, vy - exp.y, vz - exp.z);
        const radialErr = Math.abs(Math.hypot(vx, vz) - exp.r);
        const heightErr = Math.abs(vy - exp.h);
        return { p, idx, dist, radialErr, heightErr };
      });

      // Prime p = 2 sits at u = 0, matching vertex 0 of explicit-axis (xs[0] = 2).
      const p2AxisDist = Math.hypot(
        pos.getX(0) - axisPos.getX(0),
        pos.getY(0) - axisPos.getY(0),
        pos.getZ(0) - axisPos.getZ(0),
      );

      const c = primesObj.material.color;
      return {
        isPoints: primesObj.isPoints === true,
        visible: primesObj.visible,
        geomUuid: primesObj.geometry.uuid,
        vertexCount: pos.count,
        expectedCount,
        infoCount: s.explicitInfo.primeCount,
        infoVisible: s.explicitInfo.primesVisible,
        samples,
        p2AxisDist,
        color: { r: c.r, g: c.g, b: c.b },
      };
    });

    expect(check.isPoints).toBe(true);
    expect(check.visible).toBe(true);
    expect(check.infoVisible).toBe(true);
    expect(check.expectedCount).toBe(27608); // pi(320000)
    expect(check.vertexCount).toBe(check.expectedCount);
    expect(check.infoCount).toBe(check.expectedCount);
    expect(check.p2AxisDist).toBeLessThan(1e-4);
    // White-ish marker colour (distinct from cyan / amber / magenta / violet)
    expect(check.color.r).toBeGreaterThan(0.9);
    expect(check.color.g).toBeGreaterThan(0.9);
    expect(check.color.b).toBeGreaterThan(0.9);
    for (const s of check.samples) {
      expect(s.idx).toBeGreaterThanOrEqual(0);
      expect(s.dist, `prime ${s.p} distance to C(u)`).toBeLessThan(1e-2);
      expect(s.radialErr, `prime ${s.p} radial error`).toBeLessThan(1e-2);
      expect(s.heightErr, `prime ${s.p} height error`).toBeLessThan(1e-2);
    }

    // Toggle off: hides explicit-primes without rebuilding geometry
    await page.locator('#explicit-primes-toggle').click();
    await expect(page.locator('#sw-explicit-primes')).not.toHaveClass(/on/);
    await expect(page.locator('#sw-explicit-primes')).toHaveAttribute('aria-checked', 'false');
    const hidden = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      const p = s.scene.getObjectByName('explicit-primes');
      return {
        visible: p.visible,
        stateFlag: s.explicitShowPrimes,
        infoVisible: s.explicitInfo.primesVisible,
        geomUuid: p.geometry.uuid,
      };
    });
    expect(hidden).toEqual({ visible: false, stateFlag: false, infoVisible: false, geomUuid: check.geomUuid });

    // Toggle back on (also confirm View B keeps prime markers toggleable)
    await page.locator('#explicit-view-b').click();
    await page.locator('#explicit-primes-toggle').click();
    await expect(page.locator('#sw-explicit-primes')).toHaveClass(/on/);
    await expect(page.locator('#sw-explicit-primes')).toHaveAttribute('aria-checked', 'true');
    const shown = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      const p = s.scene.getObjectByName('explicit-primes');
      return {
        visible: p.visible,
        stateFlag: s.explicitShowPrimes,
        infoVisible: s.explicitInfo.primesVisible,
        geomUuid: p.geometry.uuid,
      };
    });
    expect(shown).toEqual({ visible: true, stateFlag: true, infoVisible: true, geomUuid: check.geomUuid });

    // Spy on geometry/material dispose before exiting
    await page.evaluate(() => {
      const p = window.__APP_STATE__.scene.getObjectByName('explicit-primes');
      window.__primeDisposed = { geom: 0, mat: 0 };
      const origG = p.geometry.dispose.bind(p.geometry);
      const origM = p.material.dispose.bind(p.material);
      p.geometry.dispose = () => { window.__primeDisposed.geom++; return origG(); };
      p.material.dispose = () => { window.__primeDisposed.mat++; return origM(); };
    });

    await enter(page); // exit explicit mode
    const afterExit = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      return {
        disposed: window.__primeDisposed,
        hasPrimes: !!s.scene.getObjectByName('explicit-primes'),
        geoms: s.renderer.info.memory.geometries,
      };
    });
    expect(afterExit.disposed).toEqual({ geom: 1, mat: 1 });
    expect(afterExit.hasPrimes).toBe(false);
    expect(afterExit.geoms).toBe(baselineGeoms);
    expect(errors).toEqual([]);
  });

  test('prime markers in fallback mode (M=400) still render all pi(320000) primes independently of sample count', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page, { blockWorker: true });
    await enter(page);
    await waitExplicitReady(page, i => i.fallback === true && i.M === 400);

    const r = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      const p = s.scene.getObjectByName('explicit-primes');
      let expected = 0;
      for (let n = 2; n <= s.explicitInfo.xMax; n++) if (s.isPrimeArray[n]) expected++;
      return {
        M: s.explicitInfo.M,
        visible: p.visible,
        vertexCount: p.geometry.attributes.position.count,
        expected,
      };
    });
    expect(r.M).toBe(400);
    expect(r.visible).toBe(true);
    expect(r.expected).toBe(27608);
    expect(r.vertexCount).toBe(r.expected);
    expect(errors.filter(e => !e.startsWith('Worker init failed'))).toEqual([]);
  });

  // ---- review #305 regressions -------------------------------------------

  test('View A -> View B recomputes ribbon boundingSphere so close-up frustum does not cull farthest vertex', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);
    await enter(page);
    await waitExplicitReady(page, i => i.kind === 'psi1' && i.N === 100 && i.view === 'a');
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const checkCloseUp = () => page.evaluate(async () => {
      const THREE = await import('three');
      const s = window.__APP_STATE__;
      const ribbon = s.scene.getObjectByName('explicit-ribbon');
      const bs = ribbon.geometry.boundingSphere;
      const pos = ribbon.geometry.attributes.position;
      let maxDist = -1;
      const far = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const d = v.distanceTo(bs.center);
        if (d > maxDist) { maxDist = d; far.copy(v); }
      }
      const cam = s.camera.clone();
      const dirToCenter = bs.center.clone().sub(far).normalize();
      cam.position.copy(far).addScaledVector(dirToCenter, 5);
      cam.lookAt(far);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
      );
      const intersects = frustum.intersectsObject(ribbon);

      let renderCalls = 0;
      const prevOnBeforeRender = ribbon.onBeforeRender;
      ribbon.onBeforeRender = function (...args) {
        renderCalls++;
        return prevOnBeforeRender.apply(this, args);
      };
      try {
        s.renderer.render(s.scene, cam);
      } finally {
        ribbon.onBeforeRender = prevOnBeforeRender;
      }

      return {
        hasSphere: !!bs,
        radius: bs.radius,
        maxDist,
        intersects,
        renderCalls,
        glError: s.renderer.getContext().getError(),
      };
    });

    await page.locator('#explicit-view-b').click();
    await expect(page.locator('#explicit-view-b')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const afterB = await checkCloseUp();
    expect(afterB.hasSphere).toBe(true);
    expect(afterB.radius).toBeGreaterThanOrEqual(afterB.maxDist - 1e-3);
    expect(afterB.intersects).toBe(true);
    expect(afterB.renderCalls).toBe(1);
    expect(afterB.glError).toBe(0);

    // Changing N in View B also updates vertices in-place and must keep boundingSphere valid
    await setN(page, 10);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const afterN = await checkCloseUp();
    expect(afterN.radius).toBeGreaterThanOrEqual(afterN.maxDist - 1e-3);
    expect(afterN.intersects).toBe(true);
    expect(afterN.renderCalls).toBe(1);
    expect(afterN.glError).toBe(0);
    expect(errors).toEqual([]);
  });

  test('HUD displayed x matches shared functions at display precision across psi jump discontinuity (count=27,300)', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);
    await enter(page);
    await waitExplicitReady(page, i => i.kind === 'psi1' && i.N === 100);

    await page.locator('#explicit-kind-psi').click();
    await waitExplicitReady(page, i => i.kind === 'psi' && i.N === 100);

    await page.locator('#count-slider').evaluate(el => {
      el.value = '27300';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitExplicitReady(page, i => i.kind === 'psi' && i.N === 100 && i.xMax === 27300);

    const check = await page.evaluate(async () => {
      const ef = await import('/shared/explicit-formula.js');
      const { buildSieve } = await import('/shared/sieve.js');
      const { ZETA_ZEROS_1000 } = await import('/shared/zeta-zeros-1000.js');
      const formatHudNumber = v => {
        if (!Number.isFinite(v)) return '—';
        const abs = Math.abs(v);
        if (abs >= 1e6 || (abs > 0 && abs < 1e-2)) return v.toExponential(3);
        return v.toFixed(2);
      };
      const tables = ef.buildPsiTables(27300, buildSieve(27300).spf);
      const hudEl = document.getElementById('explicit-hud');
      const samples = Array.from(hudEl.querySelectorAll('.explicit-hud-sample')).map(el => {
        const label = el.getAttribute('data-sample');
        const xLine = el.querySelector('.explicit-hud-x').textContent;
        const m = xLine.match(/x\s*([=≈])\s*([0-9,]+(?:\.[0-9]+)?)/);
        const op = m ? m[1] : null;
        const xDisp = m ? Number(m[2].replace(/,/g, '')) : NaN;
        const displayedVals = Array.from(el.querySelectorAll('.explicit-hud-val')).map(v => v.textContent);
        const base = ef.computeExplicitBaseForSamples([xDisp], tables, 'psi');
        const recon = ef.computeExplicitRecon([xDisp], 100, ZETA_ZEROS_1000, 'psi');
        const residual = ef.computeExplicitResidual(base.meas, recon);
        const expectedVals = [
          formatHudNumber(base.meas[0]),
          formatHudNumber(recon[0]),
          formatHudNumber(residual[0]),
          formatHudNumber(base.bound[0]),
        ];
        return { label, xLine, op, xDisp, displayedVals, expectedVals };
      });
      return {
        internalMidX: window.__APP_STATE__.explicitInfo.hud.samples[0].x,
        samples,
      };
    });

    const mid = check.samples.find(s => s.label === 'mid');
    const max = check.samples.find(s => s.label === 'max');
    expect(mid.op).toBe('=');
    expect(Math.floor(mid.xDisp)).toBe(232);
    expect(mid.xDisp).toBe(check.internalMidX);
    expect(mid.displayedVals).toEqual(mid.expectedVals);

    expect(max.op).toBe('=');
    expect(max.xDisp).toBe(27300);
    expect(max.displayedVals).toEqual(max.expectedVals);
    expect(errors).toEqual([]);
  });

  test('prime markers switch exposes accessible name via aria-labelledby and toggles via keyboard', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);
    await enter(page);
    await waitExplicitReady(page, i => i.N != null);

    const sw = page.getByRole('switch', { name: '素数マーカー' });
    await expect(sw).toHaveCount(1);
    await expect(sw).toBeVisible();
    await expect(sw).toHaveAttribute('id', 'sw-explicit-primes');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(sw).toMatchAriaSnapshot('- switch "素数マーカー" [checked]');

    await sw.focus();
    await page.keyboard.press('Space');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(sw).toMatchAriaSnapshot('- switch "素数マーカー"');

    await page.keyboard.press('Enter');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(sw).toMatchAriaSnapshot('- switch "素数マーカー" [checked]');
    expect(errors).toEqual([]);
  });

  // ---- review #309 regressions -------------------------------------------

  test('HUD displayed x round-trips to reproduce all numeric rows at display precision (psi 126,700 / 140,000 and psi1 16,400 / 85,600)', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);
    await enter(page);
    await waitExplicitReady(page, i => i.kind === 'psi1' && i.N === 100 && i.view === 'a');

    const cases = [
      { kind: 'psi',  count: 126700, expectedMidMeas: '9.564e-4' },
      { kind: 'psi',  count: 140000, expectedMidMeas: '6.100e-3' },
      { kind: 'psi1', count: 16400,  expectedMidRes: '-6.944e-3' },
      { kind: 'psi1', count: 85600,  expectedMidBound: '6381.15' },
    ];

    for (const tc of cases) {
      const btnId = tc.kind === 'psi' ? '#explicit-kind-psi' : '#explicit-kind-psi1';
      await page.locator(btnId).click();
      await page.locator('#count-slider').evaluate((el, val) => {
        el.value = String(val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, tc.count);
      await expect.poll(async () => page.evaluate(({ kind, count }) => {
        const i = window.__APP_STATE__.explicitInfo;
        return !!(i && i.N === 100 && !i.pending && i.kind === kind && i.xMax === count);
      }, { kind: tc.kind, count: tc.count }), { timeout: 30_000 }).toBe(true);

      const check = await page.evaluate(async ({ kind, count }) => {
        const ef = await import('/shared/explicit-formula.js');
        const { buildSieve } = await import('/shared/sieve.js');
        const { ZETA_ZEROS_1000 } = await import('/shared/zeta-zeros-1000.js');
        const { formatHudNumber } = await import('/app/modes/explicit.js');
        const tables = ef.buildPsiTables(count, buildSieve(count).spf);
        const hudEl = document.getElementById('explicit-hud');
        const infoSamples = window.__APP_STATE__.explicitInfo.hud.samples;
        const samples = Array.from(hudEl.querySelectorAll('.explicit-hud-sample')).map((el, idx) => {
          const label = el.getAttribute('data-sample');
          const xLine = el.querySelector('.explicit-hud-x').textContent;
          const m = xLine.match(/x\s*([=≈])\s*([0-9,]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?)/i);
          const op = m ? m[1] : null;
          const xDisp = m ? Number(m[2].replace(/,/g, '')) : NaN;
          const displayedVals = Array.from(el.querySelectorAll('.explicit-hud-val')).map(v => v.textContent);
          const base = ef.computeExplicitBaseForSamples([xDisp], tables, kind);
          const recon = ef.computeExplicitRecon([xDisp], 100, ZETA_ZEROS_1000, kind);
          const residual = ef.computeExplicitResidual(base.meas, recon);
          const expectedVals = [
            formatHudNumber(base.meas[0]),
            formatHudNumber(recon[0]),
            formatHudNumber(residual[0]),
            Number.isFinite(base.bound[0]) ? formatHudNumber(base.bound[0]) : '— (x < 73.2)',
          ];
          return {
            label,
            xLine,
            op,
            xDisp,
            internalX: infoSamples[idx].x,
            displayedVals,
            expectedVals,
          };
        });
        return samples;
      }, { kind: tc.kind, count: tc.count });

      const mid = check.find(s => s.label === 'mid');
      const max = check.find(s => s.label === 'max');
      expect(mid.displayedVals, `${tc.kind} count=${tc.count} mid HUD rows`).toEqual(mid.expectedVals);
      expect(mid.op, `${tc.kind} count=${tc.count} mid op`).toBe('=');
      expect(mid.xDisp, `${tc.kind} count=${tc.count} mid x round-trip`).toBe(mid.internalX);
      if (tc.expectedMidMeas) expect(mid.displayedVals[0]).toBe(tc.expectedMidMeas);
      if (tc.expectedMidRes) expect(mid.displayedVals[2]).toBe(tc.expectedMidRes);
      if (tc.expectedMidBound) expect(mid.displayedVals[3]).toBe(tc.expectedMidBound);

      expect(max.op).toBe('=');
      expect(max.xDisp).toBe(tc.count);
      expect(max.displayedVals).toEqual(max.expectedVals);
    }
    expect(errors).toEqual([]);
  });

  test('formatHudX round-trips across full count sweep (100..320,000 step 100) for both psi and psi1 (M=1600 & M=400)', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await boot(page);

    const result = await page.evaluate(async () => {
      const ef = await import('/shared/explicit-formula.js');
      const { buildSieve } = await import('/shared/sieve.js');
      const { ZETA_ZEROS_1000: ZEROS } = await import('/shared/zeta-zeros-1000.js');
      const { formatHudX, formatHudNumber } = await import('/app/modes/explicit.js');

      const MAX = 320000;
      const tables = ef.buildPsiTables(MAX, buildSieve(MAX).spf);
      const denom = ef.buildZetaDenom(ZEROS);

      const fmtRow = (meas, recon, res, bound) => [
        formatHudNumber(meas),
        formatHudNumber(recon),
        formatHudNumber(res),
        Number.isFinite(bound) ? formatHudNumber(bound) : '— (x < 73.2)',
      ];

      const mismatches = [];
      let checked = 0;

      // Full review #309 sweep: all 3,200 slider counts x both kinds x both M=1600 and M=400 at N=100
      for (const kind of ['psi', 'psi1']) {
        for (const M of [1600, 400]) {
          const midIdx = Math.floor((M - 1) / 2);
          for (let count = 100; count <= MAX; count += 100) {
            const xs = ef.logSpacedSamples(2, count, M);
            const x = xs[midIdx];
            const fx = formatHudX(x);
            const xDisp = Number(fx.text.replace(/,/g, ''));

            const b1 = ef.computeExplicitBaseForSamples([x], tables, kind);
            const r1 = ef.computeExplicitRecon([x], 100, ZEROS, kind, denom);
            const res1 = ef.computeExplicitResidual(b1.meas, r1);
            const disp1 = fmtRow(b1.meas[0], r1[0], res1[0], b1.bound[0]);

            const b2 = ef.computeExplicitBaseForSamples([xDisp], tables, kind);
            const r2 = ef.computeExplicitRecon([xDisp], 100, ZEROS, kind, denom);
            const res2 = ef.computeExplicitResidual(b2.meas, r2);
            const disp2 = fmtRow(b2.meas[0], r2[0], res2[0], b2.bound[0]);

            checked++;
            if (xDisp !== x || fx.op !== '=' || disp1.join('|') !== disp2.join('|')) {
              mismatches.push({ kind, M, N: 100, count, x, fx, xDisp, disp1, disp2 });
            }
          }
        }
      }

      // Additional N sweep across representative counts (including jump & boundary cases)
      const repCounts = [100, 27300, 71800, 85600, 126700, 140000, 246100, 320000];
      for (const kind of ['psi', 'psi1']) {
        for (const N of [10, 30, 300, 1000]) {
          for (const count of repCounts) {
            const xs = ef.logSpacedSamples(2, count, 1600);
            for (const idx of [Math.floor((1600 - 1) / 2), 1599]) {
              const x = xs[idx];
              const fx = formatHudX(x);
              const xDisp = Number(fx.text.replace(/,/g, ''));
              const b1 = ef.computeExplicitBaseForSamples([x], tables, kind);
              const r1 = ef.computeExplicitRecon([x], N, ZEROS, kind, denom);
              const res1 = ef.computeExplicitResidual(b1.meas, r1);
              const disp1 = fmtRow(b1.meas[0], r1[0], res1[0], b1.bound[0]);

              const b2 = ef.computeExplicitBaseForSamples([xDisp], tables, kind);
              const r2 = ef.computeExplicitRecon([xDisp], N, ZEROS, kind, denom);
              const res2 = ef.computeExplicitResidual(b2.meas, r2);
              const disp2 = fmtRow(b2.meas[0], r2[0], res2[0], b2.bound[0]);

              checked++;
              if (xDisp !== x || fx.op !== '=' || disp1.join('|') !== disp2.join('|')) {
                mismatches.push({ kind, M: 1600, N, count, x, fx, xDisp, disp1, disp2 });
              }
            }
          }
        }
      }

      const valueMismatches = mismatches.filter(m => m.disp1.join('|') !== m.disp2.join('|'));
      return {
        checked,
        mismatchCount: mismatches.length,
        valueMismatchCount: valueMismatches.length,
        valueSample: valueMismatches.slice(0, 5),
        sample: mismatches.slice(0, 5),
      };
    });

    expect(result.checked).toBe(12800 + 128);
    expect(result.valueMismatchCount, JSON.stringify(result.valueSample)).toBe(0);
    expect(result.mismatchCount, JSON.stringify(result.sample)).toBe(0);
    expect(errors).toEqual([]);
  });

  // ---- Issue #26: outline shell, foreground curves, residual rungs --------

  test('Issue #26: measured & reconstruction curves render in front of shell/axis; 3D cylinder rungs are visible at default view and shorten as N increases; View B matches master', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await boot(page);
    await enter(page);
    await waitExplicitReady(page, i => i.kind === 'psi1' && i.view === 'a');

    // 1. Verify draw order puts measured (cyan) & ribbon (orange) in front of axis/shell/ring/primes,
    //    and rungs use a thin 3D InstancedMesh cylinder with distinct white-ish colour & medium opacity.
    const orderInfo = await page.evaluate(() => {
      const g = window.__APP_STATE__.scene.getObjectByName('explicit-group');
      const byName = Object.fromEntries(g.children.map(c => [c.name, {
        renderOrder: c.renderOrder,
        transparent: c.material.transparent,
        opacity: c.material.opacity,
        depthWrite: c.material.depthWrite,
        polygonOffset: c.material.polygonOffset,
        polygonOffsetFactor: c.material.polygonOffsetFactor,
        polygonOffsetUnits: c.material.polygonOffsetUnits,
        isLineSegments: c.isLineSegments === true,
        isMesh: c.isMesh === true,
        isInstancedMesh: c.isInstancedMesh === true,
        geomType: c.geometry ? c.geometry.type : null,
        geomParams: c.geometry && c.geometry.parameters ? c.geometry.parameters : null,
        color: c.material && c.material.color ? { r: c.material.color.r, g: c.material.color.g, b: c.material.color.b } : null,
      }]));
      return byName;
    });

    expect(orderInfo['explicit-shell'].isLineSegments).toBe(true);
    expect(orderInfo['explicit-shell'].isMesh).toBe(false);
    expect(orderInfo['explicit-rungs'].isInstancedMesh).toBe(true);
    expect(orderInfo['explicit-rungs'].geomType).toBe('CylinderGeometry');
    expect(orderInfo['explicit-rungs'].geomParams.radiusTop).toBeGreaterThan(0);
    expect(orderInfo['explicit-rungs'].geomParams.radiusBottom).toBeGreaterThan(0);
    expect(orderInfo['explicit-rungs'].color.r).toBeGreaterThan(0.85);
    expect(orderInfo['explicit-rungs'].color.g).toBeGreaterThan(0.85);
    expect(orderInfo['explicit-rungs'].color.b).toBeGreaterThan(0.85);
    expect(orderInfo['explicit-rungs'].opacity).toBeGreaterThan(0.3);
    expect(orderInfo['explicit-rungs'].opacity).toBeLessThan(0.9);
    for (const bg of ['explicit-axis', 'explicit-shell', 'explicit-boundary-ring', 'explicit-primes']) {
      expect(orderInfo[bg].transparent).toBe(true);
      expect(orderInfo[bg].depthWrite).toBe(false);
      expect(orderInfo['explicit-ribbon'].renderOrder).toBeGreaterThan(orderInfo[bg].renderOrder);
      expect(orderInfo['explicit-measured'].renderOrder).toBeGreaterThan(orderInfo[bg].renderOrder);
    }
    expect(orderInfo['explicit-rungs'].transparent).toBe(true);
    expect(orderInfo['explicit-rungs'].depthWrite).toBe(false);
    expect(orderInfo['explicit-ribbon'].transparent).toBe(true);
    expect(orderInfo['explicit-measured'].transparent).toBe(true);
    expect(orderInfo['explicit-measured'].renderOrder).toBeGreaterThan(orderInfo['explicit-ribbon'].renderOrder);
    expect(orderInfo['explicit-measured'].renderOrder).toBeGreaterThan(orderInfo['explicit-rungs'].renderOrder);

    // Legend notes that residual rungs are magnified in View A
    await expect(page.locator('#explicit-legend-rungs')).toBeVisible();
    await expect(page.locator('#explicit-legend-rungs')).toContainText('横木は残差を拡大表示');

    // 2. Measure rung length (3D + projected px at default camera) and default-view pixel diff across N = 10 -> 100 -> 1000
    const measureRungs = () => page.evaluate(async () => {
      const THREE = await import('three');
      const s = window.__APP_STATE__;
      const rungs = s.scene.getObjectByName('explicit-rungs');
      const count = rungs.count;
      const renderer = s.renderer;
      const viewSize = new THREE.Vector2();
      renderer.getSize(viewSize);
      rungs.updateWorldMatrix(true, false);
      s.camera.updateMatrixWorld(true);
      s.camera.updateProjectionMatrix();

      const mat4 = new THREE.Matrix4();
      const worldMat = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const halfAxis = new THREE.Vector3();
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      let sum = 0;
      let max = 0;
      let sumProjPx = 0;
      let maxProjPx = 0;
      for (let k = 0; k < count; k++) {
        rungs.getMatrixAt(k, mat4);
        worldMat.multiplyMatrices(rungs.matrixWorld, mat4);
        worldMat.decompose(pos, quat, scale);
        const len = scale.y;
        sum += len;
        if (len > max) max = len;

        halfAxis.set(0, 0.5 * len, 0).applyQuaternion(quat);
        p0.copy(pos).sub(halfAxis).project(s.camera);
        p1.copy(pos).add(halfAxis).project(s.camera);
        const dx = (p1.x - p0.x) * 0.5 * viewSize.x;
        const dy = (p1.y - p0.y) * 0.5 * viewSize.y;
        const projPx = Math.hypot(dx, dy);
        sumProjPx += projPx;
        if (projPx > maxProjPx) maxProjPx = projPx;
      }

      // Render-toggle pixel diff at fixed default camera (same methodology as review #17/#19)
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const readFrame = (vis) => {
        rungs.visible = vis;
        renderer.clear();
        renderer.render(s.scene, s.camera);
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        return buf;
      };
      const prevVis = rungs.visible;
      let diffPixels = 0;
      let restoreDiff = 0;
      if (prevVis) {
        const on1 = readFrame(true);
        const off = readFrame(false);
        const on2 = readFrame(true);
        for (let i = 0; i < on1.length; i += 4) {
          if (on1[i] !== off[i] || on1[i + 1] !== off[i + 1] || on1[i + 2] !== off[i + 2]) diffPixels++;
          if (on1[i] !== on2[i] || on1[i + 1] !== on2[i + 1] || on1[i + 2] !== on2[i + 2]) restoreDiff++;
        }
      }
      rungs.visible = prevVis;
      return {
        visible: prevVis,
        count,
        geomUuid: rungs.geometry.uuid,
        meanLen: sum / count,
        maxLen: max,
        meanProjPx: sumProjPx / count,
        maxProjPx,
        diffPixels,
        restoreDiff,
        glError: gl.getError(),
      };
    });

    const rungStats = {};
    for (const n of [10, 100, 1000]) {
      await setN(page, n);
      rungStats[n] = await measureRungs();
      expect(rungStats[n].visible).toBe(true);
      expect(rungStats[n].count).toBeGreaterThanOrEqual(50);
      expect(rungStats[n].diffPixels, `default-view pixel diff at N=${n}`).toBeGreaterThan(0);
      expect(rungStats[n].restoreDiff).toBe(0);
      expect(rungStats[n].glError).toBe(0);
    }
    console.log('Residual rung stats (length, projected px & default-view diffPixels):', JSON.stringify(rungStats));
    expect(rungStats[10].geomUuid).toBe(rungStats[100].geomUuid);
    expect(rungStats[100].geomUuid).toBe(rungStats[1000].geomUuid);
    // 3D display length: capped within shell bounds and monotonically decreasing
    expect(rungStats[10].maxLen).toBeLessThanOrEqual(200);
    expect(rungStats[10].meanLen).toBeGreaterThan(rungStats[100].meanLen);
    expect(rungStats[100].meanLen).toBeGreaterThan(rungStats[1000].meanLen);
    expect(rungStats[1000].meanLen).toBeGreaterThan(0);
    // Projected length at default camera: clearly legible as lines at N=10 (several+ px),
    // monotonically shortening across N=10 -> 100 -> 1000, down to short stubs at N=1000
    expect(rungStats[10].maxProjPx).toBeGreaterThanOrEqual(5);
    expect(rungStats[10].meanProjPx).toBeGreaterThan(rungStats[100].meanProjPx);
    expect(rungStats[100].meanProjPx).toBeGreaterThan(rungStats[1000].meanProjPx);
    expect(rungStats[1000].meanProjPx).toBeGreaterThan(0);
    expect(rungStats[10].maxProjPx).toBeGreaterThan(rungStats[100].maxProjPx);
    expect(rungStats[100].maxProjPx).toBeGreaterThan(rungStats[1000].maxProjPx);
    expect(rungStats[1000].maxProjPx).toBeLessThan(2);
    expect(rungStats[10].diffPixels).toBeGreaterThan(rungStats[1000].diffPixels);

    // 3. Sweep playback also updates rungs in-place (N=0 -> 1000) and shortens them by completion
    await setN(page, 0);
    const atN0 = await measureRungs();
    expect(atN0.meanLen).toBeGreaterThan(rungStats[1000].meanLen);
    expect(atN0.diffPixels).toBeGreaterThan(0);

    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 0.01; });
    await page.locator('#explicit-sweep-btn').click();
    await expect.poll(
      async () => page.evaluate(() => ({
        sweepState: window.__APP_STATE__.explicitSweepState,
        N: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N,
      })),
      { timeout: 30_000 },
    ).toEqual({ sweepState: 'done', N: 1000 });

    const afterSweep = await measureRungs();
    expect(afterSweep.geomUuid).toBe(rungStats[1000].geomUuid);
    expect(afterSweep.meanLen).toBeLessThan(atN0.meanLen);
    expect(Math.abs(afterSweep.meanLen - rungStats[1000].meanLen)).toBeLessThan(1e-6);

    // 4. View B hides rungs and legend entry, and restores ribbon/axis/primes render settings to master
    await page.locator('#explicit-view-b').click();
    const viewB = await page.evaluate(() => {
      const g = window.__APP_STATE__.scene.getObjectByName('explicit-group');
      const ribbon = g.getObjectByName('explicit-ribbon');
      const axis = g.getObjectByName('explicit-axis');
      const primes = g.getObjectByName('explicit-primes');
      const rungs = g.getObjectByName('explicit-rungs');
      const legRungs = document.getElementById('explicit-legend-rungs');
      return {
        rungsVisible: rungs.visible,
        legendRungsHidden: legRungs.hidden,
        ribbon: {
          transparent: ribbon.material.transparent,
          polygonOffset: ribbon.material.polygonOffset,
          polygonOffsetFactor: ribbon.material.polygonOffsetFactor,
          polygonOffsetUnits: ribbon.material.polygonOffsetUnits,
          renderOrder: ribbon.renderOrder,
        },
        axis: {
          depthWrite: axis.material.depthWrite,
          renderOrder: axis.renderOrder,
        },
        primes: {
          renderOrder: primes.renderOrder,
        },
      };
    });
    expect(viewB.rungsVisible).toBe(false);
    expect(viewB.legendRungsHidden).toBe(true);
    expect(viewB.ribbon).toEqual({
      transparent: false,
      polygonOffset: false,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 0,
      renderOrder: 0,
    });
    expect(viewB.axis).toEqual({ depthWrite: true, renderOrder: 0 });
    expect(viewB.primes).toEqual({ renderOrder: 0 });

    // Returning to View A restores legend and View A render settings
    await page.locator('#explicit-view-a').click();
    const backToA = await page.evaluate(() => {
      const g = window.__APP_STATE__.scene.getObjectByName('explicit-group');
      const ribbon = g.getObjectByName('explicit-ribbon');
      const axis = g.getObjectByName('explicit-axis');
      const rungs = g.getObjectByName('explicit-rungs');
      return {
        rungsVisible: rungs.visible,
        legendRungsHidden: document.getElementById('explicit-legend-rungs').hidden,
        ribbonTransparent: ribbon.material.transparent,
        ribbonPolygonOffset: ribbon.material.polygonOffset,
        ribbonRenderOrder: ribbon.renderOrder,
        axisDepthWrite: axis.material.depthWrite,
      };
    });
    expect(backToA).toEqual({
      rungsVisible: true,
      legendRungsHidden: false,
      ribbonTransparent: true,
      ribbonPolygonOffset: true,
      ribbonRenderOrder: 10,
      axisDepthWrite: false,
    });
    expect(errors).toEqual([]);
  });
});
