import { test, expect, newDoc, patternDoc, drag, layerPixel, currentLabel } from './helpers.js';


const selBounds = (page) => page.evaluate(() => photoforge.doc.selection.bounds);

test('rectangular marquee limits fills to the selection', async ({ page }) => {
  await newDoc(page);
  await page.evaluate(() => photoforge.setColor('fg', '#0000ff'));
  await page.keyboard.press('m');
  await drag(page, [100, 100], [300, 250]);
  expect(await selBounds(page)).toEqual({ x: 100, y: 100, w: 200, h: 150 });
  await page.keyboard.press('Alt+Backspace');
  expect(await layerPixel(page, 200, 200)).toEqual([0, 0, 255, 255]);
  expect(await layerPixel(page, 350, 200)).toEqual([255, 255, 255, 255]);
});

test('marquee modes: Shift adds, Alt subtracts, click deselects', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('m');
  await drag(page, [100, 100], [200, 200]);
  await drag(page, [150, 150], [300, 300], { modifiers: ['Shift'] });
  expect(await selBounds(page)).toEqual({ x: 100, y: 100, w: 200, h: 200 });
  await drag(page, [100, 100], [300, 180], { modifiers: ['Alt'] });
  expect(await selBounds(page)).toEqual({ x: 100, y: 180, w: 200, h: 120 });
  await drag(page, [500, 500], [500, 500]);
  expect(await selBounds(page)).toBeNull();
  expect(await currentLabel(page)).toBe('Deselect');
});

test('elliptical marquee, inverse and clear', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('Shift+m');
  expect(await page.evaluate(() => photoforge.tool.id)).toBe('marquee-ellipse');
  await drag(page, [100, 50], [500, 350]);
  await page.keyboard.press('Control+Shift+i');
  await page.keyboard.press('Delete');
  expect((await layerPixel(page, 5, 5))[3]).toBe(0);
  expect((await layerPixel(page, 300, 200))[3]).toBe(255);
});

test('move tool moves selected pixels and Alt-drag copies them', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('m');
  await drag(page, [100, 100], [250, 250]);
  await page.keyboard.press('v');
  await drag(page, [150, 150], [150, 300]);
  expect((await layerPixel(page, 120, 120))[3]).toBe(0);
  expect(await layerPixel(page, 175, 300)).toEqual([255, 255, 255, 255]);
  expect(await selBounds(page)).toEqual({ x: 100, y: 250, w: 150, h: 150 });
  await drag(page, [150, 300], [450, 300], { modifiers: ['Alt'] });
  expect(await layerPixel(page, 175, 300)).toEqual([255, 255, 255, 255]);
  expect(await layerPixel(page, 475, 300)).toEqual([255, 255, 255, 255]);
});

test('move tool moves the whole layer and arrow keys nudge it', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.keyboard.press('v');
  await drag(page, [100, 100], [130, 140]);
  expect(await page.evaluate(() => [photoforge.doc.activeLayer.x, photoforge.doc.activeLayer.y])).toEqual([30, 40]);
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await page.evaluate(() => photoforge.doc.activeLayer.x)).toBe(20);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => [photoforge.doc.activeLayer.x, photoforge.doc.activeLayer.y])).toEqual([0, 0]);
});

test('copy and paste put the pixels on a new layer in place', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('m');
  await drag(page, [100, 100], [250, 250]);
  await page.keyboard.press('Control+c');
  await page.evaluate(() => photoforge.runAction('edit.paste'));
  await expect(page.locator('.layer-row')).toHaveCount(2);
  expect(await page.evaluate(() => photoforge.doc.activeLayer.bounds)).toEqual({ x: 100, y: 100, w: 150, h: 150 });
});

test('select all, deselect and reselect', async ({ page }) => {
  await newDoc(page, { width: 300, height: 200 });
  await page.keyboard.press('Control+a');
  expect(await selBounds(page)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  await page.keyboard.press('Control+d');
  expect(await selBounds(page)).toBeNull();
  await page.keyboard.press('Control+Shift+d');
  expect(await selBounds(page)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
});
