import { test, expect, newDoc, drag, currentLabel, compositePixel } from './helpers.js';

/** New doc with a 100×50 red rectangle on its own layer at (100, 100). */
async function rectLayer(page) {
  await newDoc(page, { width: 600, height: 400 });
  await page.evaluate(() => photoforge.setColor('fg', '#ff0000'));
  await page.keyboard.press('u');
  await drag(page, [100, 100], [200, 150]);
  await page.evaluate(() => photoforge.resetColors());
}

const content = (page) => page.evaluate(async () =>
  (await import('./js/core/transform.js')).contentBounds(photoforge.doc.activeLayer));

const near = (a, b, tol = 3) => Object.keys(b).every((k) => Math.abs(a[k] - b[k]) <= tol);

test('scale proportionally from a corner handle and apply with Enter', async ({ page }) => {
  await rectLayer(page);
  await page.keyboard.press('v');
  await page.keyboard.press('Control+t');
  expect(await page.evaluate(() => photoforge.tool.id)).toBe('transform');
  await drag(page, [200, 150], [300, 200]);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => photoforge.tool.id)).toBe('move');
  expect(await currentLabel(page)).toBe('Free Transform');
  const b = await content(page);
  expect(near(b, { x: 100, y: 100, w: 200, h: 100 })).toBe(true);
  await page.keyboard.press('Control+z');
  expect(near(await content(page), { x: 100, y: 100, w: 100, h: 50 })).toBe(true);
});

test('Shift scales freely; dragging inside moves', async ({ page }) => {
  await rectLayer(page);
  await page.keyboard.press('Control+t');
  await drag(page, [200, 150], [400, 160], { modifiers: ['Shift'] });
  await drag(page, [250, 120], [250, 220]);
  await page.keyboard.press('Enter');
  expect(near(await content(page), { x: 100, y: 200, w: 300, h: 60 })).toBe(true);
});

test('rotate by dragging outside the box, snapped with Shift', async ({ page }) => {
  await rectLayer(page);
  await page.keyboard.press('Control+t');
  // Centre is (150, 125); drag from the right of it to straight below it = 90°.
  await drag(page, [260, 125], [150, 260], { modifiers: ['Shift'], steps: 12 });
  expect(await page.evaluate(() => photoforge.tool.t.angle)).toBe(90);
  await page.keyboard.press('Enter');
  expect(near(await content(page), { x: 125, y: 75, w: 50, h: 100 })).toBe(true);
});

test('Esc discards; switching tools applies', async ({ page }) => {
  await rectLayer(page);
  await page.keyboard.press('Control+t');
  await drag(page, [150, 125], [350, 125]);
  await page.keyboard.press('Escape');
  expect(await currentLabel(page)).toBe('Rectangle');
  expect(near(await content(page), { x: 100, y: 100, w: 100, h: 50 })).toBe(true);
  await page.keyboard.press('Control+t');
  await drag(page, [150, 125], [350, 125]);
  await page.keyboard.press('b');
  expect(await currentLabel(page)).toBe('Free Transform');
  expect(near(await content(page), { x: 300, y: 100, w: 100, h: 50 })).toBe(true);
});

test('a layer mask is transformed with its layer', async ({ page }) => {
  await rectLayer(page);
  await page.keyboard.press('m');
  await drag(page, [100, 100], [150, 150]);
  await page.evaluate(() => photoforge.runAction('mask.revealSelection'));
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+t');
  await drag(page, [150, 125], [350, 125]);
  await page.keyboard.press('Enter');
  expect(await compositePixel(page, 325, 125)).toEqual([255, 0, 0, 255]);
  expect(await compositePixel(page, 375, 125)).toEqual([255, 255, 255, 255]);
});
