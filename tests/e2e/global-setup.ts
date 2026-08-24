// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Runs once after the webServer is up, before any test.
 *
 * Visits the mailbox route and opens the compose panel once so Vite's
 * on-demand module compilation (route chunks, Kumo components,
 * TipTap/ProseMirror) happens here instead of inside the first test's
 * assertion window — removing the cold-start flake mode at its root rather
 * than masking it with longer timeouts.
 */

import { chromium, request } from "@playwright/test";

/** Must match `use.baseURL` in playwright.config.ts. */
const BASE_URL = "http://localhost:5173";
const WARMUP_MAILBOX = "e2e-warmup@example.com";

export default async function globalSetup(): Promise<void> {
  // Scratch mailbox so the warm-up drives a real route payload. A stale one
  // from a previous run is fine — creation failures are ignored either way.
  let api: Awaited<ReturnType<typeof request.newContext>> | undefined;
  try {
    api = await request.newContext({ baseURL: BASE_URL });
    await api.post("/api/v1/mailboxes", {
      data: { email: WARMUP_MAILBOX, name: "E2E warmup" },
    });
  } catch {
    // Warmup is best-effort; tests create their own mailboxes.
  } finally {
    await api?.dispose();
  }

  const inboxUrl = `/mailbox/${encodeURIComponent(WARMUP_MAILBOX)}/emails/inbox`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Use domcontentloaded — Vite's HMR websocket keeps networkidle from settling.
    await page.goto(`${BASE_URL}${inboxUrl}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // Warm the compose-panel chunk (Kumo inputs + TipTap editor). Best-effort:
    // if Vite is still compiling the chunk, tests have their own COLD_START_TIMEOUT waits.
    try {
      const composeBtn = page.getByRole("button", { name: /compose/i }).first();
      await composeBtn.waitFor({ state: "visible", timeout: 30_000 });
      await composeBtn.click();
      await page
        .getByPlaceholder(/recipient@example\.com/)
        .waitFor({ state: "visible", timeout: 60_000 });
    } catch (warmupError) {
      console.warn("[global-setup] warmup incomplete — continuing to tests:", warmupError);
    }
  } catch (error) {
    console.warn("[global-setup] warmup failed — continuing to tests:", error);
  } finally {
    await browser.close();
  }
}
