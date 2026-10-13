import { test, expect, patternDoc, drag, layerPixel, currentLabel } from './helpers.js';

test('every adjustment and filter changes pixels and undoes cleanly', async ({ page }) => {
  await patternDoc(page);
  const results = await page.evaluate(async () => {
    const { ADJUSTMENTS, defaultParams } = await import('./js/core/adjustments.js');
    const { FILTERS } = await import('./js/core/filters.js');
    const { runPixelCommand } = await import('./js/ui/adjust-dialog.js');
    const overrides = {
      brightnessContrast: { brightness: 60, contrast: 30 },
      exposure: { exposure: 1 },
      vibrance: { vibrance: 50 },
      hueSaturation: { hue: 90 },
      colorBalance: { mCR: 60 },
    };
    const sample = () => {
      const d = photoforge.doc.activeLayer.ctx.getImageData(0, 0, 600, 400).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 97) sum += d[i];
      return sum;
    };
    const out = [];
    for (const defs of [ADJUSTMENTS, FILTERS]) {
      for (const [key, def] of Object.entries(defs)) {
        const params = { ...defaultParams(def), ...(overrides[key] || {}) };
        if (key === 'levels') params.rgb = { inB: 30, inW: 220, gamma: 1.3, outB: 0, outW: 255 };
        if (key === 'curves') params.rgb = [[0, 0], [100, 150], [255, 255]];
        const before = sample();
        runPixelCommand(photoforge, def, { id: key, params });
        const changed = sample() !== before;
        const label = photoforge.history.current.label;
        photoforge.undo();
        out.push({ key, changed, label, restored: sample() === before });
      }
    }
    return out;
  });
  for (const r of results) {
    expect(r.restored, `${r.key} undo`).toBe(true);
    // Auto Tone / Auto Contrast leave an image that already spans the full range unchanged.
    if (!r.key.startsWith('auto')) expect(r.changed, `${r.key} changes pixels`).toBe(true);
  }
});

test('Levels dialog previews live and applies on OK', async ({ page }) => {
  await patternDoc(page);
  const before = await layerPixel(page, 50, 50);
  await page.keyboard.press('Control+l');
  await expect(page.locator('.modal')).toContainText('Levels');
  const strip = await page.locator('.marker-strip >> nth=0').boundingBox();
  await page.mouse.move(strip.x + strip.width - 2, strip.y + 6);
  await page.mouse.down();
  await page.mouse.move(strip.x + strip.width * 0.6, strip.y + 6, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => !!photoforge.preview)).toBe(true);
  await page.click('.modal .btn-primary');
  expect(await currentLabel(page)).toBe('Levels');
  expect(await page.evaluate(() => photoforge.preview)).toBeNull();
  const after = await layerPixel(page, 50, 50);
  expect(after[0]).toBeGreaterThan(before[0]);
});

test('Curves dialog adds and drags a point', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('Control+m');
  const box = await page.locator('.curves-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.25, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.levels-fields input >> nth=1')).not.toHaveValue('128');
  await page.click('.modal .btn-primary');
  expect(await currentLabel(page)).toBe('Curves');
});

test('cancelling a filter dialog leaves the image untouched', async ({ page }) => {
  await patternDoc(page);
  const before = await layerPixel(page, 100, 100);
  await page.evaluate(() => photoforge.runAction('filter.gaussianBlur'));
  await expect(page.locator('.modal')).toContainText('Gaussian Blur');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(await page.evaluate(() => photoforge.preview)).toBeNull();
  expect(await layerPixel(page, 100, 100)).toEqual(before);
  expect(await currentLabel(page)).toBe('Open');
});

test('adjustments are limited to the selection', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('m');
  await drag(page, [0, 0], [300, 400]);
  await page.keyboard.press('Control+i');
  expect(await layerPixel(page, 150, 150)).toEqual([0, 0, 0, 255]);
  expect(await layerPixel(page, 420, 200)).toEqual([0, 0, 0, 255]);
});

test('Last Filter repeats the previous filter', async ({ page }) => {
  await patternDoc(page);
  await page.evaluate(() => photoforge.runAction('filter.sharpen'));
  await page.keyboard.press('Control+Alt+f');
  const labels = await page.evaluate(() => photoforge.history.entries.map((e) => e.label));
  expect(labels.slice(-2)).toEqual(['Sharpen', 'Sharpen']);
});
