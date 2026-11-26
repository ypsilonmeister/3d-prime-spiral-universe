import { test, expect } from '@playwright/test';
import { parseLaunchOptions, buildCleanExitUrl, DEFAULT_PAGE_TITLE, RH_PAGE_TITLE } from '../app/launch-options.js';
import { EXPLICIT_SWEEP_STEPS, EXPLICIT_SWEEP_INITIAL_DELAY_MS } from '../app/modes/explicit-sweep.js';

async function waitForReady(page) {
  await expect.poll(
    async () => page.locator('#boot-stage').textContent(),
    { timeout: 45_000, message: 'App should finish booting' },
  ).toBe('Ready');
  await expect(page.locator('#boot-overlay')).toBeHidden({ timeout: 5_000 });
}

async function waitForExplicitSettled(page) {
  await expect.poll(
    async () => page.evaluate(() => {
      const i = window.__APP_STATE__ && window.__APP_STATE__.explicitInfo;
      return Boolean(i && i.N != null && !i.pending);
    }),
    { timeout: 30_000, message: 'Explicit formula computation should settle' },
  ).toBe(true);
}

test.describe('launch-options helpers', () => {
  test('parseLaunchOptions parses explicit / rh modes, kind/view, and autoSweep/reducedMotion', () => {
    expect(parseLaunchOptions('')).toEqual({ mode: null, kind: null, view: null, autoSweep: false });
    expect(parseLaunchOptions('?mode=explicit')).toEqual({ mode: 'explicit', kind: null, view: null, autoSweep: true });
    expect(parseLaunchOptions('?mode=rh')).toEqual({ mode: 'explicit', kind: null, view: null, autoSweep: true });
    expect(parseLaunchOptions('?mode=EXPLICIT&kind=PSI&view=B')).toEqual({ mode: 'explicit', kind: 'psi', view: 'b', autoSweep: true });
    expect(parseLaunchOptions('?mode=explicit&kind=psi1&view=a&sweep=0')).toEqual({ mode: 'explicit', kind: 'psi1', view: 'a', autoSweep: false });
    expect(parseLaunchOptions('?mode=explicit&sweep=1')).toEqual({ mode: 'explicit', kind: null, view: null, autoSweep: true });
    expect(parseLaunchOptions('?mode=explicit', { reducedMotion: true })).toEqual({ mode: 'explicit', kind: null, view: null, autoSweep: false });
    expect(parseLaunchOptions('?mode=unknown&kind=bad&view=z')).toEqual({ mode: null, kind: null, view: null, autoSweep: false });
  });

  test('EXPLICIT_SWEEP_STEPS matches the non-linear 45-step 0->1000 schedule (~10.5s)', () => {
    expect(EXPLICIT_SWEEP_STEPS).toHaveLength(45);
    expect(EXPLICIT_SWEEP_STEPS[0]).toEqual({ n: 0, intervalMs: EXPLICIT_SWEEP_INITIAL_DELAY_MS });
    expect(EXPLICIT_SWEEP_STEPS[EXPLICIT_SWEEP_STEPS.length - 1].n).toBe(1000);

    const expectedNs = [
      0,
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      12, 14, 16, 18, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100,
      120, 140, 160, 180, 200, 240, 280, 320, 360, 400, 450, 500, 560, 620, 700, 780, 860, 930, 1000,
    ];
    expect(EXPLICIT_SWEEP_STEPS.map(s => s.n)).toEqual(expectedNs);

    // Sum of waits between steps (steps 0..43) should be ~10.2s (total ~10.5s with compute)
    const totalWaitMs = EXPLICIT_SWEEP_STEPS.slice(0, -1).reduce((acc, s) => acc + s.intervalMs, 0);
    expect(totalWaitMs).toBe(10190);
  });

  test('buildCleanExitUrl removes launch params while preserving other params and hash', () => {
    expect(buildCleanExitUrl({ pathname: '/', search: '?mode=explicit', hash: '' })).toBe('/');
    expect(buildCleanExitUrl({ pathname: '/3d-prime-spiral-universe/', search: '?mode=explicit&kind=psi&view=b&sweep=0', hash: '' }))
      .toBe('/3d-prime-spiral-universe/');
    expect(buildCleanExitUrl({ pathname: '/', search: '?mode=explicit&foo=1', hash: '#sec' }))
      .toBe('/?foo=1#sec');
  });
});

test.describe('RH dedicated entry page (/rh/) and explicit launch path', () => {
  test('rh/index.html exposes dedicated title, OGP metadata, image asset, and RH-assumed wording', async ({ request }) => {
    const dirRedirect = await request.get('/rh', { maxRedirects: 0 });
    expect(dirRedirect.status()).toBe(301);
    expect(dirRedirect.headers()['location']).toBe('/rh/');

    const res = await request.get('/rh/');
    expect(res.status()).toBe(200);
    const html = await res.text();

    expect(html).toContain(`<title>${RH_PAGE_TITLE}</title>`);
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:image" content="https://ypsilonmeister.github.io/3d-prime-spiral-universe/rh/explicit-formula.webp"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).not.toMatch(/http-equiv=["']refresh["']/i);
    expect(html).toContain('<noscript>');
    expect(html).toContain('href="../?mode=explicit"');

    // Wording constraint: RH-assumed visualization, never "proven"
    expect(html).toContain('RH');
    expect(html).toContain('仮定');
    expect(html).not.toContain('証明済み');
    expect(html).not.toContain('実証');

    const imgRes = await request.get('/rh/explicit-formula.webp');
    expect(imgRes.status()).toBe(200);
    expect(imgRes.headers()['content-type']).toBe('image/webp');
    expect((await imgRes.body()).length).toBeGreaterThan(10_000);
  });

  test('/rh/ redirects to /?mode=explicit, skips initial normal lattice build, and boots directly in Explicit Mode', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource:')) {
        errors.push(msg.text());
      }
    });

    await page.goto('/rh/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\?mode=explicit/);
    await waitForReady(page);
    await waitForExplicitSettled(page);

    await expect(page).toHaveTitle(RH_PAGE_TITLE);
    await expect(page.locator('#sw-explicit')).toHaveClass(/on/);
    await expect(page.locator('#explicit-controls')).toBeVisible();
    await expect(page.locator('#zeta-controls')).toBeVisible();

    const snapshot = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      const g = s.scene.getObjectByName('explicit-group');
      const names = g ? g.children.map(c => c.name).sort() : [];
      const gl = s.renderer.getContext();
      let maxBaseTarget = 0;
      let maxTarget = 0;
      for (let i = 0; i < s.activePointCount * 3; i++) {
        const ab = Math.abs(s.baseTargetPositions[i]);
        const at = Math.abs(s.targetPositions[i]);
        if (ab > maxBaseTarget) maxBaseTarget = ab;
        if (at > maxTarget) maxTarget = at;
      }
      return {
        active: s.explicitModeActive,
        pointsVisible: s.points.visible,
        names,
        glError: gl.getError(),
        M: s.explicitInfo.M,
        N: s.explicitInfo.N,
        maxBaseTarget,
        maxTarget,
      };
    });

    expect(snapshot.active).toBe(true);
    expect(snapshot.pointsVisible).toBe(false);
    expect(snapshot.names).toEqual([
      'explicit-axis',
      'explicit-boundary-ring',
      'explicit-measured',
      'explicit-primes',
      'explicit-ribbon',
      'explicit-rungs',
      'explicit-shell',
    ]);
    expect(snapshot.glError).toBe(0);
    expect(snapshot.M).toBe(1600);
    expect(snapshot.N).toBeGreaterThanOrEqual(0);
    expect(snapshot.N).toBeLessThanOrEqual(1000);
    // Initial normal lattice build must be skipped on explicit launch
    expect(snapshot.maxBaseTarget).toBe(0);
    expect(snapshot.maxTarget).toBe(0);
    expect(errors).toEqual([]);
  });

  test('/rh/?kind=psi&view=b forwards options and unknown ?mode falls back to normal startup', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/rh/?kind=psi&view=b', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\?mode=explicit&kind=psi&view=b/);
    await waitForReady(page);
    await waitForExplicitSettled(page);

    const explicitState = await page.evaluate(() => ({
      active: window.__APP_STATE__.explicitModeActive,
      kind: window.__APP_STATE__.explicitKind,
      view: window.__APP_STATE__.explicitView,
      shellVisible: window.__APP_STATE__.explicitInfo.shellVisible,
    }));
    expect(explicitState).toEqual({ active: true, kind: 'psi', view: 'b', shellVisible: false });

    // Unknown mode parameter must fall back cleanly to normal startup
    await page.goto('/?mode=unknown', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    const normalState = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      let maxTarget = 0;
      for (let i = 0; i < s.activePointCount * 3; i++) {
        const a = Math.abs(s.targetPositions[i]);
        if (a > maxTarget) maxTarget = a;
      }
      return {
        title: document.title,
        active: s.explicitModeActive,
        pointsVisible: s.points.visible,
        maxTarget,
      };
    });
    expect(normalState.title).toBe(DEFAULT_PAGE_TITLE);
    expect(normalState.active).toBe(false);
    expect(normalState.pointsVisible).toBe(true);
    expect(normalState.maxTarget).toBeGreaterThan(500);
  });

  test('exiting Explicit Mode returns to normal app without reload and builds the lattice lazily', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/?mode=explicit', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await waitForExplicitSettled(page);

    // Stamp window so we can prove exit does NOT reload the page
    await page.evaluate(() => { window.__NO_RELOAD_MARKER__ = 'alive'; });

    await page.locator('#group-explicit-toggle .toggle-row').click();
    await expect(page.locator('#sw-explicit')).not.toHaveClass(/on/);
    await expect(page.locator('#explicit-controls')).toBeHidden();
    await expect(page).toHaveTitle(DEFAULT_PAGE_TITLE);

    const afterExit = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      let maxTarget = 0;
      for (let i = 0; i < s.activePointCount * 3; i++) {
        const a = Math.abs(s.targetPositions[i]);
        if (a > maxTarget) maxTarget = a;
      }
      return {
        marker: window.__NO_RELOAD_MARKER__,
        search: window.location.search,
        active: s.explicitModeActive,
        pointsVisible: s.points.visible,
        groupExists: Boolean(s.scene.getObjectByName('explicit-group')),
        info: s.explicitInfo,
        maxTarget,
      };
    });

    expect(afterExit.marker).toBe('alive');
    expect(afterExit.search).toBe('');
    expect(afterExit.active).toBe(false);
    expect(afterExit.pointsVisible).toBe(true);
    expect(afterExit.groupExists).toBe(false);
    expect(afterExit.info).toBeNull();
    expect(afterExit.maxTarget).toBeGreaterThan(500);

    // Normal sections are re-enabled and interactive immediately
    await expect(page.locator('#group-lattice')).not.toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-spacing')).not.toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-zeta-toggle')).not.toHaveClass(/ui-section-disabled/);
    await page.locator('#layout-select').selectOption('hexagonal');
    await expect(page.locator('#current-state-text')).toHaveText('HEXAGONAL - SHELL');

    // Reloading after exit must stay in normal mode (query param was cleaned)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    const afterReload = await page.evaluate(() => ({
      active: window.__APP_STATE__.explicitModeActive,
      pointsVisible: window.__APP_STATE__.points.visible,
    }));
    expect(afterReload).toEqual({ active: false, pointsVisible: true });
    expect(errors).toEqual([]);
  });

  test('worker-blocked /rh/ launch falls back cleanly to M=400 and exits to normal lattice', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.route('**/worker.js', route => route.abort());

    await page.goto('/rh/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\?mode=explicit/);
    await waitForReady(page);
    await waitForExplicitSettled(page);

    await expect(page.locator('#explicit-status')).toHaveText('(fallback mode: reduced samples)');
    // Speed up sweep to verify fallback mode completes all 45 steps cleanly to N=1000
    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 0.01; });
    await expect.poll(
      async () => page.evaluate(() => ({
        state: window.__APP_STATE__.explicitSweepState,
        N: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N,
      })),
      { timeout: 30_000, message: 'Fallback auto-sweep should finish at N=1000' },
    ).toEqual({ state: 'done', N: 1000 });

    const info = await page.evaluate(() => ({
      M: window.__APP_STATE__.explicitInfo.M,
      N: window.__APP_STATE__.explicitInfo.N,
      fallback: window.__APP_STATE__.explicitInfo.fallback,
    }));
    expect(info).toEqual({ M: 400, N: 1000, fallback: true });

    await page.locator('#group-explicit-toggle .toggle-row').click();
    await expect(page.locator('#sw-explicit')).not.toHaveClass(/on/);
    const pointsVisible = await page.evaluate(() => window.__APP_STATE__.points.visible);
    expect(pointsVisible).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('Explore Universes links to /rh/index.html', () => {
  test('main index.html puts #nav-rh first in Explore Universes and navigates into Explicit Mode', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    const firstNav = page.locator('#ui-overlay .controls').first().locator(':scope > *').first();
    await expect(firstNav).toHaveAttribute('id', 'nav-rh');
    await expect(firstNav).toHaveAttribute('href', './rh/index.html');
    await expect(firstNav).toHaveText('ζ リーマン予想と素数');

    await firstNav.click();
    await page.waitForURL(/\?mode=explicit/);
    await waitForReady(page);
    await waitForExplicitSettled(page);
    await expect(page.locator('#sw-explicit')).toHaveClass(/on/);
  });

  for (const subPath of ['/warpednt/index.html', '/gaussianprimes/index.html', '/primemusic/index.html']) {
    test(`${subPath} includes Explore Universes link to ../rh/index.html`, async ({ page }) => {
      await page.goto(subPath, { waitUntil: 'domcontentloaded' });
      const navRh = page.locator('#nav-rh');
      await expect(navRh).toBeVisible();
      await expect(navRh).toHaveAttribute('href', '../rh/index.html');
      await expect(navRh).toHaveText('ζ リーマン予想と素数');
    });
  }

  test('clicking ../rh/index.html from warpednt navigates into Explicit Mode', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/warpednt/index.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#nav-rh').click();
    await page.waitForURL(/\?mode=explicit/);
    await waitForReady(page);
    await waitForExplicitSettled(page);
    await expect(page.locator('#sw-explicit')).toHaveClass(/on/);
  });
});

test.describe('Explicit Formula Mode N-sweep animation (PR 2)', () => {
  test('/rh/ auto-sweeps monotonically, finishes once at N=1000 without looping, and replays via button', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/rh/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\?mode=explicit/);
    await waitForReady(page);

    // At normal speed, auto-sweep should be running and monotonically increasing N while RMS decreases
    const first = await page.evaluate(() => ({
      sweeping: window.__APP_STATE__.explicitSweeping,
      sweepState: window.__APP_STATE__.explicitSweepState,
      N: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N,
      rms: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.rms,
    }));
    expect(first.sweeping).toBe(true);
    expect(first.sweepState).toBe('running');
    await expect(page.locator('#explicit-sweep-btn')).toHaveText('⏸ 停止');
    // WCAG: button with changing Play/Pause/Replay label must not also set aria-pressed
    await expect(page.locator('#explicit-sweep-btn')).not.toHaveAttribute('aria-pressed');

    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N),
      { timeout: 10_000, message: 'Auto-sweep should advance N without user input' },
    ).toBeGreaterThan(first.N ?? 0);

    // Speed up remaining steps to deterministically verify completion at N=1000
    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 0.01; });
    await expect.poll(
      async () => page.evaluate(() => ({
        sweeping: window.__APP_STATE__.explicitSweeping,
        sweepState: window.__APP_STATE__.explicitSweepState,
        N: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N,
        zetaN: window.__APP_STATE__.zetaZeroCount,
      })),
      { timeout: 30_000, message: 'Auto-sweep should complete at N=1000' },
    ).toEqual({ sweeping: false, sweepState: 'done', N: 1000, zetaN: 1000 });

    const doneRms = await page.evaluate(() => window.__APP_STATE__.explicitInfo.rms);
    if (first.rms != null) {
      expect(doneRms).toBeLessThan(first.rms);
    }
    await expect(page.locator('#explicit-sweep-btn')).toHaveText('↺ もう一度再生');

    // Confirm one-shot behavior (does NOT loop back to 0)
    await page.waitForTimeout(400);
    const afterWait = await page.evaluate(() => ({
      sweeping: window.__APP_STATE__.explicitSweeping,
      sweepState: window.__APP_STATE__.explicitSweepState,
      N: window.__APP_STATE__.explicitInfo.N,
    }));
    expect(afterWait).toEqual({ sweeping: false, sweepState: 'done', N: 1000 });

    // Click "↺ もう一度再生" to replay from N=0 -> 1000
    await page.locator('#explicit-sweep-btn').click();
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweepState),
      { timeout: 5_000 },
    ).toBe('running');
    await expect.poll(
      async () => page.evaluate(() => ({
        sweepState: window.__APP_STATE__.explicitSweepState,
        N: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N,
      })),
      { timeout: 30_000, message: 'Replay should finish at N=1000' },
    ).toEqual({ sweepState: 'done', N: 1000 });
    await expect(page.locator('#explicit-sweep-btn')).toHaveText('↺ もう一度再生');
    expect(errors).toEqual([]);
  });

  test('slider intervention immediately stops auto-sweep and switches to manual control', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?mode=explicit', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweeping),
      { timeout: 10_000 },
    ).toBe(true);

    // Move N slider manually
    await page.locator('#zeta-n-slider').evaluate((el) => {
      el.value = '42';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const rightAfter = await page.evaluate(() => ({
      sweeping: window.__APP_STATE__.explicitSweeping,
      sweepState: window.__APP_STATE__.explicitSweepState,
      zetaN: window.__APP_STATE__.zetaZeroCount,
    }));
    expect(rightAfter).toEqual({ sweeping: false, sweepState: 'idle', zetaN: 42 });
    await expect(page.locator('#explicit-sweep-btn')).toHaveText('▶ N スイープ');

    await waitForExplicitSettled(page);
    await page.waitForTimeout(600);
    const settled = await page.evaluate(() => ({
      sweeping: window.__APP_STATE__.explicitSweeping,
      N: window.__APP_STATE__.explicitInfo.N,
      zetaN: window.__APP_STATE__.zetaZeroCount,
    }));
    expect(settled).toEqual({ sweeping: false, N: 42, zetaN: 42 });
  });

  test('delayed pre-intervention Worker reply is discarded after slider stops sweep and returns to same N', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.addInitScript(() => {
      const OrigWorker = window.Worker;
      window.__heldSweepReqId = null;
      window.__heldSweepEvent = null;
      window.__heldSweepDeliver = null;
      window.__releaseHeldSweepReply = () => {
        if (window.__heldSweepDeliver && window.__heldSweepEvent) {
          const fn = window.__heldSweepDeliver;
          const ev = window.__heldSweepEvent;
          window.__heldSweepDeliver = null;
          window.__heldSweepEvent = null;
          fn(ev);
          return true;
        }
        return false;
      };
      window.Worker = class extends OrigWorker {
        postMessage(msg, ...rest) {
          if (msg && msg.type === 'explicit_recon' && msg.N === 1 && window.__heldSweepReqId === null) {
            window.__heldSweepReqId = msg.reqId;
          }
          return super.postMessage(msg, ...rest);
        }
        set onmessage(handler) {
          if (typeof handler !== 'function') {
            super.onmessage = handler;
            return;
          }
          super.onmessage = (ev) => {
            const m = ev && ev.data;
            if (
              m &&
              m.type === 'explicit_done' &&
              window.__heldSweepReqId !== null &&
              m.reqId === window.__heldSweepReqId &&
              window.__heldSweepEvent === null
            ) {
              window.__heldSweepEvent = ev;
              window.__heldSweepDeliver = handler.bind(this);
              return;
            }
            return handler.call(this, ev);
          };
        }
        get onmessage() {
          return super.onmessage;
        }
      };
    });

    await page.goto('/?mode=explicit', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    // Wait until auto-sweep finishes N=0 and its N=1 worker reply is captured and held
    await expect.poll(
      async () => page.evaluate(() => window.__heldSweepEvent !== null),
      { timeout: 15_000, message: 'Auto-sweep N=1 worker reply should be captured and held' },
    ).toBe(true);

    const beforeIntervention = await page.evaluate(() => ({
      N: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N,
      reconSeq: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.reconSeq,
      sweepState: window.__APP_STATE__.explicitSweepState,
    }));
    expect(beforeIntervention).toEqual({ N: 0, reconSeq: 1, sweepState: 'running' });

    // Intervene with slider: move to N=2 and wait for manual reconstruction to settle
    await page.locator('#zeta-n-slider').evaluate((el) => {
      el.value = '2';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(
      async () => page.evaluate(() => {
        const i = window.__APP_STATE__.explicitInfo;
        return i && !i.pending ? i.N : null;
      }),
      { timeout: 15_000, message: 'Manual N=2 reconstruction should settle' },
    ).toBe(2);

    // Move slider back to N=1 and wait for manual reconstruction to settle
    await page.locator('#zeta-n-slider').evaluate((el) => {
      el.value = '1';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(
      async () => page.evaluate(() => {
        const i = window.__APP_STATE__.explicitInfo;
        return i && !i.pending ? i.N : null;
      }),
      { timeout: 15_000, message: 'Manual N=1 reconstruction should settle' },
    ).toBe(1);

    const beforeRelease = await page.evaluate(() => ({
      N: window.__APP_STATE__.explicitInfo.N,
      reconSeq: window.__APP_STATE__.explicitInfo.reconSeq,
      sweepState: window.__APP_STATE__.explicitSweepState,
      sweeping: window.__APP_STATE__.explicitSweeping,
      zetaN: window.__APP_STATE__.zetaZeroCount,
    }));
    expect(beforeRelease).toEqual({
      N: 1,
      reconSeq: 3,
      sweepState: 'idle',
      sweeping: false,
      zetaN: 1,
    });

    // Deliver the stale pre-intervention Worker reply for N=1
    const released = await page.evaluate(() => window.__releaseHeldSweepReply());
    expect(released).toBe(true);
    await page.waitForTimeout(300);

    const afterRelease = await page.evaluate(() => ({
      N: window.__APP_STATE__.explicitInfo.N,
      reconSeq: window.__APP_STATE__.explicitInfo.reconSeq,
      sweepState: window.__APP_STATE__.explicitSweepState,
      sweeping: window.__APP_STATE__.explicitSweeping,
      zetaN: window.__APP_STATE__.zetaZeroCount,
    }));
    // Stale reply must be discarded: reconSeq must NOT increment (no redundant overwrite)
    expect(afterRelease).toEqual(beforeRelease);
    expect(errors).toEqual([]);
  });

  test('dedicated entry sweep plays in View B with a large N read-out, returns to View A on completion, and replay does the same', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/?mode=explicit', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    const bigN = page.locator('#explicit-n-display-val');
    await expect(page.locator('#explicit-n-display')).toBeVisible();
    expect(await page.evaluate(() => ({ v: window.__APP_STATE__.explicitView, s: window.__APP_STATE__.explicitSweepState })))
      .toEqual({ v: 'b', s: 'running' });
    await expect(page.locator('#explicit-view-b')).toHaveAttribute('aria-pressed', 'true');
    // Legible: at least 40px and tracks N while sweeping
    const fontPx = await bigN.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(fontPx).toBeGreaterThanOrEqual(40);
    await expect.poll(async () => Number(await bigN.textContent()), { timeout: 10_000 }).toBeGreaterThan(0);

    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 0.01; });
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweepState),
      { timeout: 30_000 },
    ).toBe('done');
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('a');
    await expect(page.locator('#explicit-view-a')).toHaveAttribute('aria-pressed', 'true');
    await expect(bigN).toHaveText('1000');

    // Replay: View B again, back to A at the end
    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 1; });
    await page.locator('#explicit-sweep-btn').click();
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('b');
    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 0.01; });
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweepState),
      { timeout: 30_000 },
    ).toBe('done');
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('a');
    expect(errors).toEqual([]);
  });

  test('interrupting the sweep keeps View B, and the large N follows manual slider changes', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?mode=explicit', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweeping),
      { timeout: 10_000 },
    ).toBe(true);
    await page.locator('#zeta-n-slider').evaluate((el) => {
      el.value = '42';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#explicit-n-display-val')).toHaveText('42');
    await waitForExplicitSettled(page);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('b');
    await expect(page.locator('#explicit-n-display-val')).toHaveText('42');
    // explicit View A choice afterwards is respected
    await page.locator('#explicit-view-a').click();
    await page.locator('#explicit-sweep-btn').click(); // replay -> View B again
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('b');
  });

  test('replay started from the View B left by an interrupted sweep still returns to View A', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?mode=explicit', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweeping),
      { timeout: 10_000 },
    ).toBe(true);
    // Interrupt with the slider: the view stays in B
    await page.locator('#zeta-n-slider').evaluate((el) => {
      el.value = '42';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitForExplicitSettled(page);
    expect(await page.evaluate(() => window.__APP_STATE__.explicitSweeping)).toBe(false);
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('b');
    // Replay straight away (no manual View A choice): starts in B, must complete back in A
    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 1; });
    await page.locator('#explicit-sweep-btn').click();
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('b');
    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 0.01; });
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweepState),
      { timeout: 30_000 },
    ).toBe('done');
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('a');
    await expect(page.locator('#explicit-n-display-val')).toHaveText('1000');
  });

  for (const [w, h] of [[700, 768], [667, 375], [600, 375], [390, 844], [1280, 720]]) {
    test(`large N read-out is fully visible with the guide expanded at ${w}x${h}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/?mode=explicit', { waitUntil: 'domcontentloaded' });
      await waitForReady(page);
      await expect(page.locator('#explicit-n-display')).toBeVisible();
      // worst case: widest value
      await page.evaluate(() => { document.getElementById('explicit-n-display-val').textContent = '1000'; });
      const r = await page.evaluate(() => {
        const v = document.getElementById('explicit-n-display-val').getBoundingClientRect();
        const g = document.getElementById('rh-guide-panel').getBoundingClientRect();
        const pts = [[0.05, 0.5], [0.5, 0.5], [0.95, 0.5], [0.5, 0.1], [0.5, 0.9]];
        const covered = pts.some(([fx, fy]) => {
          const el = document.elementFromPoint(v.x + v.width * fx, v.y + v.height * fy);
          return el && el.closest('#rh-guide-panel');
        });
        const overlapsGuide = v.right > g.x && v.x < g.right && v.bottom > g.y && v.y < g.bottom;
        return { left: v.x, right: v.right, top: v.y, bottom: v.bottom, covered, overlapsGuide,
          vw: window.innerWidth, vh: window.innerHeight, guideCollapsed: document.getElementById('rh-guide-panel').classList.contains('collapsed') };
      });
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(r.vw);
      expect(r.bottom).toBeLessThanOrEqual(r.vh);
      expect(r.covered).toBe(false);
      expect(r.overlapsGuide).toBe(false);
    });
  }

  test('static start (?sweep=0) and manual Explicit toggle stay in View A and show the large N', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?mode=explicit&sweep=0', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await waitForExplicitSettled(page);
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('a');
    await expect(page.locator('#explicit-n-display-val')).toHaveText('100');
    // Manual sweep via the button on a dedicated entry is a replay: View B, then back to A
    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 0.01; });
    await page.locator('#explicit-sweep-btn').click();
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweepState),
      { timeout: 30_000 },
    ).toBe('done');
    expect(await page.evaluate(() => window.__APP_STATE__.explicitView)).toBe('a');
  });

  test('View B keeps sweep running, pause/resume works, and Kind switch stops sweep', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/?mode=explicit', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweeping),
      { timeout: 10_000 },
    ).toBe(true);

    // Switching to View B must NOT stop the sweep
    await page.locator('#explicit-view-b').click();
    const nAtViewB = await page.evaluate(() => ({
      view: window.__APP_STATE__.explicitView,
      sweeping: window.__APP_STATE__.explicitSweeping,
      N: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N,
    }));
    expect(nAtViewB.view).toBe('b');
    expect(nAtViewB.sweeping).toBe(true);
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N),
      { timeout: 10_000, message: 'Sweep should continue advancing in View B' },
    ).toBeGreaterThan(nAtViewB.N ?? 0);

    // Pause via button
    await page.locator('#explicit-sweep-btn').click();
    const pausedN = await page.evaluate(() => ({
      sweeping: window.__APP_STATE__.explicitSweeping,
      sweepState: window.__APP_STATE__.explicitSweepState,
      N: window.__APP_STATE__.zetaZeroCount,
    }));
    expect(pausedN.sweeping).toBe(false);
    expect(pausedN.sweepState).toBe('paused');
    await expect(page.locator('#explicit-sweep-btn')).toHaveText('▶ 再開');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__APP_STATE__.zetaZeroCount)).toBe(pausedN.N);

    // Resume via button
    await page.locator('#explicit-sweep-btn').click();
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N),
      { timeout: 10_000, message: 'Resume should advance past paused N' },
    ).toBeGreaterThan(pausedN.N);

    // Kind switch (psi1 -> psi) must stop the sweep
    await page.locator('#explicit-kind-psi').click();
    const afterKind = await page.evaluate(() => ({
      kind: window.__APP_STATE__.explicitKind,
      sweeping: window.__APP_STATE__.explicitSweeping,
      sweepState: window.__APP_STATE__.explicitSweepState,
    }));
    expect(afterKind).toEqual({ kind: 'psi', sweeping: false, sweepState: 'idle' });
  });

  test('exiting Explicit Mode immediately stops an active sweep', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/?mode=explicit', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await expect.poll(
      async () => page.evaluate(() => window.__APP_STATE__.explicitSweeping),
      { timeout: 10_000 },
    ).toBe(true);

    await page.locator('#group-explicit-toggle .toggle-row').click();
    const afterExit = await page.evaluate(() => ({
      active: window.__APP_STATE__.explicitModeActive,
      sweeping: window.__APP_STATE__.explicitSweeping,
      sweepState: window.__APP_STATE__.explicitSweepState,
    }));
    expect(afterExit).toEqual({ active: false, sweeping: false, sweepState: 'idle' });

    await page.waitForTimeout(500);
    const later = await page.evaluate(() => ({
      active: window.__APP_STATE__.explicitModeActive,
      sweeping: window.__APP_STATE__.explicitSweeping,
    }));
    expect(later).toEqual({ active: false, sweeping: false });
    expect(errors).toEqual([]);
  });

  test('prefers-reduced-motion: reduce and ?sweep=0 disable auto-sweep and start static at N=100', async ({ page }) => {
    test.setTimeout(120_000);

    // 1. ?sweep=0
    await page.goto('/?mode=explicit&sweep=0', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await waitForExplicitSettled(page);
    await page.waitForTimeout(600);
    const sweepZero = await page.evaluate(() => ({
      sweeping: window.__APP_STATE__.explicitSweeping,
      sweepState: window.__APP_STATE__.explicitSweepState,
      N: window.__APP_STATE__.explicitInfo.N,
    }));
    expect(sweepZero).toEqual({ sweeping: false, sweepState: 'idle', N: 100 });
    await expect(page.locator('#explicit-sweep-btn')).toHaveText('▶ N スイープ');

    // 2. prefers-reduced-motion: reduce on /rh/
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/rh/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\?mode=explicit/);
    await waitForReady(page);
    await waitForExplicitSettled(page);
    await page.waitForTimeout(600);
    const reduced = await page.evaluate(() => ({
      sweeping: window.__APP_STATE__.explicitSweeping,
      sweepState: window.__APP_STATE__.explicitSweepState,
      N: window.__APP_STATE__.explicitInfo.N,
    }));
    expect(reduced).toEqual({ sweeping: false, sweepState: 'idle', N: 100 });
  });

  test('manual Explicit Mode toggle from normal startup stays static at N=100 until manual sweep button is clicked', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    await page.locator('#group-explicit-toggle .toggle-row').click();
    await waitForExplicitSettled(page);
    await page.waitForTimeout(600);

    const manualStart = await page.evaluate(() => ({
      sweeping: window.__APP_STATE__.explicitSweeping,
      sweepState: window.__APP_STATE__.explicitSweepState,
      N: window.__APP_STATE__.explicitInfo.N,
    }));
    expect(manualStart).toEqual({ sweeping: false, sweepState: 'idle', N: 100 });
    await expect(page.locator('#explicit-sweep-btn')).toHaveText('▶ N スイープ');

    // User can manually start the sweep from the Explicit controls button
    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 0.01; });
    await page.locator('#explicit-sweep-btn').click();
    await expect.poll(
      async () => page.evaluate(() => ({
        sweepState: window.__APP_STATE__.explicitSweepState,
        N: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N,
      })),
      { timeout: 30_000, message: 'Manual N sweep should finish at N=1000' },
    ).toEqual({ sweepState: 'done', N: 1000 });
    await expect(page.locator('#explicit-sweep-btn')).toHaveText('↺ もう一度再生');
  });
});

test.describe('RH 3-block explanation panel (PR 3)', () => {
  test('dedicated entry (?mode=explicit) opens panel expanded with 3 compliant blocks, Kind/View sync, H-key sync, and exit button', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/?mode=explicit&sweep=0', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await waitForExplicitSettled(page);

    const panel = page.locator('#rh-guide-panel');
    const card = page.locator('#rh-guide-card');
    const openBtn = page.locator('#rh-guide-open-btn');
    const collapseBtn = page.locator('#rh-guide-collapse-btn');

    // Expanded by default on dedicated entry (D2=A)
    await expect(panel).toBeVisible();
    await expect(card).toBeVisible();
    await expect(openBtn).toBeHidden();
    const initState = await page.evaluate(() => ({
      visible: window.__APP_STATE__.rhGuideVisible,
      collapsed: window.__APP_STATE__.rhGuideCollapsed,
    }));
    expect(initState).toEqual({ visible: true, collapsed: false });

    // Positioned as an independent top-right card without overlapping left #ui-overlay
    const boxes = await page.evaluate(() => {
      const left = document.getElementById('ui-overlay').getBoundingClientRect();
      const right = document.getElementById('rh-guide-card').getBoundingClientRect();
      return { leftRight: left.right, rightLeft: right.left, rightTop: right.top };
    });
    expect(boxes.rightLeft).toBeGreaterThan(boxes.leftRight);
    expect(boxes.rightTop).toBeLessThan(40);

    // Strictly 3 blocks matching the 3 visual elements 1-to-1
    const blocks = page.locator('#rh-guide-blocks .rh-guide-block');
    await expect(blocks).toHaveCount(3);
    await expect(page.locator('#rh-block-measured')).toContainText('ψ₁(x) − x²/2');
    await expect(page.locator('#rh-block-measured')).toContainText('シアン');
    await expect(page.locator('#rh-block-recon')).toContainText('ゼータ零点による再構成');
    await expect(page.locator('#rh-block-recon')).toContainText('オレンジのリボン');
    await expect(page.locator('#rh-block-recon')).toContainText('残差 rung');
    await expect(page.locator('#rh-block-recon')).toContainText('横木');
    await expect(page.locator('#rh-block-recon')).toContainText('拡大表示');
    await expect(page.locator('#rh-block-bound')).toContainText('RH を仮定した場合の誤差上限');
    await expect(page.locator('#rh-block-bound')).toContainText('±B₁(x)');
    await expect(page.locator('#rh-block-bound')).toContainText('面ではなく紫の輪郭線');
    await expect(page.locator('#rh-block-bound')).toContainText('リーマン予想の証明ではありません');
    const noteLink = page.locator('#rh-block-bound-body a');
    const expectBoundNote = async () => {
      const body = page.locator('#rh-block-bound-body');
      await expect(body).toContainText('2026年11月');
      await expect(body).toContainText('リーマン予想の証明を主張する Lean 形式化');
      await expect(body).toContainText('「仮定」としての表記を維持します。');
      await expect(body).not.toContainText(/証明済み|証明され(た|まし)/);
      await expect(noteLink).toBeVisible();
      await expect(noteLink).toHaveText('https://math.mit.edu/~drew/grh/');
      await expect(noteLink).toHaveAttribute('href', 'https://math.mit.edu/~drew/grh/');
      await expect(noteLink).toHaveAttribute('target', '_blank');
      await expect(noteLink).toHaveAttribute('rel', 'noopener noreferrer');
    };
    await expectBoundNote();
    // The static markup in index.html and the string rendered by explicit.js must match
    const wording = await page.evaluate(async () => {
      const html = await (await fetch('/index.html')).text();
      const source = new DOMParser().parseFromString(html, 'text/html').getElementById('rh-block-bound-body');
      const live = document.getElementById('rh-block-bound-body');
      // Drop the static node's text so that the next render has to rebuild it from the JS string
      live.textContent = '';
      document.getElementById('explicit-view-b').click();
      document.getElementById('explicit-view-a').click();
      return { staticHtml: source.innerHTML, renderedHtml: live.innerHTML };
    });
    expect(wording.renderedHtml).toBe(wording.staticHtml);

    // Wording constraint & no duplication of left-panel HUD / scale note / legend explanations
    const cardText = await card.textContent();
    for (const forbidden of [
      '証明済み',
      '実証',
      '成り立つことを示して',
      '必ずこの殻に収まる',
      '誤差がゼロ',
      'N を増やすほど実測',
      'N を増やすほど残差は小さく',
      'N を増やすと全体として',
    ]) {
      expect(cardText).not.toContain(forbidden);
    }
    expect(cardText).toContain('N が大きいほど傾向として');
    expect(cardText).toContain('N を 1 つ増やすごとに必ず誤差が小さくなるとは限らず');
    expect(cardText).toContain('局所的にも全体の指標でも増えることがあります');
    expect(cardText).not.toContain('asinh');
    expect(cardText).not.toContain('中間サンプル');
    expect(cardText).not.toContain('最大サンプル');

    const legendText = await page.locator('#explicit-legend').textContent();
    expect(legendText).toContain('残差 rung');
    expect(legendText).toContain('誤差上限（RH を仮定した場合）');
    expect(legendText).not.toContain('色＝残差');
    expect(legendText).not.toContain('拡大表示');
    expect(legendText).not.toContain('横木は残差');
    expect(legendText).not.toContain('x ≥ 73.2');
    await expect(page.locator('#explicit-scale-note')).toContainText('asinh');
    await expect(page.locator('#explicit-hud')).toContainText('中間サンプル');

    // Kind switch (psi1 -> psi) syncs Block 1 & Block 3 formulas
    await page.locator('#explicit-kind-psi').click();
    await waitForExplicitSettled(page);
    await expect(page.locator('#rh-block-measured-title')).toContainText('ψ(x) − x');
    await expect(page.locator('#rh-block-bound-title')).toContainText('±B(x)');

    // View switch (A -> B -> A) dims hidden blocks and updates Block 2 heading
    await page.locator('#explicit-view-b').click();
    await expect(page.locator('#rh-block-measured')).toHaveClass(/rh-block-muted/);
    await expect(page.locator('#rh-block-bound')).toHaveClass(/rh-block-muted/);
    await expect(page.locator('#rh-block-measured-title')).toContainText('ビュー B では非表示');
    await expect(page.locator('#rh-block-bound-title')).toContainText('ビュー B では非表示');
    await expect(page.locator('#rh-block-recon-title')).toContainText('ビュー B：打ち切り残差');
    await expectBoundNote();
    const viewBReconText = await page.locator('#rh-block-recon-body').textContent();
    expect(viewBReconText).toContain('N が大きいほど傾向として');
    expect(viewBReconText).toContain('N を 1 つ増やすごとに必ず小さくなるとは限らず');
    expect(viewBReconText).toContain('局所的にも全体の指標でも増えることがあります');
    expect(viewBReconText).not.toContain('N を増やすほど残差は小さく');
    expect(viewBReconText).not.toContain('N を増やすと全体として');
    const viewBLegendText = await page.locator('#explicit-legend').textContent();
    expect(viewBLegendText).not.toContain('色＝残差');

    await page.locator('#explicit-view-a').click();
    await expect(page.locator('#rh-block-measured')).not.toHaveClass(/rh-block-muted/);
    await expect(page.locator('#rh-block-bound')).not.toHaveClass(/rh-block-muted/);
    await expect(page.locator('#rh-block-recon-body')).toContainText('残差 rung');
    await expectBoundNote();

    // Re-rendering with unchanged wording keeps the same link node, so focus is not lost
    await noteLink.focus();
    await page.evaluate(() => { document.getElementById('explicit-view-b').click(); });
    await expect(page.locator('#rh-block-bound')).toHaveClass(/rh-block-muted/);
    await expect(noteLink).toBeFocused();
    await page.evaluate(() => { document.getElementById('explicit-view-a').click(); });
    await expect(noteLink).toBeFocused();

    // Collapse to chip "解説を開く" and re-expand
    await collapseBtn.click();
    await expect(card).toBeHidden();
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toHaveText('解説を開く');
    await openBtn.click();
    await expect(card).toBeVisible();
    await expect(openBtn).toBeHidden();

    // H key toggles both #ui-overlay and #rh-guide-panel
    await page.keyboard.press('h');
    await expect(page.locator('#ui-overlay')).toHaveClass(/hidden/);
    await expect(panel).toHaveClass(/hidden/);
    await page.keyboard.press('h');
    await expect(page.locator('#ui-overlay')).not.toHaveClass(/hidden/);
    await expect(panel).not.toHaveClass(/hidden/);

    // Exit button returns to normal spiral without reload and hides guide panel
    await page.evaluate(() => { window.__NO_RELOAD_MARKER__ = 'still-here'; });
    await page.locator('#rh-exit-btn').click();
    await expect(panel).toBeHidden();
    await expect(page).toHaveTitle(DEFAULT_PAGE_TITLE);
    const afterExit = await page.evaluate(() => ({
      marker: window.__NO_RELOAD_MARKER__,
      search: window.location.search,
      active: window.__APP_STATE__.explicitModeActive,
      guideVisible: window.__APP_STATE__.rhGuideVisible,
      pointsVisible: window.__APP_STATE__.points.visible,
    }));
    expect(afterExit).toEqual({
      marker: 'still-here',
      search: '',
      active: false,
      guideVisible: false,
      pointsVisible: true,
    });
    expect(errors).toEqual([]);
  });

  test('manual Explicit Mode toggle starts collapsed as "解説を開く" chip and expands on click (D2=A)', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    const panel = page.locator('#rh-guide-panel');
    const card = page.locator('#rh-guide-card');
    const openBtn = page.locator('#rh-guide-open-btn');

    // Hidden on normal startup
    await expect(panel).toBeHidden();

    // Manual toggle ON -> collapsed chip "解説を開く"
    await page.locator('#group-explicit-toggle .toggle-row').click();
    await waitForExplicitSettled(page);

    await expect(panel).toBeVisible();
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toHaveText('解説を開く');
    await expect(card).toBeHidden();
    const collapsedState = await page.evaluate(() => ({
      visible: window.__APP_STATE__.rhGuideVisible,
      collapsed: window.__APP_STATE__.rhGuideCollapsed,
    }));
    expect(collapsedState).toEqual({ visible: true, collapsed: true });

    // Click chip -> expands full 3-block card with N synced
    await openBtn.click();
    await expect(card).toBeVisible();
    await expect(openBtn).toBeHidden();
    await expect(page.locator('#rh-guide-n-val')).toHaveText('100');
    await expect(page.locator('#rh-guide-blocks .rh-guide-block')).toHaveCount(3);
    await expect(page.locator('#rh-guide-sweep-btn')).not.toHaveAttribute('aria-pressed');

    // Sweep button inside guide card triggers sweep and syncs with left panel
    await page.evaluate(() => { window.__APP_STATE__.explicitSweepIntervalScale = 0.01; });
    await page.locator('#rh-guide-sweep-btn').click();
    await expect.poll(
      async () => page.evaluate(() => ({
        sweepState: window.__APP_STATE__.explicitSweepState,
        N: window.__APP_STATE__.explicitInfo && window.__APP_STATE__.explicitInfo.N,
      })),
      { timeout: 30_000, message: 'Sweep started from guide card should finish at N=1000' },
    ).toEqual({ sweepState: 'done', N: 1000 });
    await expect(page.locator('#rh-guide-n-val')).toHaveText('1000');
    await expect(page.locator('#rh-guide-sweep-btn')).toHaveText('↺ もう一度再生');
    await expect(page.locator('#explicit-sweep-btn')).toHaveText('↺ もう一度再生');

    // Manual toggle OFF hides the guide panel cleanly
    await page.locator('#group-explicit-toggle .toggle-row').click();
    await expect(panel).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('narrow viewport (390x844) starts collapsed as chip even on dedicated entry without covering controls', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?mode=explicit&sweep=0', { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await waitForExplicitSettled(page);

    const panel = page.locator('#rh-guide-panel');
    const card = page.locator('#rh-guide-card');
    const openBtn = page.locator('#rh-guide-open-btn');
    const collapseBtn = page.locator('#rh-guide-collapse-btn');

    // Starts collapsed as chip on narrow viewport (<= 480px) even from dedicated entry
    await expect(panel).toBeVisible();
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toHaveText('解説を開く');
    await expect(card).toBeHidden();
    const initState = await page.evaluate(() => ({
      visible: window.__APP_STATE__.rhGuideVisible,
      collapsed: window.__APP_STATE__.rhGuideCollapsed,
    }));
    expect(initState).toEqual({ visible: true, collapsed: true });

    // Chip does not overlap #ui-overlay and left controls receive pointer hits directly
    const layout = await page.evaluate(() => {
      const ui = document.getElementById('ui-overlay');
      const uiRect = ui.getBoundingClientRect();
      const chipRect = document.getElementById('rh-guide-open-btn').getBoundingClientRect();
      const overlapW = Math.max(0, Math.min(uiRect.right, chipRect.right) - Math.max(uiRect.left, chipRect.left));
      const overlapH = Math.max(0, Math.min(uiRect.bottom, chipRect.bottom) - Math.max(uiRect.top, chipRect.top));

      const slider = document.getElementById('zeta-n-slider');
      slider.scrollIntoView({ block: 'center' });
      const sRect = slider.getBoundingClientRect();
      const sliderHit = document.elementFromPoint(sRect.left + sRect.width / 2, sRect.top + sRect.height / 2);

      const viewB = document.getElementById('explicit-view-b');
      viewB.scrollIntoView({ block: 'center' });
      const vRect = viewB.getBoundingClientRect();
      const viewBHit = document.elementFromPoint(vRect.left + vRect.width / 2, vRect.top + vRect.height / 2);

      return {
        overlapArea: overlapW * overlapH,
        sliderCoveredByGuide: Boolean(sliderHit && sliderHit.closest('#rh-guide-panel')),
        viewBCoveredByGuide: Boolean(viewBHit && viewBHit.closest('#rh-guide-panel')),
        sliderHitInsideUi: Boolean(sliderHit && sliderHit.closest('#ui-overlay')),
        viewBHitInsideUi: Boolean(viewBHit && viewBHit.closest('#ui-overlay')),
      };
    });
    expect(layout).toEqual({
      overlapArea: 0,
      sliderCoveredByGuide: false,
      viewBCoveredByGuide: false,
      sliderHitInsideUi: true,
      viewBHitInsideUi: true,
    });

    // Left controls are directly usable without collapsing anything first
    await page.locator('#explicit-view-b').click();
    await expect(page.locator('#explicit-view-b')).toHaveClass(/active/);

    // User can still expand and re-collapse the guide card from the chip
    await openBtn.click();
    await expect(card).toBeVisible();
    await expect(openBtn).toBeHidden();
    await collapseBtn.click();
    await expect(card).toBeHidden();
    await expect(openBtn).toBeVisible();
    expect(errors).toEqual([]);
  });
});
