import fs from 'node:fs';
import path from 'node:path';
import { test, expect, newDoc, compositePixel } from './helpers.js';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('the service worker caches every file the app needs', async () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  const list = sw.slice(sw.indexOf('const PRECACHE = ['), sw.indexOf('];', sw.indexOf('const PRECACHE = [')));
  const listed = [...list.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean).sort();
  const needed = ['index.html', 'manifest.webmanifest', ...walk('css'), ...walk('js'), ...walk('icons')]
    .map((p) => p.split(path.sep).join('/')).sort();
  expect(listed).toEqual(needed);
});

test('the web app manifest and its icons are served', async ({ page }) => {
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  expect(manifest.name).toBe('PhotoForge');
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    expect(await page.evaluate(async (src) => (await fetch(src)).ok, icon.src)).toBe(true);
  }
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('works offline after the first visit', async ({ page, context, browserName }) => {
    // Playwright's offline mode only reaches service workers in Chromium.
    test.skip(browserName !== 'chromium', 'offline emulation with service workers needs Chromium');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    try {
      await page.reload();
      await page.waitForFunction(() => !!window.photoforge);
      await newDoc(page, { width: 100, height: 60 });
      expect(await compositePixel(page, 50, 30)).toEqual([255, 255, 255, 255]);
    } finally {
      await context.setOffline(false);
    }
  });
});

const autosaves = (page) => page.evaluate(async () => (await import('./js/autosave.js')).listAutosaves());

async function paintedDoc(page) {
  await newDoc(page, { width: 120, height: 80 });
  await page.evaluate(() => {
    const l = photoforge.doc.activeLayer;
    photoforge.transact('Paint', { layers: [l] }, () => {
      l.ctx.fillStyle = '#ff00ff';
      l.ctx.fillRect(10, 10, 30, 30);
    });
  });
  await expect.poll(async () => (await autosaves(page)).length, { timeout: 15_000 }).toBe(1);
}

async function reopen(page) {
  page.once('dialog', (d) => d.accept()); // the "leave site?" warning for unsaved changes
  await page.reload();
  await page.waitForFunction(() => !!window.photoforge);
}

test('unsaved work is recovered after the tab closes', async ({ page }) => {
  await paintedDoc(page);
  const [old] = await autosaves(page);
  await reopen(page);
  await expect(page.locator('.modal')).toContainText('Recover unsaved work');
  await expect(page.locator('.modal')).toContainText(old.name);
  await page.click('.modal .btn-primary');
  await expect(page.locator('.tab')).toHaveCount(1);
  expect(await compositePixel(page, 20, 20)).toEqual([255, 0, 255, 255]);
  await expect(page.locator('.tab.active .tab-title')).toContainText('*');
  // Kept under the new tab; the old copy is gone.
  await expect.poll(async () => (await autosaves(page)).map((r) => r.key !== old.key)).toEqual([true]);
  // Saving the document clears its autosave.
  await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  await expect.poll(async () => (await autosaves(page)).length, { timeout: 15_000 }).toBe(0);
});

test('Discard forgets autosaved work; closed documents are not offered', async ({ page }) => {
  await paintedDoc(page);
  await reopen(page);
  await expect(page.locator('.modal')).toContainText('Recover unsaved work');
  await page.click('.modal button:has-text("Discard")');
  await expect.poll(async () => (await autosaves(page)).length).toBe(0);

  // A document closed on purpose is not offered either.
  await paintedDoc(page);
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => photoforge.closeDocument());
  await expect.poll(async () => (await autosaves(page)).length, { timeout: 15_000 }).toBe(0);
  await reopen(page);
  await page.waitForTimeout(500);
  await expect(page.locator('.modal')).toHaveCount(0);
});
