import fs from 'node:fs';
import { initializeCanvas, readPsd, writePsd } from 'ag-psd';
import { test, expect, newDoc, compositePixel } from './helpers.js';

/*
 * PSD files are checked against ag-psd, an independent reader/writer used by
 * many web tools, in both directions.
 */

/** Red square with a half mask (multiply, 50%), a collapsed group with a hidden blue layer, a Screen layer. */
async function buildDoc(page) {
  await newDoc(page, { width: 200, height: 100 });
  await page.evaluate(async () => {
    const { Mask } = await import('./js/core/mask.js');
    const { Layer } = await import('./js/core/layer.js');
    const d = photoforge.doc;
    const red = d.newLayer('Red é');
    red.ctx.fillStyle = '#ff0000';
    red.ctx.fillRect(20, 20, 60, 60);
    red.blendMode = 'multiply';
    red.opacity = 0.5;
    red.mask = new Mask(200, 100, 0, 0, 255);
    red.mask.write(red, { x: 0, y: 0, w: 50, h: 100 }, new Uint8Array(50 * 100));
    const g = Layer.group('Group A');
    g.collapsed = true;
    d.addLayer(g);
    const blue = new Layer({ name: 'Blue', width: 30, height: 30, x: 150, y: 10 });
    blue.ctx.fillStyle = '#0000ff';
    blue.ctx.fillRect(0, 0, 30, 30);
    blue.visible = false;
    d.addLayer(blue, d.layers.indexOf(g), g);
    const green = d.newLayer('Green');
    d.setActive(g);
    green.parent = null;
    d.layers.splice(d.layers.indexOf(green), 1);
    d.layers.push(green);
    green.ctx.fillStyle = '#00ff00';
    green.ctx.fillRect(100, 50, 40, 40);
    green.blendMode = 'screen';
    photoforge.changed({ structure: true });
  });
}

async function savePSD(page, name = 'out') {
  await page.evaluate(() => photoforge.runAction('file.savePSD'));
  await page.fill('.modal input[type=text]', name);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.modal .btn-primary')]);
  expect(download.suggestedFilename()).toBe(`${name}.psd`);
  return fs.readFileSync(await download.path());
}

async function openFile(page, name, buffer) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles({ name, mimeType: 'image/vnd.adobe.photoshop', buffer: Buffer.from(buffer) });
}

// Node has no canvas: ag-psd only needs plain image data here.
initializeCanvas(() => {
  throw new Error('no canvas in tests');
}, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));

const pixel = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test('a saved .psd keeps layers, groups, masks and blend modes (read back with ag-psd)', async ({ page }) => {
  await buildDoc(page);
  const buf = await savePSD(page);
  const psd = readPsd(buf, { useImageData: true });
  expect([psd.width, psd.height]).toEqual([200, 100]);
  const names = psd.children.map((c) => c.name);
  expect(names).toEqual(['Background', 'Red é', 'Group A', 'Green']);
  const red = psd.children[1];
  expect(red.blendMode).toBe('multiply');
  expect(red.opacity).toBeCloseTo(0.5, 2);
  expect(pixel(red.imageData, 30 - red.left, 30 - red.top)).toEqual([255, 0, 0, 255]);
  expect(red.mask.defaultColor).toBe(255);
  expect(pixel(red.mask.imageData, 10, 50)[0]).toBe(0);
  expect(pixel(red.mask.imageData, 100, 50)[0]).toBe(255);
  const group = psd.children[2];
  expect(group.opened).toBe(false);
  expect(group.children.map((c) => [c.name, !!c.hidden])).toEqual([['Blue', true]]);
  expect(psd.children[3].blendMode).toBe('screen');
  // The merged image matches what PhotoForge shows.
  expect(pixel(psd.imageData, 60, 50)).toEqual(await compositePixel(page, 60, 50));
});

test('a .psd saved and reopened in PhotoForge looks the same', async ({ page }) => {
  await buildDoc(page);
  const points = [[30, 30], [60, 50], [120, 70], [160, 20], [5, 5]];
  const before = [];
  for (const [x, y] of points) before.push(await compositePixel(page, x, y));
  const buf = await savePSD(page);
  await openFile(page, 'out.psd', buf);
  await expect(page.locator('.tab')).toHaveCount(2);
  const after = [];
  for (const [x, y] of points) after.push(await compositePixel(page, x, y));
  expect(after).toEqual(before);
  const shape = await page.evaluate(() => photoforge.doc.layers.map((l) => [l.kind, l.name, l.parent?.name ?? null, l.visible, !!l.mask]));
  expect(shape).toEqual([
    ['pixel', 'Background', null, true, false],
    ['pixel', 'Red é', null, true, true],
    ['pixel', 'Blue', 'Group A', false, false],
    ['group', 'Group A', null, true, false],
    ['pixel', 'Green', null, true, false],
  ]);
});

test('opens a .psd written by another program, with groups, masks and hidden layers', async ({ page }) => {
  const img = (w, h, rgba) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
    return { width: w, height: h, data };
  };
  const psd = {
    width: 120,
    height: 80,
    imageData: img(120, 80, [255, 255, 255, 255]),
    children: [
      { name: 'Paper', left: 0, top: 0, imageData: img(120, 80, [250, 250, 250, 255]) },
      {
        name: 'Folder', opened: true, blendMode: 'pass through',
        children: [
          { name: 'Orange', left: 10, top: 10, opacity: 0.5, blendMode: 'multiply', imageData: img(40, 40, [255, 128, 0, 255]) },
          {
            name: 'Masked', left: 60, top: 10, imageData: img(40, 40, [0, 0, 255, 255]),
            mask: { left: 60, top: 10, right: 80, bottom: 50, defaultColor: 0, imageData: img(20, 40, [255, 255, 255, 255]) },
          },
        ],
      },
      { name: 'Ghost', hidden: true, left: 0, top: 0, imageData: img(10, 10, [0, 0, 0, 255]) },
    ],
  };
  const buf = writePsd(psd, { generateThumbnail: false });
  await openFile(page, 'other.psd', buf);
  await expect(page.locator('.tab')).toHaveCount(1);
  const shape = await page.evaluate(() => photoforge.doc.layers.map((l) => [l.name, l.parent?.name ?? null, l.visible]));
  expect(shape).toEqual([['Paper', null, true], ['Orange', 'Folder', true], ['Masked', 'Folder', true], ['Folder', null, true], ['Ghost', null, false]]);
  // Orange multiplied at 50% over the paper; the masked layer shows only its left half.
  const orange = await compositePixel(page, 20, 20);
  expect(Math.abs(orange[1] - 189)).toBeLessThanOrEqual(3);
  expect(await compositePixel(page, 70, 30)).toEqual([0, 0, 255, 255]);
  expect(await compositePixel(page, 90, 30)).toEqual([250, 250, 250, 255]);
  expect(await compositePixel(page, 5, 5)).toEqual([250, 250, 250, 255]);
});

test('a flattened .psd opens as one layer; a damaged one is refused', async ({ page }) => {
  const data = new Uint8ClampedArray(50 * 40 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([10, 200, 30, 255], i);
  const flat = writePsd({ width: 50, height: 40, imageData: { width: 50, height: 40, data } }, { generateThumbnail: false });
  await openFile(page, 'flat.psd', flat);
  await expect(page.locator('.tab')).toHaveCount(1);
  expect(await page.evaluate(() => photoforge.doc.layers.length)).toBe(1);
  expect(await compositePixel(page, 25, 20)).toEqual([10, 200, 30, 255]);

  const bad = Buffer.from(flat).subarray(0, 40);
  await openFile(page, 'bad.psd', bad);
  await expect(page.locator('#toast')).toContainText('Could not open bad.psd');
  await expect(page.locator('.tab')).toHaveCount(1);
});

test('opens a 16-bit grayscale .psd', async ({ page }) => {
  // Hand-built flattened file: 16-bit Grayscale, raw image data, a vertical ramp.
  const w = 4;
  const h = 3;
  const header = Buffer.alloc(26);
  header.write('8BPS', 0, 'ascii');
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(1, 12); // channels
  header.writeUInt32BE(h, 14);
  header.writeUInt32BE(w, 18);
  header.writeUInt16BE(16, 22); // depth
  header.writeUInt16BE(1, 24); // grayscale
  const sections = Buffer.alloc(12); // colour mode data, resources, layers: all empty
  const pixels = Buffer.alloc(2 + w * h * 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.writeUInt16BE(y * 0x4000 + 0x1234, 2 + (y * w + x) * 2);
  await openFile(page, 'deep.psd', Buffer.concat([header, sections, pixels]));
  await expect(page.locator('.tab')).toHaveCount(1);
  expect(await compositePixel(page, 1, 0)).toEqual([0x12, 0x12, 0x12, 255]);
  expect(await compositePixel(page, 2, 2)).toEqual([0x92, 0x92, 0x92, 255]);
});
