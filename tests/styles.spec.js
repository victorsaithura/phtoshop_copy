import { test, expect, newDoc, drag, compositePixel, currentLabel, close } from './helpers.js';

/** White background and a red 100×100 square at (100, 100) on Layer 1 (active). */
async function square(page) {
  await newDoc(page, { width: 400, height: 300 });
  await page.evaluate(() => {
    const l = photoforge.doc.newLayer();
    l.ctx.fillStyle = '#ff0000';
    l.ctx.fillRect(100, 100, 100, 100);
    photoforge.changed({ structure: true });
  });
}

/** Set styles in one undoable step, as the dialog does. */
const setStyles = (page, styles) => page.evaluate(async (styles) => {
  const { effectDefaults } = await import('./js/core/effects.js');
  const l = photoforge.doc.activeLayer;
  const full = {};
  for (const [k, v] of Object.entries(styles)) full[k] = { ...effectDefaults(k), ...v };
  photoforge.transact('Layer Style', { structure: true }, () => { l.styles = full; });
}, styles);

const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];

test('an outside stroke follows the shape and is removed by undo', async ({ page }) => {
  await square(page);
  await setStyles(page, { stroke: { size: 6, position: 'outside', color: '#0000ff' } });
  expect(await compositePixel(page, 97, 150)).toEqual([0, 0, 255, 255]);
  expect(await compositePixel(page, 150, 203)).toEqual([0, 0, 255, 255]);
  expect(await compositePixel(page, 110, 150)).toEqual(RED);
  expect(await compositePixel(page, 90, 150)).toEqual(WHITE);
  await expect(page.locator('.layer-row.active .layer-fx')).toHaveCount(1);
  // The stroke follows new pixels.
  await page.evaluate(() => {
    const l = photoforge.doc.activeLayer;
    photoforge.transact('Paint', { layers: [l] }, () => {
      l.ctx.fillStyle = '#ff0000';
      l.ctx.fillRect(300, 100, 50, 50);
    });
  });
  expect(await compositePixel(page, 297, 120)).toEqual([0, 0, 255, 255]);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await compositePixel(page, 97, 150)).toEqual(WHITE);
  await expect(page.locator('.layer-fx')).toHaveCount(0);
});

test('inside stroke, colour overlay and opacity', async ({ page }) => {
  await square(page);
  await setStyles(page, {
    colorOverlay: { color: '#00ff00' },
    stroke: { size: 4, position: 'inside', color: '#000000' },
  });
  expect(await compositePixel(page, 150, 150)).toEqual([0, 255, 0, 255]);
  expect(await compositePixel(page, 101, 150)).toEqual([0, 0, 0, 255]);
  expect(await compositePixel(page, 98, 150)).toEqual(WHITE);
  await page.fill('.layers-opacity .num-input', '50');
  await page.press('.layers-opacity .num-input', 'Enter');
  expect(close(await compositePixel(page, 150, 150), [128, 255, 128, 255], 3)).toBe(true);
});

test('drop shadow falls down-right and outer glow surrounds the shape', async ({ page }) => {
  await square(page);
  await setStyles(page, { dropShadow: { distance: 10, size: 0, opacity: 100, angle: 135 } });
  // 135° light from the upper left: the shadow is offset by about (7, 7).
  const shadow = await compositePixel(page, 204, 204);
  expect(shadow[0]).toBeLessThan(10);
  expect(await compositePixel(page, 96, 96)).toEqual(WHITE);
  await setStyles(page, { outerGlow: { color: '#000000', blendMode: 'source-over', size: 8, opacity: 100 } });
  // Strongest next to the shape, fading with distance.
  const near = await compositePixel(page, 202, 150);
  const mid = await compositePixel(page, 206, 150);
  expect(near[0]).toBeLessThan(200);
  expect(mid[0]).toBeGreaterThan(near[0]);
  expect(mid[0]).toBeLessThan(255);
  expect(await compositePixel(page, 230, 150)).toEqual(WHITE);
});

test('inner shadow and bevel shade the inside of the shape', async ({ page }) => {
  await square(page);
  await setStyles(page, { innerShadow: { distance: 6, size: 2, opacity: 100, angle: 90 } });
  // Light from above: the shadow is along the top inside edge.
  expect((await compositePixel(page, 150, 102))[0]).toBeLessThan(100);
  expect(await compositePixel(page, 150, 196)).toEqual(RED);
  await setStyles(page, { bevel: { size: 10, angle: 90, altitude: 30, highlightColor: '#ffffff', highlightOpacity: 100 } });
  const top = await compositePixel(page, 150, 103);
  const bottom = await compositePixel(page, 150, 197);
  // Lit from above: the top bevel is lighter, the bottom darker.
  expect(top[1]).toBeGreaterThan(40);
  expect(bottom[0]).toBeLessThan(200);
  expect(await compositePixel(page, 150, 150)).toEqual(RED);
});

test('the Layer Style dialog previews live; Cancel restores, OK records one step', async ({ page }) => {
  await square(page);
  await page.click('.layers-footer button[title="Add a layer style"]');
  await expect(page.locator('.modal')).toContainText('Layer Style');
  await page.check('.fx-row input[aria-label="Stroke"]');
  await expect.poll(() => compositePixel(page, 98, 150)).toEqual([0, 0, 0, 255]);
  await page.keyboard.press('Escape');
  expect(await compositePixel(page, 98, 150)).toEqual(WHITE);
  expect(await page.evaluate(() => photoforge.doc.activeLayer.styles)).toBe(null);

  await page.evaluate(() => photoforge.runAction('layer.style.stroke'));
  const size = page.locator('.modal input[type=number][aria-label="Size"]');
  await size.fill('10');
  await size.press('Tab');
  await page.click('.modal .btn-primary');
  expect(await currentLabel(page)).toBe('Layer Style');
  expect(await compositePixel(page, 92, 150)).toEqual([0, 0, 0, 255]);

  // Copy the style to another layer.
  await page.evaluate(() => photoforge.runAction('layer.style.copy'));
  await page.evaluate(() => {
    const l = photoforge.doc.newLayer();
    l.ctx.fillStyle = '#00ff00';
    l.ctx.fillRect(250, 20, 40, 40);
    photoforge.changed({ structure: true });
    photoforge.runAction('layer.style.paste');
  });
  expect(await compositePixel(page, 245, 40)).toEqual([0, 0, 0, 255]);
  await page.evaluate(() => photoforge.runAction('layer.style.clear'));
  expect(await compositePixel(page, 245, 40)).toEqual(WHITE);
});

test('Merge Down bakes the style into the pixels', async ({ page }) => {
  await square(page);
  await setStyles(page, { stroke: { size: 5, color: '#0000ff' } });
  const before = await compositePixel(page, 97, 150);
  await page.keyboard.press('Control+e');
  expect(await currentLabel(page)).toBe('Merge Down');
  expect(await compositePixel(page, 97, 150)).toEqual(before);
  expect(await page.evaluate(() => photoforge.doc.layers.length)).toBe(1);
});

test('painting on a styled layer keeps the preview and the result', async ({ page }) => {
  await square(page);
  await setStyles(page, { stroke: { size: 3, color: '#0000ff' } });
  await page.keyboard.press('b');
  await page.evaluate(() => photoforge.setColor('fg', '#ff0000'));
  await drag(page, [300, 250], [350, 250], { steps: 5 });
  expect(await currentLabel(page)).toBe('Brush');
  // The new stroke has a blue outline below it.
  const below = await compositePixel(page, 325, 265);
  expect(below[2]).toBeGreaterThan(150);
});
