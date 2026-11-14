import { defineConfig, devices } from '@playwright/test';

// Run with `npm run test:e2e`, which starts the Firebase emulators first.
// PORT changes where the test server listens, for running two copies side by side.
const port = Number(process.env.PORT || 4173);
const base = `http://127.0.0.1:${port}/calendar-applet/`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: base,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    trace: 'off',
  },
  // Every flow runs in all three browser engines. The phone projects run the touch tests.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /phone\.spec\.js/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /phone\.spec\.js/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /phone\.spec\.js/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec\.js/ },
    { name: 'iphone', use: { ...devices['iPhone 14'] }, testMatch: /phone\.spec\.js/ },
  ],
  webServer: {
    command: 'node tests/e2e/server.mjs',
    env: { PORT: String(port) },
    url: base,
    reuseExistingServer: false,
  },
});
