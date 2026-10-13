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
