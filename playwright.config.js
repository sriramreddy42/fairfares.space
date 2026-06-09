const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "python3 app.py",
    url: "http://127.0.0.1:8000",
    reuseExistingServer: true,
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
