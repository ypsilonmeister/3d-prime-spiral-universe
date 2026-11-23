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
