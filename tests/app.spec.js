import { test, expect } from '@playwright/test';
import { openApp, expectNoErrors, newDoc, patternDoc, docSize } from './helpers.js';

test('loads with the welcome screen and no errors', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('.menu-root')).toHaveCount(8);
  await expect(page.locator('.tool-btn')).not.toHaveCount(0);
  expectNoErrors(errors);
});

test('New Document dialog creates a document from a preset', async ({ page }) => {
  const errors = await openApp(page);
  await page.click('#welcome [data-action="file.new"]');
  await page.click('.preset-list .btn:has-text("Square post")');
  await page.click('.modal .btn-primary');
  expect(await docSize(page)).toEqual([1080, 1080]);
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('.tab')).toHaveCount(1);
  await expect(page.locator('.layer-row')).toHaveCount(1);
  expectNoErrors(errors);
});

test('New Document dialog rejects impossible sizes', async ({ page }) => {
  await openApp(page);
  await page.click('#welcome [data-action="file.new"]');
  await page.fill('.modal input[type=number] >> nth=0', '0');
  await page.click('.modal .btn-primary');
  await expect(page.locator('.modal')).toBeVisible();
  await expect(page.locator('.modal .form-note')).toContainText('Size must be');
});

test('every menu and submenu opens', async ({ page }) => {
  const errors = await openApp(page);
  await patternDoc(page);
  // Some submenus (Select ▸ Modify) are only available with a selection.
  await page.keyboard.press('Control+a');
  for (const label of ['File', 'Edit', 'Image', 'Layer', 'Select', 'Filter', 'View', 'Help']) {
    await page.click(`.menu-root:text-is("${label}")`);
    const dropdown = page.locator('.menu-wrap > .menu-dropdown');
    await expect(dropdown).toBeVisible();
    const subs = dropdown.locator(':scope > .menu-sub');
    const count = await subs.count();
    for (let i = 0; i < count; i++) {
      await subs.nth(i).hover();
      await expect(subs.nth(i).locator(':scope > .menu-dropdown')).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(dropdown).toHaveCount(0);
  }
  expectNoErrors(errors);
});

test('menu commands run from the menu', async ({ page }) => {
  const errors = await openApp(page);
  await patternDoc(page);
  await page.click('.menu-root:text-is("Layer")');
  await page.click('.menu-item:has-text("New Layer")');
  await expect(page.locator('.layer-row')).toHaveCount(2);
  await page.click('.menu-root:text-is("Image")');
  await page.hover('.menu-sub:has-text("Image Rotation")');
  await page.click('.menu-item:has-text("90° Clockwise")');
  expect(await docSize(page)).toEqual([400, 600]);
  expectNoErrors(errors);
});

test('keyboard shortcut list opens with ?', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Shift+Slash');
  await expect(page.locator('.shortcut-table')).toBeVisible();
  await expect(page.locator('.shortcut-table td:text-is("Levels…")')).toHaveCount(1);
});

test('documents open in tabs and can be switched and closed', async ({ page }) => {
  const errors = await openApp(page);
  await newDoc(page, { width: 300, height: 200 });
  await newDoc(page, { width: 500, height: 400 });
  await expect(page.locator('.tab')).toHaveCount(2);
  expect(await docSize(page)).toEqual([500, 400]);
  await page.click('.tab >> nth=0');
  expect(await docSize(page)).toEqual([300, 200]);
  await page.click('.tab.active .tab-close');
  await expect(page.locator('.tab')).toHaveCount(1);
  expect(await docSize(page)).toEqual([500, 400]);
  expectNoErrors(errors);
});

test('closing a changed document asks first', async ({ page }) => {
  await openApp(page);
  await newDoc(page);
  await page.keyboard.press('Control+a');
  await page.click('.tab.active .tab-close');
  await expect(page.locator('.modal')).toContainText('Discard');
  await page.click('.modal .btn:has-text("Cancel")');
  await expect(page.locator('.tab')).toHaveCount(1);
});

test('zoom shortcuts and status bar', async ({ page }) => {
  await openApp(page);
  await newDoc(page, { width: 400, height: 300 });
  await page.keyboard.press('Control+1');
  await expect(page.locator('.status-zoom input')).toHaveValue('100%');
  await page.keyboard.press('Control+Equal');
  await expect(page.locator('.status-zoom input')).toHaveValue('150%');
  await page.fill('.status-zoom input', '50');
  await page.press('.status-zoom input', 'Enter');
  expect(await page.evaluate(() => photoforge.view.zoom)).toBeCloseTo(0.5);
});

test('works on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const errors = await openApp(page);
  await patternDoc(page);
  await expect(page.locator('#panels')).not.toBeInViewport();
  await page.click('.panels-toggle');
  await expect(page.locator('#panels')).toBeInViewport();
  expectNoErrors(errors);
});
