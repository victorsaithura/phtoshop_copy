import { test, expect, newDoc, drag, clickDoc, layerPixel, currentLabel } from './helpers.js';

const active = (page) => page.evaluate(() => {
  const l = photoforge.doc.activeLayer;
  return { name: l.name, text: l.text, bounds: l.bounds };
});

/** Count of non-transparent pixels on the active layer. */
const inkCount = (page) => page.evaluate(() => {
  const l = photoforge.doc.activeLayer;
  const d = l.ctx.getImageData(0, 0, l.width, l.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
  return n;
});

test('type a new text layer, edit it and undo the edit', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('t');
  await clickDoc(page, 100, 120);
  await expect(page.locator('.text-editor')).toBeFocused();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.text-editor')).toHaveCount(0);
  let layer = await active(page);
  expect(layer.name).toBe('Hello');
  expect(layer.text.content).toBe('Hello');
  expect(await inkCount(page)).toBeGreaterThan(50);
  expect(await currentLabel(page)).toBe('Type Layer');

  // Click the text to edit it; clicking away commits.
  await clickDoc(page, layer.bounds.x + 10, layer.bounds.y + layer.bounds.h / 2);
  await expect(page.locator('.text-editor')).toHaveValue('Hello');
  await page.keyboard.press('End');
  await page.keyboard.type(' World');
  await clickDoc(page, 600, 500);
  layer = await active(page);
  expect(layer.text.content).toBe('Hello World');
  expect(await currentLabel(page)).toBe('Edit Type Layer');
  await page.keyboard.press('Control+z');
  expect((await active(page)).text.content).toBe('Hello');
});

test('typing straight after the click keeps every character', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('t');
  await clickDoc(page, 100, 120);
  await page.keyboard.type('PhotoForge Editing');
  await page.keyboard.press('Control+Enter');
  expect((await active(page)).text.content).toBe('PhotoForge Editing');
  expect(await page.evaluate(() => photoforge.tool.id)).toBe('text');
});

test('Esc cancels new text; options change the selected type layer', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('t');
  await clickDoc(page, 100, 100);
  await page.keyboard.type('Gone');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => photoforge.doc.layers.length)).toBe(1);

  await clickDoc(page, 100, 300);
  await page.keyboard.type('Big');
  await page.keyboard.press('Control+Enter');
  const before = (await active(page)).bounds.h;
  await page.fill('#optionsbar .num-input', '96');
  await page.press('#optionsbar .num-input', 'Enter');
  const after = await active(page);
  expect(after.text.size).toBe(96);
  expect(after.bounds.h).toBeGreaterThan(before * 1.5);
});

test('type layers must be rasterized before painting', async ({ page }) => {
  await newDoc(page);
  await page.keyboard.press('t');
  await clickDoc(page, 100, 100);
  await page.keyboard.type('Paint me');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('b');
  await drag(page, [100, 100], [200, 100]);
  await expect(page.locator('#toast')).toContainText('rasterized');
  await page.evaluate(() => photoforge.runAction('layer.rasterize'));
  expect((await active(page)).text).toBeNull();
  await drag(page, [100, 100], [200, 100]);
  expect(await currentLabel(page)).toBe('Brush');
});

test('image size scales type and keeps it editable', async ({ page }) => {
  await newDoc(page, { width: 800, height: 600 });
  await page.keyboard.press('t');
  await clickDoc(page, 100, 100);
  await page.keyboard.type('Scale');
  await page.keyboard.press('Control+Enter');
  await page.evaluate(async () => (await import('./js/core/transform.js')).resizeImage(photoforge, 400, 300));
  const layer = await active(page);
  expect(layer.text.size).toBe(24);
  expect(layer.text.content).toBe('Scale');
});

test('rectangle, ellipse, polygon and line each make a new layer', async ({ page }) => {
  await newDoc(page, { width: 800, height: 600 });
  await page.evaluate(() => photoforge.setColor('fg', '#ff0000'));
  await page.keyboard.press('u');
  expect(await page.evaluate(() => photoforge.tool.id)).toBe('shape-rect');
  await drag(page, [100, 100], [300, 200]);
  expect((await active(page)).name).toBe('Rectangle 1');
  expect(await layerPixel(page, 200, 150)).toEqual([255, 0, 0, 255]);

  await page.keyboard.press('Shift+u');
  await page.selectOption('#optionsbar select >> nth=0', 'none');
  await page.selectOption('#optionsbar select >> nth=1', '#000000');
  await drag(page, [400, 100], [600, 300]);
  expect((await active(page)).name).toBe('Ellipse 1');
  expect((await layerPixel(page, 500, 200))[3]).toBe(0);
  expect((await layerPixel(page, 500, 101))[3]).toBeGreaterThan(100);

  await page.keyboard.press('Shift+u');
  await drag(page, [100, 300], [300, 500]);
  expect((await active(page)).name).toBe('Polygon 1');

  await page.keyboard.press('Shift+u');
  await drag(page, [400, 400], [700, 400]);
  expect((await active(page)).name).toBe('Line 1');
  expect(await layerPixel(page, 550, 400)).toEqual([255, 0, 0, 255]);
  expect(await page.evaluate(() => photoforge.doc.layers.length)).toBe(5);
});
