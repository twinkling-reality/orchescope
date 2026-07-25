import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the report workspace.
 *
 * The report is served by the real command, from a real audit of the demonstration system, so these tests exercise what
 * a user opens rather than a mocked page. The server is started by the fixture in `tests/ui/report.ts` because it needs
 * a capability token that only the command prints.
 *
 * Chromium alone: the workspace is served from loopback to the browser on the same machine, and nothing here depends on
 * engine specific behaviour. Claiming support for browsers that no test exercises would be a claim without evidence.
 */
export default defineConfig({
  testDir: 'tests/ui',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  forbidOnly: process.env['CI'] === 'true',
  retries: 0,
  reporter: process.env['CI'] === 'true' ? [['list'], ['github']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
