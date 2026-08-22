// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser E2E suite (docs/plan.md P4).
 *
 * Drives the send→draft and agent model-switch flows against `vp run dev`
 * through actual Chromium rendering — coverage the jsdom simulation in
 * `tests/e2e/send-draft.test.ts` cannot provide (streaming, layout, real
 * Durable Object round-trips). The jsdom file stays as the CI-fast fallback;
 * run this suite explicitly with `pnpm run test:e2e`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Only the Playwright specs — the sibling *.test.ts is the Vitest/jsdom fallback.
  testMatch: /\.spec\.ts$/,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "vp run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
