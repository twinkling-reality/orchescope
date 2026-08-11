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
  await expect(page.getByRole('heading', { name: 'What this report found' })).toBeAttached();

  // The first thing on the page says what this report did, because every count on it is meaningless to
  // a reader who does not already know that the tool read their code and watched the system work.
  await expect(page.locator('.hero-preamble')).toContainText(/^We read your code/);

  // And the first number is about the reader's system rather than about how much of it we managed to
  // look at. `7 of 21 never ran` is a fact about our own coverage; a count of problems is a fact about
  // them, and it used to be three hundred pixels down inside the second tile.
  await expect(page.locator('.answer-title')).toBeVisible();
  await expect(page.locator('.answer-impact')).toBeVisible();

  // Which report this is moved from a mono line across the top of every screen into a menu behind one
  // icon. It is still on every screen and still one interaction away, which is what this holds: the
  // identifier is in the document, and the control that reveals it does.
  await page.getByRole('button', { name: 'Report details' }).click();
  const details = page.getByRole('dialog', { name: 'Report details' });
  await expect(details).toHaveClass(/chrome-menu-body/);
  await expect(details.getByText(/rpt_[0-9a-f]{16}/)).toBeVisible();
  // The revision, said either way: a temporary workspace has no git repository, and saying so is the
  // point. What must never happen is the row being absent, because then nothing says whether the
  // graph matches a commit anyone else can check out.
  await expect(
    details.getByText(/working tree (clean|dirty)|no git revision recorded/),
  ).toBeVisible();
  await expect(page.getByText('Provenance', { exact: true })).toHaveCount(0);
});

/**
 * Overview is one answer on one screen.
 *
 * The test this replaced walked four tiles and asserted their order, their widths and which of them
 * carried a menu. That structure is gone, and it is gone because it answered `what do I do` in four
 * places at once and printed the same finding twice: a hero naming the most serious one, a tile listing
 * the top three, a tile naming a goal, and a tile about how many files the scan read. What is asserted
 * now is the promise that replaced it, and it is a stronger one: one answer, one action, and the whole
 * thing fits the screen without scrolling.
 */
test('overview is one answer, one action, and one screen', async ({ page }) => {
  const skeleton = page.locator('[data-section-skeleton="overview"]');
  await expect(skeleton).toBeVisible();
  await expect
    .poll(() =>
      skeleton
        .locator(':scope > [data-slot]')
        .evaluateAll((slots) => slots.map((slot) => slot.getAttribute('data-slot'))),
    )
    .toEqual(['headline', 'problems', 'ran', 'scan']);

  // What this report did, before any number, because every count is meaningless to a reader who does
  // not know the tool read their code and watched the system work.
  await expect(skeleton.locator('.hero-preamble')).toContainText(/^We read your code/);

  // The one thing the screen is about: what kind of claim it is, the claim, and what it costs.
  await expect(skeleton.locator('.answer-meta')).toBeVisible();
  await expect(skeleton.locator('.answer-title')).toBeVisible();
  await expect(skeleton.locator('.answer-impact')).not.toBeEmpty();

  // It is the largest thing on the screen, and nothing on the screen competes with it.
  const sizes = await skeleton.evaluate((root) => {
    const size = (element: Element | null) =>
      element === null ? 0 : Number.parseFloat(getComputedStyle(element).fontSize);
    const answer = size(root.querySelector('.answer-title'));
    const others = [...root.querySelectorAll<HTMLElement>('*')]
      .filter((element) => !element.closest('.answer-title'))
      .map((element) => size(element));
    return { answer, loudestOther: Math.max(0, ...others) };
  });
  expect(sizes.answer, 'the answer is not the largest thing on the screen').toBeGreaterThan(
    sizes.loudestOther,
  );

  // The one thing to do sits with the thing it is about, and the command is a control rather than text
  // to drag a selection across. It copies and never runs: nothing here acts on the reader's behalf.
  const command = skeleton.locator('.answer-do .runnable');
  await expect(command).toBeVisible();
  await expect(command.locator('pre.command')).toContainText('orchescope');
  await expect(command.getByRole('button', { name: /Copy/ })).toBeVisible();

  // Each tile under the answer asks a different question and none of them repeats it. The tile that
  // used to sit here listed the top three problems, and its first row was the finding the answer had
  // already named.
  await expect(skeleton.locator('[data-slot="problems"]')).toContainText(
    'Everything else we found',
  );
  await expect(skeleton.locator('[data-slot="ran"]')).toContainText('has actually run');
  await expect(skeleton.locator('[data-slot="scan"]')).toContainText('What the scan could read');
  const answered = await skeleton.locator('.answer-title').innerText();
  await expect(
    skeleton.locator('[data-slot="problems"]'),
    'the tile under the answer repeats the answer',
  ).not.toContainText(answered.trim());

  // The answer and its action are whole in the first viewport, and the page never scrolls sideways.
  // Vertical fit is asserted separately, because it is a measurement that depends on the viewport and
  // the report, and it is still failing on a short window: see docs/design/TODO.md.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'Overview scrolls sideways').toBeLessThanOrEqual(0);
  await expect(skeleton.locator('.answer-title')).toBeInViewport({ ratio: 1 });
  await expect(skeleton.locator('.answer-do')).toBeInViewport({ ratio: 1 });

  // The counts take you to the screen the thing they count lives on, rather than repeating it here.
  await skeleton.locator('[data-slot="problems"] .link-button').click();
  await expect(page.locator('[data-section-skeleton="findings"]')).toBeVisible();
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

test('every depth section keeps summary, primary and detail slots in place', async ({ page }) => {
  const sections = [
    ['System map', 'map'],
    ['Findings', 'findings'],
    ['Performance', 'performance'],
    ['Resilience', 'resilience'],
    ['Scenarios', 'scenarios'],
    ['Comparisons', 'comparisons'],
    ['Goals', 'goals'],
  ] as const;

  for (const [label, section] of sections) {
    await page.getByRole('link', { name: new RegExp(label) }).click();
    const skeleton = page.locator(`[data-section-skeleton="${section}"]`);
    await expect(skeleton).toBeVisible();
    await expect
      .poll(() =>
        skeleton
          .locator(':scope > [data-slot]')
          .evaluateAll((slots) => slots.map((slot) => slot.getAttribute('data-slot'))),
      )
      .toEqual(['summary', 'primary', 'detail']);

    // Presence of the slot was the whole assertion before this, and a slot renders its own div with
    // no children at all, which `comparisons.tsx` did on every report in the corpus that carried a
    // comparison. So the order above passed while one of the three was empty. A slot that is present
    // and blank is indistinguishable from a failed render, and it is the one thing "never fake
    // completeness" excludes: what is missing has to say so where it is missing.
    const lengths = await skeleton
      .locator(':scope > [data-slot]')
      .evaluateAll((slots) => slots.map((slot) => (slot.textContent ?? '').trim().length));
    for (const [index, length] of lengths.entries()) {
      expect(length, `${section} slot ${index} is empty`).toBeGreaterThan(0);
    }
  }
});

test('the map carries a keyboard navigable table with the same parts', async ({ page }) => {
  await page.getByRole('link', { name: /System map/ }).click();
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible();

  const counter = page.getByText(/\d+ of \d+ parts and \d+ of \d+ connections match/);
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

  await page.getByLabel(/Search parts/).fill('refund');
  await expect(page.getByText(/parts and .* connections match/)).toBeVisible();
  await expect
    .poll(async () => grid.getByRole('row').count(), { timeout: 10_000 })
    .toBeLessThan(before);
});

/**
 * A second arrangement of the same graph is a control, so what it must not change is what it draws. The
 * census beside the canvas counts the components on the map and says it once; if switching arrangement
 * moved that number the sentence would be about a control it does not mention.
 */
test('changing the arrangement redraws the map without changing what is on it', async ({
  page,
}) => {
  await page.getByRole('link', { name: /System map/ }).click();
  const grid = page.getByRole('treegrid');
  await expect(grid).toBeVisible();
  const picker = page.getByLabel('Arrangement');
  await expect(picker).toBeVisible();
  await expect(picker.locator('option')).toHaveText(['Concentric', 'Top down', 'Left to right']);

  const census = page.locator('p.lede').first();
  const before = await census.textContent();
  const rows = await grid.getByRole('row').count();

  for (const arrangement of ['Top down', 'Left to right', 'Concentric']) {
    await picker.selectOption({ label: arrangement });
    await expect(census).toHaveText(before ?? '');
    expect(await grid.getByRole('row').count()).toBe(rows);
  }
});

/**
 * What the directional arrangements draw as position, the table has to carry as a value, because the
 * canvas is hidden from assistive technology and a fact that is only a picture is unreachable.
 */
test('the components table carries the depth the directional arrangements draw', async ({
  page,
}) => {
  await page.getByRole('link', { name: /System map/ }).click();
  const grid = page.getByRole('treegrid');
  await expect(grid.getByRole('columnheader', { name: 'Steps from a start' })).toBeVisible();
  // A group row aggregates depths that differ, so its cell is deliberately empty; a component row
  // carries how many relations from an entry point it sits.
  const depths = grid.locator('tr.tg-row td:nth-child(5) .data');
  await expect
    .poll(
      async () => (await depths.allTextContents()).filter((value) => /^\d+$/.test(value)).length,
    )
    .toBeGreaterThan(0);
});

test('a finding shows its basis, its evidence and where it came from', async ({ page }) => {
  await page.getByRole('link', { name: /Findings/ }).click();
  const first = page.locator('article.finding').first();
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute('id', /^finding-OSC-/);
  // A finding is one line that expands, so what a reader scanning the list decides on has to be on the
  // line itself rather than behind the click: the evidence class and how many records stand behind it.
  // The chip has no inner label element any more, so this reads `.basis` where it used to read
  // `.badge-label`, and it is scoped to the summary so it cannot pass on a chip inside the closed body.
  const summary = first.locator('summary');
  await expect(
    summary
      .locator('.basis')
      .filter({ hasText: /observed|discovered|inferred|simulated|estimated/i }),
  ).toBeVisible();
  await expect(summary).toContainText(/evidence/i);
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
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help).toHaveClass(/chrome-menu-body/);
  await expect(help.locator('xpath=..')).toHaveClass(/chrome-menu/);

  const [chromeBox, helpBox] = await Promise.all([
    page.locator('.chrome').boundingBox(),
    help.boundingBox(),
  ]);
  expect(helpBox?.y ?? 0).toBeGreaterThanOrEqual((chromeBox?.y ?? 0) + (chromeBox?.height ?? 0));

  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  await page.getByRole('button', { name: 'Report details' }).click();
  await expect(page.getByRole('dialog', { name: 'Report details' })).toBeVisible();
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Report details' })).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

/**
 * This replaced `the theme control follows the document`, deliberately, because the control is gone.
 *
 * What it used to hold was that a reader could change the palette. What has to hold now is the
 * opposite and it is the stronger promise: a tile's ground is fixed by its role, so the composition is
 * the same document wherever it is opened. The case this exists for is a reader whose operating system
 * is dark, which is where every themed palette collapsed into one grey rectangle.
 */
test('the composition does not follow the operating system', async ({ page }) => {
  const asLight = await groundsOf(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload({ waitUntil: 'networkidle' });
  const asDark = await groundsOf(page);

  expect(asDark.anchor?.colour, 'the anchor followed the operating system').toBe(
    asLight.anchor?.colour,
  );
  expect(asDark.band?.colour, 'the band followed the operating system').toBe(asLight.band?.colour);
  expect(asDark.field?.colour, 'the field followed the operating system').toBe(
    asLight.field?.colour,
  );
  // And nothing offers a palette it cannot then deliver.
  await expect(page.getByLabel('Theme')).toHaveCount(0);
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
        // A control's name may come from a label wrapping it or pointing at it, which is the standard
        // way a radio or a checkbox is named. Resolving those makes the check more accurate rather than
        // more forgiving: a control with neither is still reported.
        const associated =
          element.id.length === 0
            ? null
            : document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        const label =
          element.getAttribute('aria-label') ??
          element.getAttribute('title') ??
          (element.textContent?.trim() || null) ??
          (element.closest('label')?.textContent?.trim() || null) ??
          (associated?.textContent?.trim() || null) ??
          '';
        return label.length === 0;
      })
      .map((element) => element.outerHTML.slice(0, 80));
  });
  expect(unnamed, 'a focusable control has no accessible name').toEqual([]);
});

/**
 * The three promises the interface makes to a reader who is not using a mouse, a reader who has asked
 * their system to stop moving things, and a reader on a phone. Each one is invisible until it is
 * broken, which is why none of them survived a redesign before without being held.
 */
test('keyboard focus is visible on every control it can reach', async ({ page }) => {
  // Overview is one answer now and carries neither a `select` nor a `summary`: it has no tile menu to
  // open, because there is nothing on it a reader has to act on that is not already on the page. The
  // map has both, so the four kinds of control are covered across two screens rather than by dropping
  // any of them from the list.
  const controls: readonly { readonly selector: string; readonly section: string | null }[] = [
    { selector: '.nav-link', section: null },
    { selector: 'button', section: null },
    { selector: '.tile-menu > summary', section: null },
    { selector: 'select', section: 'System map' },
  ];
  const outlines: { name: string; width: number }[] = [];
  for (const { selector, section } of controls) {
    if (section !== null) {
      await page.getByRole('link', { name: new RegExp(section) }).click();
    }
    const control = page.locator(selector).first();
    await expect(control).toBeAttached();
    await control.focus();
    outlines.push({
      name: selector,
      width: await control.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).outlineWidth || '0'),
      ),
    });
  }
  for (const outline of outlines) {
    expect(outline.width, `${outline.name} has no visible focus ring`).toBeGreaterThan(0);
  }
});

test('reduced motion stops the page moving', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'networkidle' });
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const animated = style.animationName !== 'none' && style.animationDuration !== '0s';
        const transitioned = style.transitionDuration
          .split(',')
          .some((duration) => Number.parseFloat(duration) > 0);
        return animated || transitioned;
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
  );
  expect(moving, 'something still animates when reduced motion is asked for').toEqual([]);
});

test('the page fits a phone without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${section} scrolls sideways at 390px`).toBeLessThanOrEqual(0);
  }
});

/**
 * The rule the bento rests on, and it is invisible until it is broken.
 *
 * A tile owns its ground and the ground is fixed by the tile's role: the band is light on top, the
 * anchor is black, the field is light. What this stops is the failure every themed version had, where
 * the page, the lifted surface and the accent band landed within 1.19:1 of each other on a dark
 * machine and read as one grey rectangle.
 */
function groundsOf(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const luminance = (colour: string): number => {
      const [red = 0, green = 0, blue = 0] = (colour.match(/\d+(\.\d+)?/g) ?? []).map(Number);
      const channel = (value: number) => {
        const scaled = value / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
    };
    const read = (selector: string) => {
      const element = document.querySelector(selector);
      if (element === null) {
        return null;
      }
      const colour = getComputedStyle(element).backgroundColor;
      return { colour, luminance: luminance(colour) };
    };
    const chrome = document.querySelector('.chrome');
    return {
      anchor: read('.tile.is-anchor, .tile.is-dark'),
      band: read('.tile.is-band:not(.is-band-deep)'),
      field: read('.tile:not(.is-anchor):not(.is-dark):not(.is-band)'),
      chromeColour: chrome === null ? null : getComputedStyle(chrome).backgroundColor,
      chromeSeam: chrome === null ? null : getComputedStyle(chrome).borderBottomWidth,
    };
  });
}

test('a tile owns its ground, and the ground is fixed by its role', async ({ page }) => {
  // Measured on the map, which is the one screen that carries all three grounds at once: the dark tile
  // the drawing sits on, the band it opens with, and the field everything else is written on. Overview
  // is one answer on one ground now, so it cannot hold the composition rule up on its own.
  await page.getByRole('link', { name: /System map/ }).click();
  await expect(page.locator('[data-section-skeleton="map"]')).toBeVisible();
  await expect(page.locator('.tile.is-dark')).toBeVisible();
  const grounds = await groundsOf(page);
  expect(grounds.anchor, 'the screen has no anchor tile').not.toBeNull();
  expect(grounds.band, 'the screen has no band tile').not.toBeNull();
  expect(grounds.field, 'the screen has no field tile').not.toBeNull();

  // Black in the corner, light on top, light everywhere else. The order is the composition.
  expect(grounds.anchor?.luminance, 'the anchor is not the darkest ground').toBeLessThan(
    grounds.band?.luminance ?? 0,
  );
  expect(grounds.band?.luminance, 'the band is not below the field').toBeLessThan(
    grounds.field?.luminance ?? 0,
  );
  // The anchor is a black tile rather than a dark one, and the field is paper rather than off white.
  expect(grounds.anchor?.luminance ?? 1).toBeLessThan(0.01);
  expect(grounds.field?.luminance ?? 0).toBeGreaterThan(0.9);

  // The chrome is the band's own colour and draws no rule under itself. It used to, on the argument
  // that the line would vanish into two identical grounds; it did not, and every screen opened with a
  // hairline ruled across a solid colour marking a boundary the colour was not making.
  expect(grounds.chromeColour, 'the chrome is not the band colour').toBe(grounds.band?.colour);
  expect(grounds.chromeSeam, 'the chrome rules a line under itself').toBe('0px');
});
