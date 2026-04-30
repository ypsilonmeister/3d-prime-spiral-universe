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
    await page.evaluate(() => window.toggleNTLMode());

    await expect(page.locator('#sw-zeta')).toHaveClass(/on/);
    await expect(page.locator('#sw-ntl')).toHaveClass(/on/);
    await expect(page.locator('#zeta-controls')).toBeVisible();
    await expect(page.locator('#ntl-controls')).toBeVisible();

    await page.locator('#spacing-slider').fill('80');
    await expect(page.locator('#spacing-val')).toHaveText('80');
  });

  test('should capture initial rendering screenshot', async ({ page }) => {
    await page.screenshot({ path: 'test-results/initial-render.png' });
  });
});
