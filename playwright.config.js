import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
const PORT = 4173;
const viewport = { width: 1400, height: 860 };

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: 0,
  workers: CI ? 2 : 4,
  reporter: CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport,
    trace: 'retain-on-failure',
    // Service workers are tested on their own (tests/offline.spec.js).
    serviceWorkers: 'block',
  },
  // Every engine runs in CI; locally only the bundled Chromium is available.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
    ...(CI
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
          { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
        ]
      : []),
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
