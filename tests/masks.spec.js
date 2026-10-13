import { test, expect, newDoc, drag, layerPixel, compositePixel, currentLabel } from './helpers.js';

/** White document with a red layer on top covering everything. */
async function redOverWhite(page) {
  await newDoc(page, { width: 400, height: 300 });
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.evaluate(() => photoforge.setColor('fg', '#ff0000'));
  await page.keyboard.press('Alt+Backspace');
  await page.evaluate(() => photoforge.resetColors());
}

const RED = [255, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

test('reveal selection hides everything outside it', async ({ page }) => {
  await redOverWhite(page);
  await page.keyboard.press('m');
  await drag(page, [100, 100], [200, 200]);
  await page.evaluate(() => photoforge.runAction('mask.revealSelection'));
  expect(await compositePixel(page, 150, 150)).toEqual(RED);
  expect(await compositePixel(page, 300, 250)).toEqual(WHITE);
  // The layer's own pixels are untouched.
  expect(await layerPixel(page, 300, 250)).toEqual(RED);
  await expect(page.locator('.mask-thumb')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  expect(await compositePixel(page, 300, 250)).toEqual(RED);
});

test('painting black on the mask hides, the eraser reveals again', async ({ page }) => {
  await redOverWhite(page);
  await page.click('.layers-footer button[title^="Add a layer mask"]');
  expect(await page.evaluate(() => photoforge.doc.activeLayer.maskSelected)).toBe(true);
  await page.keyboard.press('b');
  await drag(page, [50, 150], [350, 150]);
  expect(await compositePixel(page, 200, 150)).toEqual(WHITE);
  expect(await layerPixel(page, 200, 150)).toEqual(RED);
  expect(await currentLabel(page)).toBe('Brush');
  await page.keyboard.press('e');
  await drag(page, [150, 150], [250, 150]);
  expect(await compositePixel(page, 200, 150)).toEqual(RED);
  await page.keyboard.press('Control+z');
  expect(await compositePixel(page, 200, 150)).toEqual(WHITE);
});

test('fill, invert and gradient work on the mask', async ({ page }) => {
  await redOverWhite(page);
  await page.evaluate(() => photoforge.runAction('mask.revealAll'));
  await page.keyboard.press('m');
  await drag(page, [0, 0], [200, 300]);
  await page.keyboard.press('Alt+Backspace');
  expect(await compositePixel(page, 100, 150)).toEqual(WHITE);
  expect(await compositePixel(page, 300, 150)).toEqual(RED);
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+i');
  expect(await compositePixel(page, 100, 150)).toEqual(RED);
  expect(await compositePixel(page, 300, 150)).toEqual(WHITE);
  await page.keyboard.press('g');
  await drag(page, [0, 150], [400, 150]);
  const mid = await compositePixel(page, 200, 150);
  expect(mid[1]).toBeGreaterThan(60);
  expect(mid[1]).toBeLessThan(200);
});

test('filters are refused on a mask; clicking the layer thumbnail edits pixels again', async ({ page }) => {
  await redOverWhite(page);
  await page.evaluate(() => photoforge.runAction('mask.revealAll'));
  await page.evaluate(() => photoforge.runAction('filter.gaussianBlur'));
  await expect(page.locator('#toast')).toContainText('layer mask');
  await page.click('.layer-row.active .layer-thumb:not(.mask-thumb)');
  expect(await page.evaluate(() => photoforge.doc.activeLayer.maskSelected)).toBe(false);
});

test('disable, apply and delete the mask; the mask moves with its layer', async ({ page }) => {
  await redOverWhite(page);
  await page.keyboard.press('m');
  await drag(page, [100, 100], [200, 200]);
  await page.evaluate(() => photoforge.runAction('mask.revealSelection'));
  await page.keyboard.press('Control+d');
  await page.click('.mask-thumb', { modifiers: ['Shift'] });
  expect(await compositePixel(page, 300, 250)).toEqual(RED);
  await page.click('.mask-thumb', { modifiers: ['Shift'] });
  expect(await compositePixel(page, 300, 250)).toEqual(WHITE);

  await page.keyboard.press('v');
  await drag(page, [150, 150], [200, 150]);
  expect(await compositePixel(page, 220, 150)).toEqual(RED);
  expect(await compositePixel(page, 120, 150)).toEqual(WHITE);
  await page.keyboard.press('Control+z');

  await page.evaluate(() => photoforge.runAction('mask.apply'));
  expect(await page.evaluate(() => photoforge.doc.activeLayer.mask)).toBeNull();
  expect((await layerPixel(page, 300, 250))[3]).toBe(0);
  await page.keyboard.press('Control+z');
  await page.evaluate(() => photoforge.runAction('mask.delete'));
  expect(await compositePixel(page, 300, 250)).toEqual(RED);
});

test('merging a masked layer keeps what was visible', async ({ page }) => {
  await redOverWhite(page);
  await page.keyboard.press('m');
  await drag(page, [100, 100], [200, 200]);
  await page.evaluate(() => photoforge.runAction('mask.revealSelection'));
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+e');
  expect(await page.evaluate(() => photoforge.doc.layers.length)).toBe(1);
  expect(await compositePixel(page, 150, 150)).toEqual(RED);
  expect(await compositePixel(page, 300, 250)).toEqual(WHITE);
});
