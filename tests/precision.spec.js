import { test, expect, newDoc, patternDoc, drag, clickDoc, screenPoint, currentLabel, compositePixel } from './helpers.js';

const selBounds = (page) => page.evaluate(() => photoforge.doc.selection.bounds);
const guides = (page) => page.evaluate(() => photoforge.doc.guides);
const alphaAt = (page, x, y) => page.evaluate(([x, y]) => {
  const s = photoforge.doc.selection;
  return s.alpha ? s.alpha[y * s.width + x] : 0;
}, [x, y]);

/** Screen point on the top (or left) ruler at a document position. */
async function rulerPoint(page, axis, at) {
  const box = await page.locator('#view').boundingBox();
  const p = await screenPoint(page, at, at);
  return axis === 'top' ? { x: p.x, y: box.y + 9 } : { x: box.x + 9, y: p.y };
}

async function dragFromRuler(page, axis, to) {
  const a = await rulerPoint(page, axis, 50);
  const b = await screenPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

test('rulers: drag out a guide, move it, drag it back to delete it', async ({ page }) => {
  await newDoc(page, { width: 400, height: 300 });
  await page.keyboard.press('Control+r');
  expect(await page.evaluate(() => photoforge.viewOptions.rulers)).toBe(true);
  await dragFromRuler(page, 'top', [200, 120]);
  expect(await guides(page)).toEqual([{ o: 'h', p: 120 }]);
  expect(await currentLabel(page)).toBe('New Guide');
  await dragFromRuler(page, 'left', [77, 200]);
  expect(await guides(page)).toEqual([{ o: 'h', p: 120 }, { o: 'v', p: 77 }]);

  // With the Move tool, drag the horizontal guide down; dragging onto the ruler removes it.
  await page.keyboard.press('v');
  await drag(page, [250, 120], [250, 180]);
  expect(await guides(page)).toEqual([{ o: 'h', p: 180 }, { o: 'v', p: 77 }]);
  expect(await currentLabel(page)).toBe('Move Guide');
  const g = await screenPoint(page, 300, 180);
  const ruler = await rulerPoint(page, 'top', 300);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(ruler.x, ruler.y, { steps: 6 });
  await page.mouse.up();
  expect(await guides(page)).toEqual([{ o: 'v', p: 77 }]);
  expect(await currentLabel(page)).toBe('Delete Guide');
  await page.keyboard.press('Control+z');
  expect((await guides(page)).length).toBe(2);
  await page.evaluate(() => photoforge.runAction('view.clearGuides'));
  expect(await guides(page)).toEqual([]);
  await page.keyboard.press('Control+r');
});

test('selections, shapes and moves snap to guides, the grid and the canvas edge', async ({ page }) => {
  await newDoc(page, { width: 400, height: 300 });
  await page.evaluate(() => {
    photoforge.transact('New Guide', { structure: true }, () => photoforge.doc.guides.push({ o: 'v', p: 200 }));
  });
  // Marquee starting 5 px from the guide starts on it; ending 4 px from the edge ends on it.
  await page.keyboard.press('m');
  await drag(page, [195, 50], [396, 120]);
  expect(await selBounds(page)).toEqual({ x: 200, y: 50, w: 200, h: 70 });
  await page.keyboard.press('Control+d');

  // Grid (100 px, 4 subdivisions = every 25 px).
  await page.keyboard.press("Control+'");
  expect(await page.evaluate(() => photoforge.viewOptions.grid)).toBe(true);
  await drag(page, [20, 230], [79, 278]);
  expect(await selBounds(page)).toEqual({ x: 25, y: 225, w: 50, h: 50 });
  await page.keyboard.press('Control+d');
  await page.keyboard.press("Control+'");

  // Move tool: a square's left edge snaps onto the guide.
  await page.evaluate(() => {
    const l = photoforge.doc.newLayer();
    l.ctx.fillStyle = '#ff0000';
    l.ctx.fillRect(100, 150, 50, 50);
    photoforge.changed({ structure: true });
  });
  await page.keyboard.press('v');
  await drag(page, [120, 170], [215, 170]);
  expect(await compositePixel(page, 201, 170)).toEqual([255, 0, 0, 255]);
  expect(await compositePixel(page, 199, 170)).toEqual([255, 255, 255, 255]);

  // Snapping off: no pull.
  await page.evaluate(() => photoforge.runAction('view.snap'));
  await page.keyboard.press('m');
  await drag(page, [195, 50], [300, 120]);
  expect((await selBounds(page)).x).toBe(195);
  await page.evaluate(() => photoforge.runAction('view.snap'));
});

/** Run a Select ▸ Modify command through its dialog. */
async function modify(page, id, amount) {
  await page.evaluate((id) => photoforge.runAction(id), id);
  await page.fill('.modal input[type=number]', String(amount));
  await page.click('.modal .btn-primary');
}

test('Select ▸ Modify: expand, contract, border, smooth and feather', async ({ page }) => {
  await newDoc(page, { width: 400, height: 300 });
  await page.keyboard.press('m');
  await drag(page, [100, 100], [200, 200]);
  await modify(page, 'select.expand', 10);
  expect(await selBounds(page)).toEqual({ x: 90, y: 90, w: 120, h: 120 });
  expect(await currentLabel(page)).toBe('Expand Selection');
  await modify(page, 'select.contract', 20);
  expect(await selBounds(page)).toEqual({ x: 110, y: 110, w: 80, h: 80 });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await selBounds(page)).toEqual({ x: 100, y: 100, w: 100, h: 100 });

  await modify(page, 'select.border', 10);
  expect(await alphaAt(page, 150, 150)).toBe(0);
  expect(await alphaAt(page, 100, 150)).toBeGreaterThan(200);
  await page.keyboard.press('Control+z');

  // A stray selected pixel disappears with Smooth.
  await page.evaluate(() => {
    photoforge.transact('Add', { selection: true }, () => photoforge.doc.selection.combine((c) => c.fillRect(300, 50, 1, 1), 'add', 0, { x: 300, y: 50, w: 1, h: 1 }));
  });
  expect(await alphaAt(page, 300, 50)).toBe(255);
  await modify(page, 'select.smooth', 3);
  expect(await alphaAt(page, 300, 50)).toBe(0);
  expect(await alphaAt(page, 150, 150)).toBe(255);

  await modify(page, 'select.feather', 10);
  const edge = await alphaAt(page, 100, 150);
  expect(edge).toBeGreaterThan(80);
  expect(edge).toBeLessThan(180);
  expect((await selBounds(page)).x).toBeLessThan(100);
});

test('Color Range selects sampled colours or tones', async ({ page }) => {
  await patternDoc(page);
  await page.evaluate(() => photoforge.runAction('select.colorRange'));
  await expect(page.locator('.modal')).toContainText('Color Range');
  // Click the white square in the preview.
  const box = await page.locator('.cr-preview').boundingBox();
  await page.mouse.click(box.x + (175 / 600) * box.width, box.y + (175 / 400) * box.height);
  await page.click('.modal .btn-primary');
  expect(await selBounds(page)).toEqual({ x: 100, y: 100, w: 150, h: 150 });
  expect(await currentLabel(page)).toBe('Color Range');

  await page.evaluate(() => photoforge.runAction('select.colorRange'));
  await page.selectOption('.modal select[aria-label="Select"]', 'shadows');
  await page.click('.modal .btn-primary');
  // The black disc is fully selected; the white square and bright colours are not.
  expect(await alphaAt(page, 420, 200)).toBe(255);
  expect(await alphaAt(page, 175, 175)).toBe(0);
  expect(await alphaAt(page, 300, 20)).toBe(0);
  expect(await alphaAt(page, 10, 10)).toBeLessThan(128);
});

test('Quick Mask: the selection becomes a mask to paint, then a selection again', async ({ page }) => {
  await newDoc(page, { width: 400, height: 300 });
  await page.keyboard.press('m');
  await drag(page, [100, 100], [200, 200]);
  await page.keyboard.press('q');
  expect(await page.evaluate(() => !!photoforge.doc.quickMask)).toBe(true);
  expect(await page.evaluate(() => photoforge.doc.selection.isEmpty())).toBe(true);
  await expect(page.locator('.quick-mask-btn')).toHaveClass(/active/);
  // The unselected area is tinted red on screen (drawn on the next frame).
  const redness = () => page.evaluate(() => {
    const p = photoforge.view.docToScreen(50, 50);
    const dpr = photoforge.renderer.dpr;
    const d = photoforge.canvas.getContext('2d').getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data;
    return d[0] - d[1];
  });
  await expect.poll(redness).toBeGreaterThan(60);

  // Paint white to add to the selection.
  await page.evaluate(() => photoforge.setColor('fg', '#ffffff'));
  await page.keyboard.press('b');
  await drag(page, [300, 150], [320, 150], { steps: 4 });
  await page.keyboard.press('q');
  expect(await currentLabel(page)).toBe('Exit Quick Mask');
  expect(await page.evaluate(() => !!photoforge.doc.quickMask)).toBe(false);
  expect(await alphaAt(page, 150, 150)).toBe(255);
  expect(await alphaAt(page, 310, 150)).toBeGreaterThan(200);
  expect(await alphaAt(page, 50, 50)).toBe(0);
  // Undo returns to Quick Mask mode.
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => !!photoforge.doc.quickMask)).toBe(true);
  await page.keyboard.press('q');
  await page.evaluate(() => photoforge.resetColors());
});

test('Navigator, Info and Histogram panels', async ({ page }) => {
  await patternDoc(page);
  await page.click('.panel-tab:has-text("Info")');
  const p = await screenPoint(page, 120, 120);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('.info-grid')).toContainText('ffffff');
  await expect(page.locator('.info-grid')).toContainText('120');

  await page.click('.panel-tab:has-text("Histogram")');
  await expect(page.locator('.histo-stats')).toContainText('Mean');
  await page.keyboard.press('m');
  await drag(page, [110, 110], [240, 240]);
  await expect(page.locator('.histo-stats')).toContainText('Mean 255.00');

  await page.click('.panel-tab:has-text("Navigator")');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  const before = await page.evaluate(() => [photoforge.view.panX, photoforge.view.panY]);
  const nav = await page.locator('.nav-canvas').boundingBox();
  await page.mouse.click(nav.x + nav.width * 0.15, nav.y + nav.height * 0.2);
  const after = await page.evaluate(() => [photoforge.view.panX, photoforge.view.panY]);
  expect(after).not.toEqual(before);
  // The view is now centred on the left part of the image.
  const centre = await page.evaluate(() => photoforge.view.screenToDoc(photoforge.view.width / 2, photoforge.view.height / 2));
  expect(centre.x).toBeLessThan(200);
});

test('clicking a guide-less canvas with rulers on still uses the tool', async ({ page }) => {
  await newDoc(page, { width: 400, height: 300 });
  await page.keyboard.press('Control+r');
  await page.keyboard.press('m');
  await drag(page, [100, 100], [150, 150]);
  expect(await selBounds(page)).toEqual({ x: 100, y: 100, w: 50, h: 50 });
  await clickDoc(page, 300, 250);
  expect(await page.evaluate(() => photoforge.doc.selection.isEmpty())).toBe(true);
  await page.keyboard.press('Control+r');
});
