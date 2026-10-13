import { test, expect, patternDoc, drag, layerPixel, docSize } from './helpers.js';

test('crop tool: new box, handle drag, Enter, undo', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('c');
  await drag(page, [-20, -20], [300, 200]);
  await drag(page, [300, 200], [350, 260]);
  expect(await page.evaluate(() => photoforge.tool.rect)).toEqual({ x: -20, y: -20, w: 370, h: 280 });
  await page.keyboard.press('Enter');
  expect(await docSize(page)).toEqual([370, 280]);
  await page.keyboard.press('Control+z');
  expect(await docSize(page)).toEqual([600, 400]);
});

test('crop tool with a fixed ratio and double-click', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('c');
  await page.selectOption('#optionsbar select', '1:1');
  const box = await page.locator('#view').boundingBox();
  const mid = await page.evaluate(() => photoforge.view.docToScreen(300, 200));
  await page.mouse.dblclick(box.x + mid.x, box.y + mid.y);
  expect(await docSize(page)).toEqual([400, 400]);
});

test('image size, canvas size and crop to selection', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('Control+Alt+i');
  await page.fill('.modal input[type=number] >> nth=0', '300');
  await page.click('.modal .btn-primary');
  expect(await docSize(page)).toEqual([300, 200]);
  await page.keyboard.press('Control+Alt+c');
  await page.fill('.modal input[type=number] >> nth=0', '400');
  await page.fill('.modal input[type=number] >> nth=1', '300');
  await page.selectOption('.modal select', '#ffffff');
  await page.click('.modal .btn-primary');
  expect(await docSize(page)).toEqual([400, 300]);
  expect(await layerPixel(page, 2, 2)).toEqual([255, 255, 255, 255]);
  await page.keyboard.press('m');
  await drag(page, [50, 60], [250, 160]);
  await page.evaluate(() => photoforge.runAction('image.crop'));
  expect(await docSize(page)).toEqual([200, 100]);
});

test('rotate and flip the canvas, transform a layer', async ({ page }) => {
  await patternDoc(page);
  await page.evaluate(() => photoforge.runAction('image.rotateCW'));
  expect(await docSize(page)).toEqual([400, 600]);
  // The white square (100..250, 100..250) moves to x 150..300, y 100..250 after a clockwise turn.
  expect(await layerPixel(page, 200, 150)).toEqual([255, 255, 255, 255]);
  await page.keyboard.press('Control+z');
  await page.evaluate(() => photoforge.runAction('image.flipH'));
  expect(await layerPixel(page, 600 - 175, 175)).toEqual([255, 255, 255, 255]);
  await page.evaluate(async () => (await import('./js/core/transform.js')).rotateDocument(photoforge, 30));
  const [w, h] = await docSize(page);
  expect(w).toBeGreaterThan(600);
  expect(h).toBeGreaterThan(400);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.keyboard.press('m');
  await drag(page, [0, 0], [100, 50]);
  await page.keyboard.press('Alt+Backspace');
  await page.keyboard.press('Control+d');
  await page.evaluate(() => photoforge.runAction('transform.rot90cw'));
  const content = await page.evaluate(async () =>
    (await import('./js/core/transform.js')).contentBounds(photoforge.doc.activeLayer));
  expect(content).toEqual({ x: 25, y: -25, w: 50, h: 100 });
});
