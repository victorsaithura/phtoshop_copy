import { test, expect, newDoc, patternDoc, drag, clickDoc, screenPoint, layerPixel, currentLabel, close } from './helpers.js';

const selBounds = (page) => page.evaluate(() => photoforge.doc.selection.bounds);
const useTool = (page, id) => page.evaluate((id) => photoforge.setTool(id), id);

/** Grey document with a small black spot at (200, 150). */
async function spotDoc(page) {
  await newDoc(page, { width: 400, height: 300, background: '#808080' });
  await page.evaluate(() => {
    const c = photoforge.doc.activeLayer.ctx;
    c.fillStyle = '#000000';
    c.beginPath();
    c.arc(200, 150, 6, 0, Math.PI * 2);
    c.fill();
  });
}

test('lasso selects a freehand area', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('l');
  const pts = [[100, 100], [300, 100], [300, 300], [100, 300], [100, 110]];
  const first = await screenPoint(page, ...pts[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const s = await screenPoint(page, ...p);
    await page.mouse.move(s.x, s.y, { steps: 6 });
  }
  await page.mouse.up();
  const b = await selBounds(page);
  expect(b.x).toBeGreaterThanOrEqual(99);
  expect(b.w).toBeGreaterThan(190);
  expect(await currentLabel(page)).toBe('Lasso');
});

test('polygonal lasso closes on the first corner and Enter; Backspace removes a corner', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('Shift+l');
  expect(await page.evaluate(() => photoforge.tool.id)).toBe('polygon-lasso');
  for (const [x, y] of [[100, 100], [300, 100], [300, 250]]) {
    await clickDoc(page, x, y);
    await page.waitForTimeout(350);
  }
  await clickDoc(page, 100, 100);
  const b = await selBounds(page);
  for (const [v, want] of [[b.x, 100], [b.y, 100], [b.w, 200], [b.h, 150]]) expect(Math.abs(v - want)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Control+d');
  for (const [x, y] of [[50, 50], [150, 50], [400, 400], [150, 150]]) {
    await clickDoc(page, x, y);
    await page.waitForTimeout(350);
  }
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => photoforge.doc.selection.isEmpty())).toBe(true);
});

test('magic wand selects similar colours; Shift adds', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('w');
  await clickDoc(page, 150, 150);
  expect(await selBounds(page)).toEqual({ x: 100, y: 100, w: 150, h: 150 });
  await clickDoc(page, 420, 200, { modifiers: ['Shift'] });
  expect(await selBounds(page)).toEqual({ x: 100, y: 100, w: 400, h: 180 });
});

test('clone stamp needs a source, then copies from it', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('s');
  await drag(page, [500, 300], [520, 300]);
  await expect(page.locator('#toast')).toContainText('Alt-click');
  await clickDoc(page, 175, 175, { modifiers: ['Alt'] });
  await drag(page, [470, 350], [490, 350]);
  expect(close(await layerPixel(page, 480, 350), [255, 255, 255, 255], 6)).toBe(true);
  expect(await currentLabel(page)).toBe('Clone Stamp');
});

test('spot healing removes a small blemish', async ({ page }) => {
  await spotDoc(page);
  await useTool(page, 'spot-heal');
  await drag(page, [194, 150], [206, 150], { steps: 4 });
  const px = await layerPixel(page, 200, 150);
  expect(close(px, [128, 128, 128, 255], 12)).toBe(true);
  expect(await currentLabel(page)).toBe('Spot Healing Brush');
});

test('healing brush blends the source into the destination', async ({ page }) => {
  await spotDoc(page);
  await useTool(page, 'heal');
  await clickDoc(page, 80, 80, { modifiers: ['Alt'] });
  await drag(page, [195, 150], [205, 150], { steps: 4 });
  expect(close(await layerPixel(page, 200, 150), [128, 128, 128, 255], 12)).toBe(true);
});

test('dodge lightens, burn darkens, sponge desaturates', async ({ page }) => {
  await newDoc(page, { width: 400, height: 300, background: '#808080' });
  await useTool(page, 'dodge');
  await drag(page, [50, 50], [150, 50]);
  expect((await layerPixel(page, 100, 50))[0]).toBeGreaterThan(140);
  await useTool(page, 'burn');
  await drag(page, [50, 150], [150, 150]);
  expect((await layerPixel(page, 100, 150))[0]).toBeLessThan(115);
  await page.evaluate(() => photoforge.setColor('fg', '#ff2020'));
  await page.keyboard.press('Alt+Backspace');
  await useTool(page, 'sponge');
  await drag(page, [250, 150], [350, 150]);
  const [r, g] = await layerPixel(page, 300, 150);
  expect(r - g).toBeLessThan(200);
});

test('blur softens an edge and smudge drags colour', async ({ page }) => {
  await patternDoc(page);
  await useTool(page, 'blur');
  await page.evaluate(() => photoforge.setToolOption(photoforge.tool, 'strength', 1));
  await drag(page, [250, 120], [250, 220]);
  const edge = await layerPixel(page, 250, 170);
  expect(edge[0]).toBeLessThan(250);
  await useTool(page, 'smudge');
  await drag(page, [420, 200], [560, 200], { steps: 20 });
  const smeared = await layerPixel(page, 520, 200);
  expect(smeared[2]).toBeLessThan(200);
  expect(await currentLabel(page)).toBe('Smudge');
});
