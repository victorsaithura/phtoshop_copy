import { test, expect, newDoc, drag, compositePixel, currentLabel, close, screenPoint } from './helpers.js';

/** White background, a red square (Layer 1) and a blue square (Layer 2) on their own layers. */
async function twoSquares(page) {
  await newDoc(page, { width: 400, height: 300 });
  await page.evaluate(() => {
    const d = photoforge.doc;
    for (const [color, x] of [['#ff0000', 50], ['#0000ff', 200]]) {
      const l = d.newLayer();
      l.ctx.fillStyle = color;
      l.ctx.fillRect(x, 50, 100, 100);
    }
    photoforge.changed({ structure: true });
  });
}

const names = (page) => page.evaluate(() => photoforge.doc.layers.map((l) => `${l.name}${l.parent ? `<${l.parent.name}` : ''}`));

test('Ctrl+G groups the layer; the group hides, fades and ungroups its contents', async ({ page }) => {
  await twoSquares(page);
  await page.keyboard.press('Control+g');
  expect(await names(page)).toEqual(['Background', 'Layer 1', 'Layer 2<Group 1', 'Group 1']);
  expect(await currentLabel(page)).toBe('Group Layers');
  await expect(page.locator('.layer-row.group')).toHaveCount(1);
  await expect(page.locator('.layer-row .layer-indent')).toHaveCount(1);

  await page.click('.layer-row.group .layer-eye');
  expect(await compositePixel(page, 250, 100)).toEqual([255, 255, 255, 255]);
  expect(await compositePixel(page, 100, 100)).toEqual([255, 0, 0, 255]);
  await page.click('.layer-row.group .layer-eye');

  await page.fill('.layers-opacity .num-input', '50');
  await page.press('.layers-opacity .num-input', 'Enter');
  expect(close(await compositePixel(page, 250, 100), [128, 128, 255, 255], 2)).toBe(true);

  await page.keyboard.press('Control+Shift+g');
  expect(await names(page)).toEqual(['Background', 'Layer 1', 'Layer 2']);
  expect(await compositePixel(page, 250, 100)).toEqual([0, 0, 255, 255]);
  await page.keyboard.press('Control+z');
  expect(await names(page)).toEqual(['Background', 'Layer 1', 'Layer 2<Group 1', 'Group 1']);
  await page.evaluate(() => photoforge.history.goTo(0));
  expect(await names(page)).toEqual(['Background', 'Layer 1', 'Layer 2']);
});

test('new layers go into the selected group; drag into a group; collapse hides its rows', async ({ page }) => {
  await twoSquares(page);
  await page.click('.layers-footer button[title="Create a new group"]');
  await page.click('.layers-footer button[title="Create a new layer"]');
  expect(await names(page)).toEqual(['Background', 'Layer 1', 'Layer 2', 'Layer 3<Group 1', 'Group 1']);

  // Drop Layer 1 onto the middle of the group row: it moves into the group.
  await page.dragAndDrop('.layer-row:has-text("Layer 1")', '.layer-row.group', { targetPosition: { x: 60, y: 22 } });
  expect(await names(page)).toEqual(['Background', 'Layer 2', 'Layer 3<Group 1', 'Layer 1<Group 1', 'Group 1']);
  expect(await currentLabel(page)).toBe('Layer Order');
  // The red square now sits in the group, above the blue one.
  await expect(page.locator('.layer-row')).toHaveCount(5);
  await page.click('.layer-row.group .layer-twist');
  await expect(page.locator('.layer-row')).toHaveCount(3);
  await page.click('.layer-row.group .layer-twist');
  await expect(page.locator('.layer-row')).toHaveCount(5);
});

test('the Move tool moves a whole group; arrange stays inside the group', async ({ page }) => {
  await twoSquares(page);
  await page.evaluate(() => photoforge.doc.setActive(photoforge.doc.layers[1]));
  await page.keyboard.press('Control+g');
  // Layer 2 is now above the group; move it into the group's top.
  await page.evaluate(() => {
    const d = photoforge.doc;
    photoforge.transact('Layer Order', { structure: true }, () => d.place(d.layers[3], d.layers[2], 'into'));
  });
  expect(await names(page)).toEqual(['Background', 'Layer 1<Group 1', 'Layer 2<Group 1', 'Group 1']);
  await page.keyboard.press('v');
  await drag(page, [10, 10], [40, 60]);
  expect(await compositePixel(page, 85, 105)).toEqual([255, 0, 0, 255]);
  expect(await compositePixel(page, 235, 105)).toEqual([0, 0, 255, 255]);
  expect(await compositePixel(page, 60, 60)).toEqual([255, 255, 255, 255]);
  await page.keyboard.press('Control+z');
  expect(await compositePixel(page, 60, 60)).toEqual([255, 0, 0, 255]);

  // Bring Layer 1 forward: it swaps with Layer 2 but stays in the group.
  await page.evaluate(() => photoforge.doc.setActive(photoforge.doc.layers[1]));
  await page.keyboard.press('Control+]');
  expect(await names(page)).toEqual(['Background', 'Layer 2<Group 1', 'Layer 1<Group 1', 'Group 1']);
  await page.keyboard.press('Control+]');
  expect(await names(page)).toEqual(['Background', 'Layer 2<Group 1', 'Layer 1<Group 1', 'Group 1']);
});

test('group blend mode and mask; merge group keeps the look', async ({ page }) => {
  await twoSquares(page);
  await page.evaluate(() => {
    const d = photoforge.doc;
    // A full grey layer with the blue square above it, both in one group.
    const grey = d.newLayer();
    grey.ctx.fillStyle = '#808080';
    grey.ctx.fillRect(0, 0, 400, 300);
    photoforge.runAction('layer.group');
    photoforge.transact('Into Group', { structure: true }, () => d.place(d.layers[2], grey, 'above'));
  });
  expect(await names(page)).toEqual(['Background', 'Layer 1', 'Layer 3<Group 1', 'Layer 2<Group 1', 'Group 1']);
  await page.selectOption('.layers-controls select', 'multiply');
  // The group is flattened first (grey with a blue square), then multiplied onto what is below.
  expect(close(await compositePixel(page, 300, 250), [128, 128, 128, 255], 1)).toBe(true);
  expect(await compositePixel(page, 250, 100)).toEqual([0, 0, 255, 255]);
  expect(close(await compositePixel(page, 100, 100), [128, 0, 0, 255], 1)).toBe(true);

  // A group mask hiding the left half.
  await page.keyboard.press('m');
  await drag(page, [0, 0], [200, 300]);
  await page.evaluate(() => photoforge.runAction('mask.hideSelection'));
  await page.keyboard.press('Control+d');
  expect(await compositePixel(page, 100, 250)).toEqual([255, 255, 255, 255]);
  expect(await compositePixel(page, 100, 100)).toEqual([255, 0, 0, 255]);
  expect(close(await compositePixel(page, 300, 250), [128, 128, 128, 255], 1)).toBe(true);

  await page.evaluate(() => { window.beforeMerge = photoforge.doc.composite().getContext('2d').getImageData(0, 0, 400, 300).data; });
  await page.keyboard.press('Control+e');
  expect(await currentLabel(page)).toBe('Merge Group');
  expect(await names(page)).toEqual(['Background', 'Layer 1', 'Group 1']);
  const diff = await page.evaluate(() => {
    const after = photoforge.doc.composite().getContext('2d').getImageData(0, 0, 400, 300).data;
    let d = 0;
    for (let i = 0; i < after.length; i++) d = Math.max(d, Math.abs(window.beforeMerge[i] - after[i]));
    return d;
  });
  expect(diff).toBeLessThanOrEqual(2);
});

test('duplicate and delete a group with its contents', async ({ page }) => {
  await twoSquares(page);
  await page.keyboard.press('Control+g');
  await page.click('.layers-footer button[title="Duplicate layer"]');
  expect(await names(page)).toEqual(['Background', 'Layer 1', 'Layer 2<Group 1', 'Group 1', 'Layer 2<Group 1 copy', 'Group 1 copy']);
  expect(await currentLabel(page)).toBe('Duplicate Group');
  await page.click('.layers-footer button[title="Delete layer"]');
  expect(await names(page)).toEqual(['Background', 'Layer 1', 'Layer 2<Group 1', 'Group 1']);
  await page.click('.layers-footer button[title="Delete layer"]');
  expect(await names(page)).toEqual(['Background', 'Layer 1']);
  expect(await compositePixel(page, 250, 100)).toEqual([255, 255, 255, 255]);
});

test('painting tools refuse a group but paint on its mask', async ({ page }) => {
  await twoSquares(page);
  await page.keyboard.press('Control+g');
  await page.keyboard.press('b');
  await drag(page, [20, 200], [380, 200]);
  await expect(page.locator('#toast')).toContainText('is a group');
  await page.evaluate(() => photoforge.runAction('mask.revealAll'));
  await page.evaluate(() => photoforge.setColor('fg', '#000000'));
  await drag(page, [250, 60], [250, 140], { steps: 4 });
  expect(await currentLabel(page)).toBe('Brush');
  expect(await compositePixel(page, 250, 100)).toEqual([255, 255, 255, 255]);
});

test('selecting a layer inside a collapsed group opens the group', async ({ page }) => {
  await twoSquares(page);
  await page.keyboard.press('Control+g');
  await page.click('.layer-row.group .layer-twist');
  await expect(page.locator('.layer-row')).toHaveCount(3);
  // Auto-select with the Move tool picks the blue square inside the group.
  await page.keyboard.press('v');
  await page.keyboard.down('Control');
  const p = await screenPoint(page, 250, 100);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Control');
  expect(await page.evaluate(() => photoforge.doc.activeLayer.name)).toBe('Layer 2');
  await expect(page.locator('.layer-row')).toHaveCount(4);
  await expect(page.locator('.layer-row.active')).toContainText('Layer 2');
});
