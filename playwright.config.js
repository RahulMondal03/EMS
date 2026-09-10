/* Playwright config for the VoltGrid e2e suite.

   The app is a static site with no build step, so the config starts a
   tiny local file server (tests/static-server.js) over "ems 9/" and
   points the tests at it. Each test gets a fresh browser context, so
   localStorage starts empty and js/data.js re-seeds the demo data —
   tests never share state. */

const { defineConfig, devices } = require("@playwright/test");

const PORT = Number(process.env.PORT) || 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node tests/static-server.js",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});
