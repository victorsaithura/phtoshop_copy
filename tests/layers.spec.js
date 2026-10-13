import { test, expect, newDoc, patternDoc, drag, compositePixel, currentLabel } from './helpers.js';

const layerNames = (page) => page.evaluate(() => photoforge.doc.layers.map((l) => l.name));

test('new, duplicate, rename and delete layers', async ({ page }) => {
  await newDoc(page);
  await page.click('.layers-footer button[title="Create a new layer"]');
  await page.click('.layers-footer button[title="Duplicate layer"]');
  expect(await layerNames(page)).toEqual(['Background', 'Layer 1', 'Layer 1 copy']);
  await page.dblclick('.layer-row.active .layer-name');
  await page.fill('.layer-name-input', 'Sky');
  await page.press('.layer-name-input', 'Enter');
  expect(await layerNames(page)).toEqual(['Background', 'Layer 1', 'Sky']);
  await page.click('.layers-footer button[title="Delete layer"]');
  expect(await layerNames(page)).toEqual(['Background', 'Layer 1']);
  await page.keyboard.press('Control+z');
  expect(await layerNames(page)).toEqual(['Background', 'Layer 1', 'Sky']);
});

test('visibility, opacity and blend mode', async ({ page }) => {
  await newDoc(page, { width: 200, height: 200 });
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.evaluate(() => photoforge.setColor('fg', '#ff0000'));
  await page.keyboard.press('Alt+Backspace');
  expect(await compositePixel(page, 100, 100)).toEqual([255, 0, 0, 255]);
  await page.fill('.layers-opacity .num-input', '50');
  await page.press('.layers-opacity .num-input', 'Enter');
  expect(await currentLabel(page)).toBe('Opacity Change');
  const half = await compositePixel(page, 100, 100);
  expect(half[1]).toBeGreaterThan(120);
  await page.selectOption('.layers-controls select', 'multiply');
  expect(await page.evaluate(() => photoforge.doc.activeLayer.blendMode)).toBe('multiply');
  await page.click('.layer-row.active .layer-eye');
  expect(await compositePixel(page, 100, 100)).toEqual([255, 255, 255, 255]);
});

test('reorder by dragging in the Layers panel and with shortcuts', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.keyboard.press('Control+Alt+Shift+n');
  expect(await layerNames(page)).toEqual(['Background', 'Layer 1', 'Layer 2']);
  await page.keyboard.press('Control+BracketLeft');
  expect(await layerNames(page)).toEqual(['Background', 'Layer 2', 'Layer 1']);
  await page.dragAndDrop('.layer-row:has-text("Background")', '.layer-row:has-text("Layer 1")', { targetPosition: { x: 20, y: 5 } });
  expect((await layerNames(page))[2]).toBe('Background');
});

test('merge down, merge visible and flatten', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.keyboard.press('m');
  await drag(page, [10, 10], [60, 60]);
  await page.keyboard.press('Alt+Backspace');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+e');
  expect(await layerNames(page)).toEqual(['Background']);
  expect(await compositePixel(page, 30, 30)).toEqual([0, 0, 0, 255]);
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.keyboard.press('Control+Shift+e');
  expect((await layerNames(page)).length).toBe(1);
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.evaluate(() => photoforge.runAction('layer.flatten'));
  expect(await layerNames(page)).toEqual(['Background']);
});

test('layer via copy and via cut', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('m');
  await drag(page, [100, 100], [250, 250]);
  await page.keyboard.press('Control+j');
  expect(await page.evaluate(() => photoforge.doc.activeLayer.bounds)).toEqual({ x: 100, y: 100, w: 150, h: 150 });
  await page.evaluate(() => photoforge.doc.setActive(photoforge.doc.layers[0]));
  await page.keyboard.press('Control+Shift+j');
  expect(await page.evaluate(() => photoforge.doc.layers.length)).toBe(3);
  expect(await currentLabel(page)).toBe('Layer via Cut');
});
