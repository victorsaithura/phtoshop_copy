import fs from 'node:fs';
import { test, expect, patternDoc, drag, clickDoc, compositePixel } from './helpers.js';

const summary = (page) => page.evaluate(() => photoforge.doc.layers.map((l) => ({
  name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode,
  text: l.text?.content ?? null, mask: !!l.mask, x: l.x, y: l.y,
})));

test('save a project and open it again with layers, type and masks intact', async ({ page }) => {
  await patternDoc(page, { name: 'trip.png' });
  // Type layer.
  await page.keyboard.press('t');
  await clickDoc(page, 50, 60);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Control+Enter');
  // Shape layer with a mask, half opacity and multiply.
  await page.evaluate(() => photoforge.setColor('fg', '#00aa00'));
  await page.keyboard.press('u');
  await drag(page, [300, 50], [550, 350]);
  await page.keyboard.press('m');
  await drag(page, [300, 50], [420, 350]);
  await page.evaluate(() => photoforge.runAction('mask.revealSelection'));
  await page.keyboard.press('Control+d');
  await page.evaluate(() => {
    const l = photoforge.doc.activeLayer;
    l.opacity = 0.5;
    l.blendMode = 'multiply';
  });
  const before = await summary(page);
  const pixels = [];
  for (const [x, y] of [[60, 60], [350, 200], [500, 200], [175, 175]]) pixels.push(await compositePixel(page, x, y));

  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  expect(download.suggestedFilename()).toBe('trip.pfp');
  await expect(page.locator('.tab.active .tab-title')).not.toContainText('*');
  const file = await download.path();
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(json.format).toBe('photoforge');
  expect(json.layers).toHaveLength(3);

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles({ name: 'trip.pfp', mimeType: 'application/json', buffer: fs.readFileSync(file) });
  await expect(page.locator('.tab')).toHaveCount(2);
  expect(await summary(page)).toEqual(before);
  const after = [];
  for (const [x, y] of [[60, 60], [350, 200], [500, 200], [175, 175]]) after.push(await compositePixel(page, x, y));
  expect(after).toEqual(pixels);
  // The reopened type layer is still editable text.
  expect(await page.evaluate(() => photoforge.doc.layers[1].text.content)).toBe('Hello');
});

test('a malformed or unsafe project is rejected', async ({ page }) => {
  const bad = JSON.stringify({
    format: 'photoforge', version: 1, name: 'x', width: 10, height: 10,
    layers: [{ name: 'evil', image: 'https://example.com/track.png' }],
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#welcome [data-action="file.open"]')]);
  await chooser.setFiles({ name: 'bad.pfp', mimeType: 'application/json', buffer: Buffer.from(bad) });
  await expect(page.locator('#toast')).toContainText('Could not open bad.pfp');
  await expect(page.locator('.tab')).toHaveCount(0);
});

test('groups, adjustment layers and layer styles survive a save and reopen', async ({ page }) => {
  await patternDoc(page, { name: 'pro.png' });
  await page.evaluate(async () => {
    const { effectDefaults } = await import('./js/core/effects.js');
    const d = photoforge.doc;
    const l = d.newLayer();
    l.ctx.fillStyle = '#ffcc00';
    l.ctx.fillRect(50, 50, 120, 80);
    l.styles = { stroke: { ...effectDefaults('stroke'), size: 4 }, dropShadow: effectDefaults('dropShadow') };
    photoforge.runAction('layer.group');
    const g = d.activeLayer;
    g.blendMode = 'multiply';
    g.opacity = 0.8;
    g.collapsed = true;
    photoforge.runAction('layer.adjust.invert');
    photoforge.doc.activeLayer.opacity = 0.4;
    photoforge.changed({ structure: true });
  });
  const shape = (page) => page.evaluate(() => photoforge.doc.layers.map((l) => ({
    kind: l.kind, name: l.name, parent: l.parent?.name ?? null, blendMode: l.blendMode, opacity: l.opacity,
    collapsed: l.collapsed, adjustment: l.adjustment, styles: l.styles,
  })));
  const before = await shape(page);
  const points = [[60, 60], [52, 52], [175, 140], [420, 200]];
  const pixels = [];
  for (const [x, y] of points) pixels.push(await compositePixel(page, x, y));

  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const file = await download.path();
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(2);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles({ name: 'pro.pfp', mimeType: 'application/json', buffer: fs.readFileSync(file) });
  await expect(page.locator('.tab')).toHaveCount(2);
  expect(await shape(page)).toEqual(before);
  const after = [];
  for (const [x, y] of points) after.push(await compositePixel(page, x, y));
  expect(after).toEqual(pixels);
});

test('a project with broken group links is rejected', async ({ page }) => {
  const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const bad = JSON.stringify({
    format: 'photoforge', version: 2, name: 'x', width: 10, height: 10,
    layers: [
      { name: 'a', image: img, parent: 2 },
      { name: 'b', image: img },
      { name: 'G', kind: 'group', image: img },
    ],
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#welcome [data-action="file.open"]')]);
  await chooser.setFiles({ name: 'loop.pfp', mimeType: 'application/json', buffer: Buffer.from(bad) });
  await expect(page.locator('#toast')).toContainText('Could not open loop.pfp');
});
