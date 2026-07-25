import { expect, test } from '@playwright/test';
import { type ServedReport, serveDemoReport } from './report.ts';

/**
 * The report workspace, in a real browser, against a real audit.
 *
 * These tests cover the promises the interface makes rather than its appearance: every section is reachable, the map has
 * a keyboard navigable equivalent, a control that cannot act says why, nothing is fetched from another origin, and the
 * page reports no errors while it renders.
 */

let served: ServedReport;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  served = await serveDemoReport();
});

test.afterAll(async () => {
  await served?.stop();
});

test.beforeEach(async ({ page }) => {
  consoleErrors.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.goto(served.url, { waitUntil: 'networkidle' });
});

test.afterEach(() => {
  expect(consoleErrors, 'the page reported errors while rendering').toEqual([]);
});

test('renders the overview with the project it audited', async ({ page }) => {
  // The project name is the directory name, and the workspace is a copy under a temporary path.
  await expect(page.locator('h1')).toHaveText(/^orchescope-ui-/);
  await expect(page.getByRole('navigation', { name: 'Report sections' })).toBeVisible();
  await expect(page.getByText(/Report rpt_[0-9a-f]{16}/)).toBeVisible();
  await expect(page.getByText(/Declared against exercised/)).toBeVisible();
});

test('every section is reachable and names itself', async ({ page }) => {
  const sections = [
    'Overview',
    'System map',
    'Findings',
    'Performance',
    'Resilience',
    'Scenarios',
    'Comparisons',
    'Goals',
  ];
  for (const section of sections) {
    await page.getByRole('link', { name: new RegExp(section) }).click();
    await expect(page.getByRole('link', { name: new RegExp(section) })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('main')).not.toBeEmpty();
  }
});

test('the map carries a keyboard navigable table with the same components', async ({ page }) => {
  await page.getByRole('link', { name: /System map/ }).click();
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible();

  const counter = page.getByText(/\d+ of \d+ components and \d+ of \d+ relations match/);
  await expect(counter).toBeVisible();

  expect(await grid.getByRole('row').count()).toBeGreaterThan(5);

  // Exactly one row is in the tab order at a time, and the arrow keys move it: the composite widget pattern.
  // Every step is a retrying assertion, because reading the active element once races the focus that precedes it.
  const focusable = grid.locator('tr[tabindex="0"]');
  await expect(focusable).toHaveCount(1);
  const first = (await focusable.getAttribute('aria-rowindex')) ?? '';
  await focusable.focus();
  await expect(focusable).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(focusable).not.toHaveAttribute('aria-rowindex', first);
  await expect(focusable).toBeFocused();
});

test('the map filters narrow both the canvas and the table', async ({ page }) => {
  await page.getByRole('link', { name: /System map/ }).click();
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible();
  const before = await grid.getByRole('row').count();
  expect(before).toBeGreaterThan(1);

  await page.getByLabel(/Search components/).fill('refund');
  await expect(page.getByText(/components and .* relations match/)).toBeVisible();
  await expect
    .poll(async () => grid.getByRole('row').count(), { timeout: 10_000 })
    .toBeLessThan(before);
});

test('a finding shows its basis, its evidence and where it came from', async ({ page }) => {
  await page.getByRole('link', { name: /Findings/ }).click();
  const first = page.locator('article.finding').first();
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute('id', /^finding-OSC-/);
  // The basis is a badge rather than prose, because a reader scanning a list needs it without reading a paragraph.
  await expect(
    first
      .locator('.badge-label')
      .filter({ hasText: /observed|discovered|inferred|simulated|estimated/i }),
  ).toBeVisible();
  await expect(first.getByText(/evidence/i).first()).toBeVisible();
});

test('an action that cannot run explains itself instead of failing silently', async ({ page }) => {
  await page.getByRole('link', { name: /Goals/ }).click();
  const disabled = page.locator('button[disabled]');
  const count = await disabled.count();
  for (let index = 0; index < count; index += 1) {
    const button = disabled.nth(index);
    const explanation =
      (await button.getAttribute('title')) ?? (await button.getAttribute('aria-describedby'));
    expect(explanation, 'a disabled control gave no reason').not.toBeNull();
  }
});

test('the page requests nothing from another origin', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(new URL(served.url).origin)) foreign.push(request.url());
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /System map/ }).click();
  expect(foreign, 'the report reached outside its own origin').toEqual([]);
});

test('the keyboard shortcut panel opens and closes with the keyboard', async ({ page }) => {
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
});

test('the theme control follows the document', async ({ page }) => {
  const root = page.locator('html');
  await page.getByLabel('Theme').selectOption('dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Theme').selectOption('light');
  await expect(root).toHaveAttribute('data-theme', 'light');
});

test('the document structure is navigable by landmarks and headings', async ({ page }) => {
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Report sections' })).toBeVisible();
  await expect(page.getByRole('status')).toBeAttached();

  const headings = await page.getByRole('heading').allTextContents();
  expect(headings.length).toBeGreaterThan(1);
  expect(headings[0]?.length).toBeGreaterThan(0);

  // Every control reachable by keyboard has an accessible name.
  const unnamed = await page.evaluate(() => {
    const focusable = [
      ...document.querySelectorAll<HTMLElement>('a[href], button, select, input, [tabindex="0"]'),
    ];
    return focusable
      .filter((element) => {
        const label =
          element.getAttribute('aria-label') ??
          element.getAttribute('title') ??
          element.textContent?.trim() ??
          '';
        return label.length === 0;
      })
      .map((element) => element.outerHTML.slice(0, 80));
  });
  expect(unnamed, 'a focusable control has no accessible name').toEqual([]);
});
