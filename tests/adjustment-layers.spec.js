import { test, expect, newDoc, drag, compositePixel, layerPixel, currentLabel, close } from './helpers.js';

/** Background with a red left half and a grey right half. */
async function halves(page) {
  await newDoc(page, { width: 400, height: 300 });
  await page.evaluate(() => {
    const l = photoforge.doc.layers[0];
    l.ctx.fillStyle = '#ff0000';
    l.ctx.fillRect(0, 0, 200, 300);
    l.ctx.fillStyle = '#808080';
    l.ctx.fillRect(200, 0, 200, 300);
    photoforge.changed({ layers: [l] });
  });
}

test('an Invert adjustment layer changes the image, not the pixels below', async ({ page }) => {
  await halves(page);
  await page.evaluate(() => photoforge.runAction('layer.adjust.invert'));
  expect(await currentLabel(page)).toBe('New Invert Layer');
  expect(await compositePixel(page, 100, 100)).toEqual([0, 255, 255, 255]);
  await page.evaluate(() => photoforge.doc.setActive(photoforge.doc.layers[0]));
  expect(await layerPixel(page, 100, 100)).toEqual([255, 0, 0, 255]);
  await page.evaluate(() => photoforge.doc.setActive(photoforge.doc.layers[1]));

  // Half opacity mixes the inverted and original colours.
  await page.fill('.layers-opacity .num-input', '50');
  await page.press('.layers-opacity .num-input', 'Enter');
  expect(close(await compositePixel(page, 100, 100), [128, 128, 128, 255], 1)).toBe(true);
  await page.click('.layer-row.active .layer-eye');
  expect(await compositePixel(page, 100, 100)).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');

  // Its mask is selected, so painting black hides the effect there.
  expect(await page.evaluate(() => photoforge.doc.activeLayer.maskSelected)).toBe(true);
  await page.keyboard.press('b');
  await drag(page, [20, 150], [180, 150], { steps: 6 });
  expect(await compositePixel(page, 100, 150)).toEqual([255, 0, 0, 255]);
  expect(await compositePixel(page, 100, 50)).toEqual([0, 255, 255, 255]);
});

test('a Hue/Saturation layer opens its settings; Cancel leaves nothing, OK adds one step', async ({ page }) => {
  await halves(page);
  await page.evaluate(() => photoforge.runAction('layer.adjust.hueSaturation'));
  await expect(page.locator('.modal')).toContainText('Hue/Saturation');
  await expect(page.locator('.layer-row')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.layer-row')).toHaveCount(1);
  expect(await currentLabel(page)).toBe('New');

  await page.evaluate(() => photoforge.runAction('layer.adjust.hueSaturation'));
  const sat = page.locator('.modal input[type=number][aria-label="Saturation"]');
  await sat.fill('-100');
  await sat.press('Tab');
  // Previewed live.
  expect(close(await compositePixel(page, 100, 100), [128, 128, 128, 255], 2)).toBe(true);
  await page.click('.modal .btn-primary');
  expect(await currentLabel(page)).toBe('New Hue/Saturation Layer');
  expect(close(await compositePixel(page, 100, 100), [128, 128, 128, 255], 2)).toBe(true);

  // Double-clicking the icon edits the settings again.
  await page.dblclick('.layer-row.active .layer-icon');
  await sat.fill('0');
  await sat.press('Tab');
  await page.click('.modal .btn-primary');
  expect(await currentLabel(page)).toBe('Edit Hue/Saturation Layer');
  expect(await compositePixel(page, 100, 100)).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Control+z');
  expect(close(await compositePixel(page, 100, 100), [128, 128, 128, 255], 2)).toBe(true);
});

test('Levels as an adjustment layer, masked to the selection', async ({ page }) => {
  await halves(page);
  await page.keyboard.press('m');
  await drag(page, [200, 0], [400, 300]);
  await page.evaluate(() => photoforge.runAction('layer.adjust.levels'));
  await expect(page.locator('.modal')).toContainText('Levels');
  // Black point to 128 turns mid grey black (only inside the selection).
  await page.evaluate(() => {
    const p = photoforge.doc.activeLayer.adjustment.params;
    p.rgb.inB = 128;
    photoforge.renderer.request(true);
  });
  await page.click('.modal .btn-primary');
  expect(await compositePixel(page, 300, 100)).toEqual([0, 0, 0, 255]);
  expect(await compositePixel(page, 100, 100)).toEqual([255, 0, 0, 255]);
});

test('inside a group an adjustment layer only affects that group', async ({ page }) => {
  await halves(page);
  await page.evaluate(() => {
    const d = photoforge.doc;
    const l = d.newLayer();
    l.ctx.fillStyle = '#0000ff';
    l.ctx.fillRect(150, 100, 100, 100);
    photoforge.runAction('layer.group');
    d.layers[d.layers.length - 1].blendMode = 'source-over'; // isolated group
    d.setActive(l);
    photoforge.runAction('layer.adjust.invert');
  });
  // The blue square (inside the group) is inverted to yellow; the background is not.
  expect(await compositePixel(page, 200, 150)).toEqual([255, 255, 0, 255]);
  expect(await compositePixel(page, 50, 50)).toEqual([255, 0, 0, 255]);
  // As Pass Through, the adjustment reaches everything below.
  await page.evaluate(() => {
    const d = photoforge.doc;
    d.layers[d.layers.length - 1].blendMode = 'pass-through';
    photoforge.renderer.request(true);
  });
  expect(await compositePixel(page, 50, 50)).toEqual([0, 255, 255, 255]);
});

test('Merge Down applies an adjustment layer to the pixels below', async ({ page }) => {
  await halves(page);
  await page.evaluate(() => photoforge.runAction('layer.adjust.invert'));
  await page.keyboard.press('Control+e');
  expect(await currentLabel(page)).toBe('Merge Down');
  expect(await page.evaluate(() => photoforge.doc.layers.length)).toBe(1);
  expect(await layerPixel(page, 100, 100)).toEqual([0, 255, 255, 255]);
});
