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
  const api = await request.newContext({ baseURL: BASE_URL });
  await api.post("/api/v1/mailboxes", {
    data: { email: WARMUP_MAILBOX, name: "E2E warmup" },
  });
  await api.dispose();

  const inboxUrl = `/mailbox/${encodeURIComponent(WARMUP_MAILBOX)}/emails/inbox`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Note: pages created here don't inherit use.baseURL — that's a fixture default.
    await page.goto(`${BASE_URL}${inboxUrl}`, { waitUntil: "networkidle" });

    // Warm the compose-panel chunk (Kumo inputs + TipTap editor).
    await page
      .getByRole("button", { name: /compose/i })
      .first()
      .click();
    await page
      .getByPlaceholder(/recipient@example\.com/)
      .waitFor({ state: "visible", timeout: 60_000 });
  } finally {
    await browser.close();
  }
}
