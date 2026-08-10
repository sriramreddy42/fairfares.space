const { defineConfig } = require("@playwright/test");

const testAdminEmail = process.env.FAIRFARES_ADMIN_EMAIL || "playwright-admin@fairfares.local";
const testAdminPassword = process.env.FAIRFARES_ADMIN_PASSWORD || "FairFares-Playwright-Only-2026!";
const testDatabase = process.env.FAIRFARES_DB_PATH || `/private/tmp/fairfares-playwright-${process.pid}.sqlite3`;
const testPort = Number(process.env.FAIRFARES_TEST_PORT || 8011);

// The browser suite reads these values when signing into its isolated test server.
process.env.FAIRFARES_ADMIN_EMAIL = testAdminEmail;
process.env.FAIRFARES_ADMIN_PASSWORD = testAdminPassword;

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `PORT=${testPort} python3 app.py`,
    url: `http://127.0.0.1:${testPort}`,
    env: {
      ...process.env,
      FAIRFARES_DB_PATH: testDatabase,
      FAIRFARES_ADMIN_EMAIL: testAdminEmail,
      FAIRFARES_ADMIN_PASSWORD: testAdminPassword,
      FAIRFARES_SEED_DEFAULTS: "1",
    },
    reuseExistingServer: true,
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
