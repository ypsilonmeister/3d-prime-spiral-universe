import { test, expect } from '@playwright/test';
import { parseLaunchOptions, buildCleanExitUrl, DEFAULT_PAGE_TITLE, RH_PAGE_TITLE } from '../app/launch-options.js';

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
  test('parseLaunchOptions parses explicit / rh modes and optional kind/view', () => {
    expect(parseLaunchOptions('')).toEqual({ mode: null, kind: null, view: null });
    expect(parseLaunchOptions('?mode=explicit')).toEqual({ mode: 'explicit', kind: null, view: null });
    expect(parseLaunchOptions('?mode=rh')).toEqual({ mode: 'explicit', kind: null, view: null });
    expect(parseLaunchOptions('?mode=EXPLICIT&kind=PSI&view=B')).toEqual({ mode: 'explicit', kind: 'psi', view: 'b' });
    expect(parseLaunchOptions('?mode=explicit&kind=psi1&view=a')).toEqual({ mode: 'explicit', kind: 'psi1', view: 'a' });
    expect(parseLaunchOptions('?mode=unknown&kind=bad&view=z')).toEqual({ mode: null, kind: null, view: null });
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
    expect(snapshot.N).toBe(100);
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
    const info = await page.evaluate(() => ({
      M: window.__APP_STATE__.explicitInfo.M,
      N: window.__APP_STATE__.explicitInfo.N,
      fallback: window.__APP_STATE__.explicitInfo.fallback,
    }));
    expect(info).toEqual({ M: 400, N: 100, fallback: true });

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
