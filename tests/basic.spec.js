import { test, expect } from '@playwright/test';

test.describe('PrimeCrystal Basic Verification', () => {
  test.beforeEach(async ({ page }) => {
    const browserErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource:')) {
        console.log(`BROWSER [${msg.type()}]: ${msg.text()}`);
      }
    });
    page.on('pageerror', err => browserErrors.push(err.message));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/PrimeCrystal/);

    await expect(page.locator('#ui-overlay')).toBeVisible();
    await expect(page.locator('#boot-overlay')).toBeAttached();

    await expect.poll(
      async () => page.locator('#boot-stage').textContent(),
      { timeout: 45_000, message: 'PrimeCrystal should finish booting' },
    ).toBe('Ready');
    await expect(page.locator('#boot-overlay')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#canvas-container canvas')).toBeVisible();

    if (browserErrors.length > 0) {
      throw new Error(`Unexpected page error(s): ${browserErrors.join('\n')}`);
    }
  });

  test('should load the page and initialize WebGL', async ({ page }) => {
    await expect(page.locator('#ui-overlay')).toBeVisible();
    await expect(page.locator('#canvas-container canvas')).toHaveCount(1);
    await expect(page.locator('#count-val')).toHaveText('320,000');
    await expect(page.locator('#current-state-text')).toHaveText('CUBE - SHELL');
  });

  test('should change layout and check if it reflects in UI', async ({ page }) => {
    await page.locator('#layout-select').selectOption('hexagonal');

    await expect(page.locator('#current-state-text')).toHaveText('HEXAGONAL - SHELL');
    await expect(page.locator('#layout-select')).toHaveValue('hexagonal');
  });

  test('should toggle Zeta Wave mode', async ({ page }) => {
    await page.locator('#group-zeta-toggle .toggle-row').click();

    await expect(page.locator('#zeta-controls')).toBeVisible();
    await expect(page.locator('#sw-zeta')).toHaveClass(/on/);
  });

  test('should handle keyboard shortcuts without page errors', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.keyboard.press('h');
    await expect(page.locator('#ui-overlay')).toHaveClass(/hidden/);

    await page.keyboard.press('h');
    await expect(page.locator('#ui-overlay')).not.toHaveClass(/hidden/);

    await page.keyboard.press('c');
    await page.keyboard.press('g');
    await expect(page.locator('#sw-autogrow')).toHaveClass(/on/);
    expect(pageErrors).toEqual([]);
  });

  test('should compose Zeta and NTL overlays consistently', async ({ page }) => {
    await page.locator('#group-zeta-toggle .toggle-row').click();
    await page.locator('#zeta-n-slider').fill('2');
    await page.locator('#sw-ntl').click();

    await expect(page.locator('#sw-zeta')).toHaveClass(/on/);
    await expect(page.locator('#sw-ntl')).toHaveClass(/on/);
    await expect(page.locator('#zeta-controls')).toBeVisible();
    await expect(page.locator('#ntl-controls')).toBeVisible();

    await page.locator('#spacing-slider').fill('80');
    await expect(page.locator('#spacing-val')).toHaveText('80');
  });

  test('should handle p-adic and PrimeDim exclusivity', async ({ page }) => {
    // Enable p-adic mode
    await page.locator('#group-padic-toggle .toggle-row').click();
    await expect(page.locator('#sw-padic')).toHaveClass(/on/);
    await expect(page.locator('#group-primedim-toggle')).toHaveClass(/ui-section-disabled/);

    // Disable p-adic mode
    await page.locator('#group-padic-toggle .toggle-row').click();
    await expect(page.locator('#sw-padic')).not.toHaveClass(/on/);
    await expect(page.locator('#group-primedim-toggle')).not.toHaveClass(/ui-section-disabled/);

    // Enable PrimeDim mode
    await page.locator('#group-primedim-toggle .toggle-row').click();
    await expect(page.locator('#sw-primedim')).toHaveClass(/on/);
    await expect(page.locator('#group-padic-toggle')).toHaveClass(/ui-section-disabled/);

    // Disable PrimeDim mode
    await page.locator('#group-primedim-toggle .toggle-row').click();
    await expect(page.locator('#sw-primedim')).not.toHaveClass(/on/);
    await expect(page.locator('#group-padic-toggle')).not.toHaveClass(/ui-section-disabled/);
  });

  test('should handle Sieve owner exclusivity and progress callbacks', async ({ page }) => {
    // Reduce point count so Sieve animation runs quickly under headless software WebGL
    await page.locator('#count-slider').fill('1000');
    await expect(page.locator('#count-val')).toHaveText('1,000');

    // Enable Sieve mode
    await page.locator('#group-sieve-toggle .toggle-row').click();
    await expect(page.locator('#sw-sieve')).toHaveClass(/on/);
    await expect(page.locator('#sieve-controls')).toBeVisible();

    // Verify Sieve UI & progress callbacks (Issue #2)
    await expect(page.locator('#sieve-play-btn')).toHaveText('▶ Play');
    await expect(page.locator('#sieve-stats')).toHaveText('Sieving ×2 | Primes: 1 | √N=31');
    await page.locator('#sieve-play-btn').click();
    await expect(page.locator('#sieve-stats')).toHaveText('Done — 168 primes found', { timeout: 15_000 });
    await expect(page.locator('#sieve-play-btn')).toHaveText('▶ Play');
    const progVal = await page.locator('#sieve-progress').evaluate(el => el.value);
    expect(progVal).toBe(100);

    // Verify Sieve disables other owner and conflicting sections (Issue #1)
    await expect(page.locator('#group-primedim-toggle')).toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-padic-toggle')).toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-explicit-toggle')).toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-zeta-toggle')).toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-ntl-toggle')).toHaveClass(/ui-section-disabled/);

    // Disable Sieve mode and verify sections are re-enabled
    await page.locator('#group-sieve-toggle .toggle-row').click();
    await expect(page.locator('#sw-sieve')).not.toHaveClass(/on/);
    await expect(page.locator('#sieve-controls')).toBeHidden();
    await expect(page.locator('#group-primedim-toggle')).not.toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-padic-toggle')).not.toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-explicit-toggle')).not.toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-zeta-toggle')).not.toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-ntl-toggle')).not.toHaveClass(/ui-section-disabled/);

    // Re-enable Sieve, then activate another owner (p-adic) to verify Sieve is exited
    await page.locator('#group-sieve-toggle .toggle-row').click();
    await expect(page.locator('#sw-sieve')).toHaveClass(/on/);
    await page.locator('#group-padic-toggle .toggle-row').dispatchEvent('click');

    await expect(page.locator('#sw-padic')).toHaveClass(/on/);
    await expect(page.locator('#sw-sieve')).not.toHaveClass(/on/);
    await expect(page.locator('#sieve-controls')).toBeHidden();
    await expect(page.locator('#group-sieve-toggle')).toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-padic-toggle')).not.toHaveClass(/ui-section-disabled/);
    const flags = await page.evaluate(() => ({
      sieve: window.__APP_STATE__.sieveModeActive,
      padic: window.__APP_STATE__.padicModeActive,
    }));
    expect(flags).toEqual({ sieve: false, padic: true });

    // Disable p-adic mode and verify Sieve section is re-enabled
    await page.locator('#group-padic-toggle .toggle-row').click();
    await expect(page.locator('#sw-padic')).not.toHaveClass(/on/);
    await expect(page.locator('#group-sieve-toggle')).not.toHaveClass(/ui-section-disabled/);
  });

  test('should stop active Zeta Wave and NTL overlays when entering Sieve and restore visuals on exit', async ({ page }) => {
    await page.locator('#count-slider').fill('1000');
    await expect(page.locator('#count-val')).toHaveText('1,000');

    const snapshot = () => page.evaluate(() => {
      const s = window.__APP_STATE__;
      const n = s.activePointCount;
      const maxAbs = (arr, len) => {
        let m = 0;
        for (let i = 0; i < len; i++) {
          const a = Math.abs(arr[i]);
          if (a > m) m = a;
        }
        return m;
      };
      return {
        flags: {
          zeta: s.zetaModeActive,
          ntl: s.ntlModeActive,
          sieve: s.sieveModeActive,
        },
        zetaMax: maxAbs(s.zetaOffsets, n),
        ntlMax: maxAbs(s.ntlOffsets, n),
        targets: Array.from(s.targetPositions.slice(0, n * 3)),
        colors: Array.from(s.geometry.attributes.customColor.array.slice(0, n * 3)),
        sizes: Array.from(s.geometry.attributes.size.array.slice(0, n)),
      };
    });

    const baseline = await snapshot();

    // Order from review #335: Zeta Wave -> NTL -> Sieve
    await page.locator('#group-zeta-toggle .toggle-row').click();
    await expect(page.locator('#sw-zeta')).toHaveClass(/on/);
    await page.locator('#zeta-n-slider').fill('5');
    await expect.poll(
      async () => (await snapshot()).zetaMax,
      { timeout: 15_000, message: 'Zeta offsets should be computed' },
    ).toBeGreaterThan(0);

    await page.locator('#sw-ntl').click();
    await expect(page.locator('#sw-ntl')).toHaveClass(/on/);
    const withOverlays = await snapshot();
    expect(withOverlays.flags).toEqual({ zeta: true, ntl: true, sieve: false });
    expect(withOverlays.ntlMax).toBeGreaterThan(0);
    expect(withOverlays.targets).not.toEqual(baseline.targets);
    expect(withOverlays.colors).not.toEqual(baseline.colors);

    // Enter Sieve while Zeta Wave and NTL are active
    await page.locator('#group-sieve-toggle .toggle-row').click();
    await expect(page.locator('#sw-sieve')).toHaveClass(/on/);
    await expect(page.locator('#sieve-controls')).toBeVisible();
    await expect(page.locator('#sw-zeta')).not.toHaveClass(/on/);
    await expect(page.locator('#zeta-controls')).toBeHidden();
    await expect(page.locator('#group-zeta-toggle')).toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#sw-ntl')).not.toHaveClass(/on/);
    await expect(page.locator('#ntl-controls')).toBeHidden();
    await expect(page.locator('#group-ntl-toggle')).toHaveClass(/ui-section-disabled/);

    const duringSieve = await snapshot();
    expect(duringSieve.flags).toEqual({ zeta: false, ntl: false, sieve: true });
    expect(duringSieve.zetaMax).toBe(0);
    expect(duringSieve.ntlMax).toBe(0);
    expect(duringSieve.targets).toEqual(baseline.targets);
    expect(duringSieve.colors).not.toEqual(baseline.colors);

    // Programmatic toggle attempts on incompatible overlays stay blocked while Sieve owns the view
    await page.locator('#group-zeta-toggle .toggle-row').dispatchEvent('click');
    await page.locator('#sw-ntl').dispatchEvent('click');
    const afterBlockedToggle = await snapshot();
    expect(afterBlockedToggle.flags).toEqual({ zeta: false, ntl: false, sieve: true });
    expect(afterBlockedToggle.zetaMax).toBe(0);
    expect(afterBlockedToggle.ntlMax).toBe(0);
    expect(afterBlockedToggle.targets).toEqual(baseline.targets);

    // Exit Sieve and verify baseline visuals and targets are restored
    await page.locator('#group-sieve-toggle .toggle-row').click();
    await expect(page.locator('#sw-sieve')).not.toHaveClass(/on/);
    await expect(page.locator('#group-zeta-toggle')).not.toHaveClass(/ui-section-disabled/);
    await expect(page.locator('#group-ntl-toggle')).not.toHaveClass(/ui-section-disabled/);

    const afterFirstExit = await snapshot();
    expect(afterFirstExit.flags).toEqual({ zeta: false, ntl: false, sieve: false });
    expect(afterFirstExit.targets).toEqual(baseline.targets);
    expect(afterFirstExit.colors).toEqual(baseline.colors);
    expect(afterFirstExit.sizes).toEqual(baseline.sizes);

    // Review #335 color-restoration sequence: NTL ON -> Sieve ON -> Sieve OFF
    await page.locator('#sw-ntl').click();
    await expect(page.locator('#sw-ntl')).toHaveClass(/on/);
    const ntlOnly = await snapshot();
    expect(ntlOnly.flags).toEqual({ zeta: false, ntl: true, sieve: false });
    expect(ntlOnly.colors).not.toEqual(baseline.colors);

    await page.locator('#group-sieve-toggle .toggle-row').click();
    await expect(page.locator('#sw-sieve')).toHaveClass(/on/);
    await expect(page.locator('#sw-ntl')).not.toHaveClass(/on/);
    const sieveFromNtl = await snapshot();
    expect(sieveFromNtl.flags).toEqual({ zeta: false, ntl: false, sieve: true });
    expect(sieveFromNtl.ntlMax).toBe(0);
    expect(sieveFromNtl.targets).toEqual(baseline.targets);
    expect(sieveFromNtl.colors).not.toEqual(baseline.colors);

    await page.locator('#group-sieve-toggle .toggle-row').click();
    await expect(page.locator('#sw-sieve')).not.toHaveClass(/on/);
    const afterNtlSieveExit = await snapshot();
    expect(afterNtlSieveExit.flags).toEqual({ zeta: false, ntl: false, sieve: false });
    expect(afterNtlSieveExit.targets).toEqual(baseline.targets);
    expect(afterNtlSieveExit.colors).toEqual(baseline.colors);
    expect(afterNtlSieveExit.sizes).toEqual(baseline.sizes);
  });

  test('should rebuild normal lattice coordinates when switching directly from p-adic or PrimeDim to Sieve', async ({ page }) => {
    await page.locator('#count-slider').fill('1000');
    await expect(page.locator('#count-val')).toHaveText('1,000');

    const readPositions = () => page.evaluate(() => {
      const s = window.__APP_STATE__;
      const n = s.activePointCount;
      return {
        flags: {
          padic: s.padicModeActive,
          primeDim: s.primeDimModeActive,
          sieve: s.sieveModeActive,
        },
        hasAxisLines: s.primeDimAxisLines !== null,
        axisLabelCount: s.primeDimAxisLabels.length,
        baseTargets: Array.from(s.baseTargetPositions.slice(0, n * 3)),
        targets: Array.from(s.targetPositions.slice(0, n * 3)),
      };
    });

    const baseline = await readPositions();

    // Direct switch: p-adic -> Sieve
    await page.locator('#group-padic-toggle .toggle-row').click();
    await expect(page.locator('#sw-padic')).toHaveClass(/on/);
    const padicState = await readPositions();
    expect(padicState.flags).toEqual({ padic: true, primeDim: false, sieve: false });
    expect(padicState.targets).not.toEqual(baseline.targets);

    await page.locator('#group-sieve-toggle .toggle-row').dispatchEvent('click');
    await expect(page.locator('#sw-sieve')).toHaveClass(/on/);
    await expect(page.locator('#sw-padic')).not.toHaveClass(/on/);
    await expect(page.locator('#group-padic-toggle')).toHaveClass(/ui-section-disabled/);

    const sieveFromPadic = await readPositions();
    expect(sieveFromPadic.flags).toEqual({ padic: false, primeDim: false, sieve: true });
    expect(sieveFromPadic.baseTargets).toEqual(baseline.baseTargets);
    expect(sieveFromPadic.targets).toEqual(baseline.targets);

    // Exit Sieve
    await page.locator('#group-sieve-toggle .toggle-row').click();
    await expect(page.locator('#sw-sieve')).not.toHaveClass(/on/);

    // Direct switch: PrimeDim -> Sieve
    await page.locator('#group-primedim-toggle .toggle-row').click();
    await expect(page.locator('#sw-primedim')).toHaveClass(/on/);
    const primeDimState = await readPositions();
    expect(primeDimState.flags).toEqual({ padic: false, primeDim: true, sieve: false });
    expect(primeDimState.hasAxisLines).toBe(true);
    expect(primeDimState.targets).not.toEqual(baseline.targets);

    await page.locator('#group-sieve-toggle .toggle-row').dispatchEvent('click');
    await expect(page.locator('#sw-sieve')).toHaveClass(/on/);
    await expect(page.locator('#sw-primedim')).not.toHaveClass(/on/);
    await expect(page.locator('#group-primedim-toggle')).toHaveClass(/ui-section-disabled/);

    const sieveFromPrimeDim = await readPositions();
    expect(sieveFromPrimeDim.flags).toEqual({ padic: false, primeDim: false, sieve: true });
    expect(sieveFromPrimeDim.hasAxisLines).toBe(false);
    expect(sieveFromPrimeDim.axisLabelCount).toBe(0);
    expect(sieveFromPrimeDim.baseTargets).toEqual(baseline.baseTargets);
    expect(sieveFromPrimeDim.targets).toEqual(baseline.targets);

    // Exit Sieve and verify normal lattice remains intact
    await page.locator('#group-sieve-toggle .toggle-row').click();
    await expect(page.locator('#sw-sieve')).not.toHaveClass(/on/);
    const afterExit = await readPositions();
    expect(afterExit.flags).toEqual({ padic: false, primeDim: false, sieve: false });
    expect(afterExit.targets).toEqual(baseline.targets);
  });

  test('should recompute active mode variables when count changes', async ({ page }) => {
    // Enable PrimeDim mode
    await page.locator('#group-primedim-toggle .toggle-row').click();
    
    // Change count slider
    await page.locator('#count-slider').fill('100000');
    await expect(page.locator('#count-val')).toHaveText('100,000');

    // Enable NTL mode and change count slider
    await page.locator('#sw-ntl').click();
    await page.locator('#count-slider').fill('50000');
    await expect(page.locator('#count-val')).toHaveText('50,000');
  });

  test('lattice targets are committed and do not collapse to origin', async ({ page }) => {
    // Regression guard for the position-commit bug: calculateTargetPositions()
    // only fills baseTargetPositions, so every lattice change must be committed
    // into targetPositions via rebuildPositions(). If it is not, targetPositions
    // stays all-zero and the points lerp into a single blob at the origin.
    await page.waitForTimeout(2500); // let the lerp settle onto the targets

    const stats = await page.evaluate(() => {
      const s = window.__APP_STATE__;
      const n = s.activePointCount;
      const tp = s.targetPositions;
      const pos = s.geometry.attributes.position.array;
      let maxTarget = 0, maxPos = 0;
      for (let i = 0; i < n * 3; i++) {
        const at = Math.abs(tp[i]);  if (at > maxTarget) maxTarget = at;
        const ap = Math.abs(pos[i]); if (ap > maxPos)    maxPos = ap;
      }
      return { maxTarget, maxPos };
    });

    // Cube layout (range 45) × spacing 65 ⇒ targets reach ~2900 units.
    expect(stats.maxTarget).toBeGreaterThan(500);
    // Live points must have spread toward the lattice, not collapsed to ~0.
    expect(stats.maxPos).toBeGreaterThan(500);
  });

  test('changing layout recomputes committed lattice targets', async ({ page }) => {
    const sample = () => page.evaluate(() =>
      Array.from(window.__APP_STATE__.targetPositions.slice(0, 30)));

    const before = await sample();
    await page.locator('#layout-select').selectOption('gyroid');
    await page.waitForTimeout(200);
    const after = await sample();

    // The committed target buffer must actually change when the layout changes.
    expect(after).not.toEqual(before);
  });

  test('should capture initial rendering screenshot', async ({ page }) => {
    await page.waitForTimeout(2500); // capture the settled lattice, not the initial cloud
    await page.screenshot({ path: 'test-results/initial-render.png' });
  });
});

test.describe('Sub-apps Smoke Tests', () => {
  test('should load Warped Universe without page errors', async ({ page }) => {
    const browserErrors = [];
    page.on('pageerror', err => browserErrors.push(err.message));
    
    await page.goto('/warpednt/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Warped Number Theory Universe/);
    await expect(page.locator('#ui-overlay')).toBeVisible();
    await expect(page.locator('#canvas-container')).toBeVisible();
    
    expect(browserErrors).toEqual([]);
  });

  test('should load Gaussian Primes without page errors', async ({ page }) => {
    const browserErrors = [];
    page.on('pageerror', err => browserErrors.push(err.message));
    
    await page.goto('/gaussianprimes/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Gaussian Prime/);
    await expect(page.locator('#canvas-container')).toBeVisible();
    
    expect(browserErrors).toEqual([]);
  });

  test('should load Prime Music without page errors', async ({ page }) => {
    const browserErrors = [];
    page.on('pageerror', err => browserErrors.push(err.message));
    
    await page.goto('/primemusic/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Prime Number Music/);
    await expect(page.locator('#number-canvas')).toBeVisible();
    
    expect(browserErrors).toEqual([]);
  });
});

