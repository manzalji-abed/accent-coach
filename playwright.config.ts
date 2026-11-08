import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * UI tests run against the real app in demo mode (MOCK_AI=1), with Chrome's
 * fake microphone so recording works headless. Videos are kept for failures,
 * and always for specs tagged @showcase (those become GIFs on the PR).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: { mode: "retain-on-failure", size: { width: 412, height: 839 } },
    permissions: ["microphone"],
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    },
  },
  projects: [{ name: "mobile-chrome", use: { browserName: "chromium" } }],
  webServer: {
    command: process.env.CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { MOCK_AI: "1", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
