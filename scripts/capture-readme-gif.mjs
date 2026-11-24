// Captures PNG frames of the Explicit Formula Mode N-sweep (N = 10 -> 1000) for the README GIF.
// Usage: node scripts/capture-readme-gif.mjs <outDir> [baseUrl]
// Requires a static server at baseUrl (default http://127.0.0.1:31829; start with `node tests/static-server.mjs 31829`).
// Assemble afterwards with scripts/build-readme-gif.py.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:31829';
if (!outDir) { console.error('usage: capture-readme-gif.mjs <outDir> [baseUrl]'); process.exit(1); }
mkdirSync(outDir, { recursive: true });

// 10 -> 1000, roughly log-spaced so the change stays visible at both ends.
const NS = [10, 14, 18, 25, 30, 40, 50, 60, 80, 90,
  120, 140, 160, 180, 200, 240, 280, 320, 400, 500, 600, 700, 800, 900, 1000];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto(`${base}/rh/?sweep=0`);
await page.waitForFunction(() => document.querySelector('#boot-stage')?.textContent === 'Ready', null, { timeout: 60000 });
await page.waitForFunction(() => { const i = window.__APP_STATE__?.explicitInfo; return i && i.N != null && !i.pending; }, null, { timeout: 60000 });

async function setN(n) {
  await page.evaluate((v) => {
    const s = document.getElementById('zeta-n-slider');
    s.value = String(v);
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, n);
  await page.waitForFunction((v) => {
    const i = window.__APP_STATE__.explicitInfo;
    return i && i.N === v && !i.pending && document.getElementById('explicit-n-display-val').textContent === String(v);
  }, n, { timeout: 60000 });
  await page.waitForTimeout(250);
}

for (let k = 0; k < NS.length; k++) {
  await setN(NS[k]);
  await page.screenshot({ path: `${outDir}/frame-${String(k).padStart(3, '0')}-N${NS[k]}.png` });
  console.log('captured N =', NS[k]);
}
await browser.close();
