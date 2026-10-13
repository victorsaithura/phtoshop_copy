import fs from 'node:fs';
import { test, expect, patternDoc, docSize } from './helpers.js';

/** A small PNG made in the page, saved to a temp file. */
async function makePng(page, testInfo) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    const g = c.getContext('2d');
    g.fillStyle = '#33aa66';
    g.fillRect(0, 0, 320, 240);
    return c.toDataURL('image/png').split(',')[1];
  });
  const file = testInfo.outputPath('sample.png');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

test('open an image through the file picker', async ({ page }, testInfo) => {
  const file = await makePng(page, testInfo);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#welcome [data-action="file.open"]')]);
  await chooser.setFiles(file);
  await expect(page.locator('.tab')).toHaveCount(1);
  expect(await docSize(page)).toEqual([320, 240]);
  await expect(page.locator('.tab-title')).toContainText('sample.png');
});

test('place an image as a new layer', async ({ page }, testInfo) => {
  await patternDoc(page);
  const file = await makePng(page, testInfo);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.evaluate(() => photoforge.runAction('file.place')),
  ]);
  await chooser.setFiles(file);
  await expect(page.locator('.layer-row')).toHaveCount(2);
  expect(await page.evaluate(() => photoforge.doc.activeLayer.name)).toBe('sample');
});

test('export PNG and JPEG downloads', async ({ page }) => {
  await patternDoc(page);
  for (const format of ['png', 'jpeg']) {
    await page.keyboard.press('Control+Alt+Shift+w');
    await page.selectOption('.modal select', format);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.modal .btn-primary')]);
    expect(download.suggestedFilename()).toBe(format === 'png' ? 'pattern.png' : 'pattern.jpg');
    const path = await download.path();
    expect(fs.statSync(path).size).toBeGreaterThan(1000);
  }
});
