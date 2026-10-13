import {
  test, expect, newDoc, patternDoc, drag, clickDoc, layerPixel, compositePixel, historyLabels, currentLabel,
} from './helpers.js';


test('brush paints with the foreground colour, and undo/redo restore it', async ({ page }) => {
  await newDoc(page);
  await page.evaluate(() => photoforge.setColor('fg', '#ff0000'));
  await page.keyboard.press('b');
  await drag(page, [100, 100], [500, 300]);
  expect(await layerPixel(page, 300, 200)).toEqual([255, 0, 0, 255]);
  expect(await historyLabels(page)).toEqual(['New', 'Brush']);
  await page.keyboard.press('Control+z');
  expect(await layerPixel(page, 300, 200)).toEqual([255, 255, 255, 255]);
  await page.keyboard.press('Control+Shift+z');
  expect(await layerPixel(page, 300, 200)).toEqual([255, 0, 0, 255]);
});

test('brush size and opacity shortcuts', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('b');
  const size = () => page.evaluate(() => photoforge.tool.options.size);
  await page.evaluate(() => photoforge.setToolOption(photoforge.tool, 'size', 20, true));
  await page.keyboard.press(']');
  expect(await size()).toBe(30);
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  expect(await size()).toBe(10);
  await page.keyboard.press('[');
  expect(await size()).toBe(9);
  await page.keyboard.press('5');
  expect(await page.evaluate(() => photoforge.tool.options.opacity)).toBe(0.5);
  await page.keyboard.press('0');
});

test('pencil draws hard pixels and the eraser makes them transparent', async ({ page }) => {
  await newDoc(page, { background: 'transparent' });
  await page.evaluate(() => photoforge.setColor('fg', '#00ff00'));
  await page.keyboard.press('Shift+b');
  expect(await page.evaluate(() => photoforge.tool.id)).toBe('pencil');
  await drag(page, [50, 50], [400, 50]);
  expect(await layerPixel(page, 200, 50)).toEqual([0, 255, 0, 255]);
  await page.keyboard.press('e');
  await drag(page, [150, 50], [250, 50]);
  expect((await layerPixel(page, 200, 50))[3]).toBe(0);
  expect(await historyLabels(page)).toEqual(['New', 'Pencil', 'Eraser']);
});

test('painting a locked or hidden layer is refused with a message', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('Control+Slash');
  await page.keyboard.press('b');
  await drag(page, [100, 100], [200, 200]);
  await expect(page.locator('#toast')).toContainText('locked');
  expect(await historyLabels(page)).toEqual(['New', 'Lock Layer']);
});

test('gradient fills the selection', async ({ page }) => {
  await newDoc(page);
  await page.evaluate(() => photoforge.resetColors());
  await page.keyboard.press('m');
  await drag(page, [100, 100], [300, 300]);
  await page.keyboard.press('g');
  await drag(page, [100, 200], [300, 200]);
  const left = await layerPixel(page, 102, 200);
  const right = await layerPixel(page, 298, 200);
  expect(left[0]).toBeLessThan(20);
  expect(right[0]).toBeGreaterThan(235);
  expect(await layerPixel(page, 50, 50)).toEqual([255, 255, 255, 255]);
});

test('paint bucket fills a contiguous area only', async ({ page }) => {
  await patternDoc(page);
  await page.evaluate(() => photoforge.setColor('fg', '#123456'));
  await page.keyboard.press('Shift+g');
  expect(await page.evaluate(() => photoforge.tool.id)).toBe('bucket');
  await clickDoc(page, 150, 150);
  expect(await layerPixel(page, 175, 175)).toEqual([0x12, 0x34, 0x56, 255]);
  expect(await layerPixel(page, 420, 200)).toEqual([0, 0, 0, 255]);
  expect(await currentLabel(page)).toBe('Paint Bucket');
});

test('eyedropper picks foreground, Alt picks background', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('i');
  await clickDoc(page, 420, 200);
  expect(await page.evaluate(() => photoforge.colors.fg)).toBe('#000000');
  await clickDoc(page, 150, 150, { modifiers: ['Alt'] });
  expect(await page.evaluate(() => photoforge.colors.bg)).toBe('#ffffff');
  await page.keyboard.press('x');
  expect(await page.evaluate(() => photoforge.colors.fg)).toBe('#ffffff');
});

test('history panel jumps between states', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('b');
  await drag(page, [100, 100], [200, 100]);
  await drag(page, [100, 200], [200, 200]);
  await page.click('.history-item >> nth=0');
  expect(await compositePixel(page, 150, 100)).toEqual([255, 255, 255, 255]);
  await page.click('.history-item >> nth=2');
  expect(await compositePixel(page, 150, 200)).toEqual([0, 0, 0, 255]);
});
