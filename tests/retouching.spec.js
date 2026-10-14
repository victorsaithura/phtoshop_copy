import { test, expect, newDoc, patternDoc, drag, layerPixel, compositePixel, currentLabel } from './helpers.js';

/** Remember the active layer's pixels, to count changes later without copying them out of the page. */
const keep = (page) => page.evaluate(() => {
  const l = photoforge.doc.activeLayer;
  window.__kept = { x: l.x, y: l.y, data: l.ctx.getImageData(0, 0, l.width, l.height).data.slice() };
});

/** Pixels changed since keep(), inside and outside a document rect. */
const changes = (page, rect) => page.evaluate((r) => {
  const l = photoforge.doc.activeLayer;
  const k = window.__kept;
  const now = l.ctx.getImageData(0, 0, l.width, l.height).data;
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < l.height; y++) {
    for (let x = 0; x < l.width; x++) {
      const i = (y * l.width + x) * 4;
      if (now[i] === k.data[i] && now[i + 1] === k.data[i + 1] && now[i + 2] === k.data[i + 2] && now[i + 3] === k.data[i + 3]) continue;
      const dx = x + l.x;
      const dy = y + l.y;
      if (dx >= r.x && dx < r.x + r.w && dy >= r.y && dy < r.y + r.h) inside++;
      else outside++;
    }
  }
  return { inside, outside };
}, rect);

/** New 600×400 document with a 200×200 red square on its own layer at (200, 100). */
async function squareLayer(page) {
  await newDoc(page, { width: 600, height: 400 });
  await page.evaluate(() => {
    const l = photoforge.doc.newLayer();
    l.ctx.fillStyle = '#ff0000';
    l.ctx.fillRect(200, 100, 200, 200);
    photoforge.changed({ structure: true });
  });
}

const red = [255, 0, 0, 255];
const clear = (px) => px[3] === 0;

test('distort filters work inside the selection, centred on it', async ({ page }) => {
  await patternDoc(page);
  await page.keyboard.press('m');
  await drag(page, [300, 100], [460, 260]);
  await keep(page);
  await page.evaluate(() => photoforge.runAction('filter.twirl'));
  await expect(page.locator('.modal')).toContainText('Twirl');
  await page.click('.modal .btn-primary');
  expect(await currentLabel(page)).toBe('Twirl');
  const c = await changes(page, { x: 300, y: 100, w: 160, h: 160 });
  expect(c.outside).toBe(0);
  expect(c.inside).toBeGreaterThan(2000);
  // The twirl fills the circle inside the selection; its corners stay as they were.
  expect(await changes(page, { x: 300, y: 100, w: 12, h: 12 }).then((r) => r.inside)).toBe(0);
});

test('Spherize magnifies the middle and leaves the corners alone', async ({ page }) => {
  await patternDoc(page);
  const corner = await layerPixel(page, 3, 3);
  await page.evaluate(async () => {
    const { FILTERS } = await import('./js/core/filters.js');
    const { runPixelCommand } = await import('./js/ui/adjust-dialog.js');
    runPixelCommand(photoforge, FILTERS.spherize, { id: 'spherize', params: { amount: 100, mode: 'normal' } });
  });
  expect(await currentLabel(page)).toBe('Spherize');
  expect(await layerPixel(page, 3, 3)).toEqual(corner);
  // Near the white square's right edge, the image is pulled out from closer to the centre.
  expect(await layerPixel(page, 245, 175)).not.toEqual([255, 255, 255, 255]);
});

test('Perspective: dragging a corner widens that edge symmetrically', async ({ page }) => {
  await squareLayer(page);
  await page.evaluate(() => photoforge.runAction('transform.perspective'));
  expect(await page.evaluate(() => [photoforge.tool.id, photoforge.tool.t.mode])).toEqual(['transform', 'perspective']);
  await drag(page, [400, 100], [460, 100]);
  await page.keyboard.press('Enter');
  expect(await currentLabel(page)).toBe('Perspective');
  // Top edge now runs 140…460; the bottom edge stays 200…400.
  expect(await layerPixel(page, 150, 104)).toEqual(red);
  expect(await layerPixel(page, 450, 104)).toEqual(red);
  expect(clear(await layerPixel(page, 150, 296))).toBe(true);
  expect(await layerPixel(page, 300, 200)).toEqual(red);
  await page.keyboard.press('Control+z');
  expect(clear(await layerPixel(page, 150, 104))).toBe(true);
});

test('Free Transform: Ctrl-drag a corner to distort, Ctrl+Shift-drag a side to skew', async ({ page }) => {
  await squareLayer(page);
  await page.keyboard.press('Control+t');
  await drag(page, [400, 300], [480, 360], { modifiers: ['Control'] });
  await page.keyboard.press('Enter');
  expect(await currentLabel(page)).toBe('Free Transform');
  expect(await layerPixel(page, 470, 350)).toEqual(red);
  expect(clear(await layerPixel(page, 412, 120))).toBe(true);
  expect(await layerPixel(page, 395, 120)).toEqual(red);

  await squareLayer(page);
  await page.keyboard.press('Control+t');
  await drag(page, [300, 100], [360, 100], { modifiers: ['Control', 'Shift'] });
  await page.keyboard.press('Enter');
  // The top edge slid right: a parallelogram.
  expect(clear(await layerPixel(page, 210, 104))).toBe(true);
  expect(await layerPixel(page, 450, 104)).toEqual(red);
  expect(await layerPixel(page, 210, 296)).toEqual(red);
});

test('Edit ▸ Transform ▸ Skew and Distort, and switching modes in the options bar', async ({ page }) => {
  await squareLayer(page);
  await page.evaluate(() => photoforge.runAction('transform.skew'));
  await drag(page, [400, 200], [400, 260]);
  await page.selectOption('select[aria-label="Mode"]', 'distort');
  expect(await page.evaluate(() => photoforge.tool.t.mode)).toBe('distort');
  await drag(page, [200, 100], [170, 70]);
  await page.keyboard.press('Enter');
  expect(await currentLabel(page)).toBe('Skew');
  expect(await layerPixel(page, 176, 76)).toEqual(red);
  // The right edge moved down 60 px.
  expect(await layerPixel(page, 396, 355)).toEqual(red);
  expect(clear(await layerPixel(page, 396, 112))).toBe(true);
});

test('Warp: a preset bends the layer; Esc cancels and Enter applies', async ({ page }) => {
  await squareLayer(page);
  await page.evaluate(() => photoforge.runAction('transform.warp'));
  await page.selectOption('select[aria-label="Warp"]', 'arc');
  await expect(page.locator('input[aria-label="Bend"]')).toBeVisible();
  // Esc throws the warp away.
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => photoforge.tool.id)).toBe('move');
  expect(await layerPixel(page, 300, 104)).toEqual(red);
  expect(await currentLabel(page)).toBe('New');

  await page.evaluate(() => photoforge.runAction('transform.warp'));
  await page.selectOption('select[aria-label="Warp"]', 'arc');
  await page.keyboard.press('Enter');
  expect(await currentLabel(page)).toBe('Warp');
  // The middle of the top edge rose; the corners stayed.
  expect(await layerPixel(page, 300, 80)).toEqual(red);
  expect(clear(await layerPixel(page, 204, 80))).toBe(true);
  expect(await layerPixel(page, 204, 104)).toEqual(red);
});

test('Warp: dragging the mesh moves that spot and bends the edges with it', async ({ page }) => {
  await squareLayer(page);
  await page.evaluate(() => photoforge.runAction('transform.warp'));
  await drag(page, [300, 200], [300, 260]);
  const centre = await page.evaluate(() => photoforge.tool._surfacePoint(0.5, 0.5, [0, 0]));
  expect(Math.abs(centre[0] - 300)).toBeLessThan(0.5);
  expect(Math.abs(centre[1] - 260)).toBeLessThan(0.5);
  await page.keyboard.press('Enter');
  expect(await currentLabel(page)).toBe('Warp');
  // The top edge sagged in the middle; the pinned corners did not move.
  expect(clear(await layerPixel(page, 300, 110))).toBe(true);
  expect(await layerPixel(page, 206, 110)).toEqual(red);
});

test('a layer mask follows a perspective transform', async ({ page }) => {
  await squareLayer(page);
  await page.keyboard.press('m');
  await drag(page, [300, 50], [450, 350]);
  await page.evaluate(() => photoforge.runAction('mask.revealSelection'));
  await page.keyboard.press('Control+d');
  await page.evaluate(() => photoforge.runAction('transform.perspective'));
  await drag(page, [400, 100], [440, 100]);
  await page.keyboard.press('Enter');
  expect(await compositePixel(page, 230, 200)).toEqual([255, 255, 255, 255]);
  expect(await compositePixel(page, 360, 200)).toEqual(red);
});

/** Page point of an image point in the Liquify preview (fitted and centred when it opens). */
async function liquifyPoint(page, x, y, w = 600, h = 400) {
  const box = await page.locator('.lq-overlay').boundingBox();
  const z = parseFloat(await page.locator('.lq-zoom-label').textContent()) / 100;
  return { x: box.x + box.width / 2 + (x - w / 2) * z, y: box.y + box.height / 2 + (y - h / 2) * z };
}

async function liquifyDrag(page, from, to) {
  const a = await liquifyPoint(page, ...from);
  const b = await liquifyPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 16 });
  await page.mouse.up();
}

test('Liquify: Forward Warp pushes pixels along the stroke', async ({ page }) => {
  await patternDoc(page);
  const below = await layerPixel(page, 175, 290);
  await page.keyboard.press('Control+Shift+x');
  await expect(page.locator('.liquify')).toBeVisible();
  // Drag the middle of the white square downwards.
  await liquifyDrag(page, [175, 175], [175, 300]);
  await page.click('.modal .btn-primary');
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(await currentLabel(page)).toBe('Liquify');
  const px = await layerPixel(page, 175, 290);
  expect(Math.min(px[0], px[1], px[2])).toBeGreaterThan(200);
  await page.keyboard.press('Control+z');
  expect(await layerPixel(page, 175, 290)).toEqual(below);
});

test('Liquify: Freeze Mask protects pixels; undo, Restore All and Cancel leave the layer alone', async ({ page }) => {
  await patternDoc(page);
  const frozen = await layerPixel(page, 175, 290);
  await page.keyboard.press('Control+Shift+x');
  await expect(page.locator('.liquify')).toBeVisible();
  await page.keyboard.press('f');
  const f = await liquifyPoint(page, 175, 290);
  await page.mouse.click(f.x, f.y);
  await page.keyboard.press('w');
  await liquifyDrag(page, [175, 175], [175, 320]);
  await page.click('.modal .btn-primary');
  expect(await currentLabel(page)).toBe('Liquify');
  const px = await layerPixel(page, 175, 290);
  for (let c = 0; c < 4; c++) expect(Math.abs(px[c] - frozen[c])).toBeLessThanOrEqual(8);
  // …while next to the frozen spot the white was pushed down.
  const pushed = await layerPixel(page, 175, 262);
  expect(Math.min(pushed[0], pushed[1], pushed[2])).toBeGreaterThan(200);

  // Undo inside Liquify, then OK: nothing to apply.
  const entries = await page.evaluate(() => photoforge.history.entries.length);
  await page.keyboard.press('Control+Shift+x');
  await liquifyDrag(page, [420, 200], [500, 200]);
  await page.keyboard.press('Control+z');
  await page.click('.modal .btn-primary');
  // Restore All, then OK.
  await page.keyboard.press('Control+Shift+x');
  await liquifyDrag(page, [420, 200], [500, 200]);
  await page.click('.modal button:has-text("Restore All")');
  await page.click('.modal .btn-primary');
  // Cancel.
  await page.keyboard.press('Control+Shift+x');
  await liquifyDrag(page, [420, 200], [500, 200]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(await page.evaluate(() => photoforge.history.entries.length)).toBe(entries);
});

/** Vertical yellow and blue stripes with a black disc in the middle. */
async function stripesWithDisc(page) {
  await newDoc(page, { width: 400, height: 300 });
  await page.evaluate(() => {
    const l = photoforge.doc.activeLayer;
    const g = l.ctx;
    for (let x = 0; x < 400; x += 20) {
      g.fillStyle = (x / 20) % 2 ? '#3070d0' : '#e0c040';
      g.fillRect(x, 0, 20, 300);
    }
    g.fillStyle = '#000000';
    g.beginPath();
    g.arc(200, 150, 30, 0, Math.PI * 2);
    g.fill();
    photoforge.changed({ layers: [l] });
  });
}

/** Number of near-black pixels of the active layer within a rect. */
const darkPixels = (page, r) => page.evaluate((r) => {
  const d = photoforge.doc.activeLayer.ctx.getImageData(r.x, r.y, r.w, r.h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 120) n++;
  return n;
}, r);

test('Content-Aware Fill replaces the selection with texture from around it', async ({ page }) => {
  await stripesWithDisc(page);
  expect(await page.evaluate(() => photoforge.runAction('edit.contentAwareFill'))).toBe(false); // needs a selection
  await page.keyboard.press('m');
  await drag(page, [165, 115], [235, 185]);
  await keep(page);
  await page.evaluate(() => photoforge.runAction('edit.contentAwareFill'));
  await expect.poll(() => currentLabel(page), { timeout: 30_000 }).toBe('Content-Aware Fill');
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(await darkPixels(page, { x: 165, y: 115, w: 70, h: 70 })).toBe(0);
  const c = await changes(page, { x: 165, y: 115, w: 70, h: 70 });
  expect(c.outside).toBe(0);
  // The stripes carry on through the hole: every filled pixel is close to yellow or blue.
  const stray = await page.evaluate(() => {
    const d = photoforge.doc.activeLayer.ctx.getImageData(170, 120, 60, 60).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const yellow = Math.abs(d[i] - 0xe0) + Math.abs(d[i + 1] - 0xc0) + Math.abs(d[i + 2] - 0x40);
      const blue = Math.abs(d[i] - 0x30) + Math.abs(d[i + 1] - 0x70) + Math.abs(d[i + 2] - 0xd0);
      if (Math.min(yellow, blue) > 90) n++;
    }
    return n;
  });
  expect(stray).toBeLessThan(60 * 60 * 0.05);
  await page.keyboard.press('Control+z');
  expect(await layerPixel(page, 200, 150)).toEqual([0, 0, 0, 255]);
});

test('Edit ▸ Fill offers Content-Aware when there is a selection', async ({ page }) => {
  await stripesWithDisc(page);
  await page.keyboard.press('m');
  await drag(page, [165, 115], [235, 185]);
  await page.keyboard.press('Shift+F5');
  await page.selectOption('.modal select >> nth=0', 'content-aware');
  await page.click('.modal .btn-primary');
  await expect.poll(() => currentLabel(page), { timeout: 30_000 }).toBe('Content-Aware Fill');
  expect(await darkPixels(page, { x: 165, y: 115, w: 70, h: 70 })).toBe(0);
});
