import { test, expect, newDoc, patternDoc, drag, clickDoc, screenPoint } from './helpers.js';

test('mask edits in an area added by Canvas Size are kept', async ({ page }) => {
  await newDoc(page, { width: 200, height: 200 });
  await page.keyboard.press('Control+Alt+Shift+n');
  await page.evaluate(() => photoforge.runAction('mask.revealAll'));
  const value = await page.evaluate(async () => {
    const { resizeCanvas } = await import('./js/core/transform.js');
    const { editMask } = await import('./js/actions-mask.js');
    resizeCanvas(photoforge, 400, 200, { x: 0, y: 0.5 }, null);
    editMask(photoforge, 'Fill', { x: 300, y: 50, w: 50, h: 50 }, () => 0);
    const l = photoforge.doc.activeLayer;
    return l.mask.read(l, { x: 320, y: 70, w: 1, h: 1 })[0];
  });
  expect(value).toBe(0);
});

test('Image Size keeps a type layer\'s mask aligned', async ({ page }) => {
  await newDoc(page, { width: 400, height: 300 });
  await page.keyboard.press('t');
  await clickDoc(page, 50, 100);
  await page.keyboard.type('Masked');
  await page.keyboard.press('Control+Enter');
  await page.evaluate(() => photoforge.runAction('mask.revealAll'));
  const before = await page.evaluate(() => {
    const l = photoforge.doc.activeLayer;
    return { lx: l.x, mx: l.x + l.mask.ox };
  });
  const after = await page.evaluate(async () => {
    (await import('./js/core/transform.js')).resizeImage(photoforge, 200, 150);
    const l = photoforge.doc.activeLayer;
    return { lx: l.x, mx: l.x + l.mask.ox, covers: l.mask.ox <= 0 && l.mask.oy <= 0 };
  });
  expect(Math.abs(after.mx - before.mx / 2)).toBeLessThanOrEqual(1);
  expect(after.covers).toBe(true);
});

test('quick clicks in different places do not close the polygonal lasso', async ({ page }) => {
  await newDoc(page);
  await page.evaluate(() => photoforge.setTool('polygon-lasso'));
  for (const [x, y] of [[100, 100], [300, 100], [300, 300]]) await clickDoc(page, x, y);
  expect(await page.evaluate(() => photoforge.tool.points?.length)).toBe(3);
  await clickDoc(page, 100, 100);
  expect(await page.evaluate(() => photoforge.doc.selection.isEmpty())).toBe(false);
});

test('monkey test: every tool and every command, then undo and redo everything', async ({ page }) => {
  test.setTimeout(180_000);
  await patternDoc(page);
  // Deterministic pseudo-random positions inside the document.
  let seed = 7;
  const rnd = (n) => {
    seed = (seed * 9301 + 49297) % 233280;
    return Math.floor((seed / 233280) * n);
  };
  const toolIds = await page.evaluate(() => [...photoforge.tools.keys()].filter((id) => id !== 'transform'));
  for (const id of toolIds) {
    await page.evaluate((id) => photoforge.setTool(id), id);
    for (let i = 0; i < 2; i++) await drag(page, [rnd(600), rnd(400)], [rnd(600), rnd(400)], { steps: 5 });
    await clickDoc(page, rnd(600), rnd(400));
    if (id === 'text') await page.keyboard.type('Hi');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
  }
  // Free Transform round.
  await page.evaluate(() => photoforge.setTool('move'));
  await page.keyboard.press('Control+t');
  const p = await screenPoint(page, 300, 200);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 40, p.y + 20, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Enter');

  // Every enabled command that doesn't open a file picker or download.
  const skip = /^(file\.|help\.|view\.panels)/;
  const ids = await page.evaluate(() => Object.keys(photoforge.actions));
  for (const id of ids) {
    if (skip.test(id)) continue;
    const ran = await page.evaluate((id) => {
      const a = photoforge.actions[id];
      if (a.enabled && !a.enabled()) return false;
      a.run();
      return true;
    }, id);
    if (!ran) continue;
    // Close any dialog the command opened (OK for some, Cancel for others).
    if (await page.locator('.modal').count()) {
      if (rnd(2)) await page.click('.modal .btn-primary');
      else await page.keyboard.press('Escape');
    }
    await page.evaluate(() => photoforge.tool?.id === 'transform' && photoforge.tool.commit());
  }

  const states = await page.evaluate(() => photoforge.history.entries.length);
  expect(states).toBeGreaterThan(20);
  await page.evaluate(() => photoforge.history.goTo(0));
  await page.evaluate(() => photoforge.history.goTo(photoforge.history.entries.length - 1));
  await page.evaluate(() => photoforge.history.goTo(0));
  expect(await page.evaluate(() => photoforge.history.index)).toBe(0);
});
