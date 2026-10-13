import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests",
  testMatch: ["e2e/**/*.spec.ts", "health/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Specs run with reduced motion so axe and layout checks see final states; tests/e2e/motion.spec.ts opts back in.
  use: { baseURL, trace: "retain-on-failure", contextOptions: { reducedMotion: "reduce" } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm start --port ${PORT}`,
        url: `${baseURL}/robots.txt`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
