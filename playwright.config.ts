import { defineConfig, devices } from "@playwright/test";

const PORT = 4848;

export default defineConfig({
  testDir: "e2e",
  // Tests share one server and its data, so they run one at a time in file order.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npm run build && npx tsx tests/e2e-server.ts",
    url: `http://localhost:${PORT}/api/state`,
    env: { BOTS_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
