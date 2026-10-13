import { test as base, expect } from '@playwright/test';

export { expect };

/** Load the app and collect uncaught errors and console errors. */
export async function openApp(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => !!window.photoforge);
  return errors;
}

export function expectNoErrors(errors) {
  expect(errors, errors.join('\n')).toEqual([]);
}

/** `test` that opens the app before each test and fails it on any page error. */
export const test = base.extend({
  appErrors: [
    async ({ page }, use) => {
      const errors = await openApp(page);
      await use(errors);
      expectNoErrors(errors);
    },
    { auto: true },
  ],
});

export async function newDoc(page, { width = 800, height = 600, background = '#ffffff' } = {}) {
  await page.evaluate(async ({ width, height, background }) => {
    const { PSDocument } = await import('./js/core/document.js');
    photoforge.addDocument(new PSDocument({ width, height, background }), 'New');
  }, { width, height, background });
}

/** A document whose background is a colour gradient with a white square and a black disc. */
export async function patternDoc(page, { width = 600, height = 400, name = 'pattern.png' } = {}) {
  await page.evaluate(async ({ width, height, name }) => {
    const { PSDocument } = await import('./js/core/document.js');
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, '#dd2233');
    grad.addColorStop(0.5, '#22cc66');
    grad.addColorStop(1, '#3366ff');
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
    g.fillStyle = '#ffffff';
    g.fillRect(100, 100, 150, 150);
    g.fillStyle = '#000000';
    g.beginPath();
    g.arc(420, 200, 80, 0, Math.PI * 2);
    g.fill();
    photoforge.addDocument(PSDocument.fromImage(c, name), 'Open');
  }, { width, height, name });
}

/** Page coordinates of a document point. */
export async function screenPoint(page, x, y) {
  const box = await page.locator('#view').boundingBox();
  const p = await page.evaluate(([x, y]) => photoforge.view.docToScreen(x, y), [x, y]);
  return { x: box.x + p.x, y: box.y + p.y };
}

export async function drag(page, from, to, { steps = 8, modifiers = [] } = {}) {
  const a = await screenPoint(page, ...from);
  const b = await screenPoint(page, ...to);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

export async function clickDoc(page, x, y, options = {}) {
  const p = await screenPoint(page, x, y);
  await page.mouse.click(p.x, p.y, options);
}

/** RGBA of the active layer at a document point. */
export function layerPixel(page, x, y) {
  return page.evaluate(([x, y]) => {
    const l = photoforge.doc.activeLayer;
    const lx = Math.floor(x - l.x);
    const ly = Math.floor(y - l.y);
    if (lx < 0 || ly < 0 || lx >= l.width || ly >= l.height) return [0, 0, 0, 0];
    return [...l.ctx.getImageData(lx, ly, 1, 1).data];
  }, [x, y]);
}

/** RGBA of the flattened image at a document point. */
export function compositePixel(page, x, y) {
  return page.evaluate(([x, y]) => [...photoforge.doc.composite().getContext('2d').getImageData(x, y, 1, 1).data], [x, y]);
}

export const historyLabels = (page) => page.evaluate(() => photoforge.history.entries.map((e) => e.label));
export const currentLabel = (page) => page.evaluate(() => photoforge.history.current.label);
export const docSize = (page) => page.evaluate(() => [photoforge.doc.width, photoforge.doc.height]);

export function close(a, b, tolerance = 3) {
  return a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}
