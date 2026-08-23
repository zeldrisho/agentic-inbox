// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Real-browser port of the jsdom simulation in
 * `tests/e2e/send-draft.test.ts` (docs/plan.md P4).
 *
 * Drives the send→draft and agent model-switch flows against the dev server
 * (`vp run dev`, Cloudflare Vite plugin with local Durable Objects/R2). In
 * development Cloudflare Access JWT validation is skipped, so the API is
 * reachable without an identity provider.
 */

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/** Unique-per-run mailbox addresses so reruns never collide with stale data. */
const RUN_ID = Date.now();
const DRAFT_MAILBOX = `e2e-draft-${RUN_ID}@example.com`;
const SEND_MAILBOX = `e2e-send-${RUN_ID}@example.com`;
const AGENT_MAILBOX = `e2e-agent-${RUN_ID}@example.com`;

const DRAFT_SUBJECT = "E2E draft subject";
const DRAFT_BODY = "E2E draft body text";
const SENT_SUBJECT = "E2E sent subject";
const SENT_BODY = "E2E sent body text";
const RECIPIENT = "recipient@example.com";

/**
 * Creates a mailbox through the API and returns its URL-encoded id.
 */
async function createMailbox(
  request: APIRequestContext,
  email: string,
): Promise<{ mailboxId: string; mailboxUrl: string }> {
  const res = await request.post("/api/v1/mailboxes", { data: { email, name: "E2E" } });
  if (res.status() !== 201) {
    throw new Error(`Mailbox creation failed (${res.status()}): ${await res.text()}`);
  }
  const mailboxId = encodeURIComponent(email);
  return { mailboxId, mailboxUrl: `/mailbox/${mailboxId}` };
}

/**
 * Cold-start headroom: "webServer ready" only means port 5173 answers — Vite
 * still compiles routes on demand inside the first test, so first-interaction
 * waits need generous timeouts.
 */
const COLD_START_TIMEOUT = 20_000;

/**
 * Opens the mailbox inbox and the compose panel.
 *
 * @returns The recipient input locator.
 */
async function openCompose(page: Page, mailboxUrl: string): Promise<Locator> {
  await page.goto(`${mailboxUrl}/emails/inbox`, { waitUntil: "networkidle" });
  // The empty inbox offers a Compose button; on later runs the toolbar one is used.
  await page
    .getByRole("button", { name: /compose/i })
    .first()
    .click();

  // The compose inputs are identified by their placeholders (panel uses exact, modal uses longer list).
  const toInput = page.getByPlaceholder(/recipient@example\.com/);
  await expect(toInput).toBeVisible({ timeout: COLD_START_TIMEOUT });
  return toInput;
}

/**
 * Fills recipient, subject, and body through the open compose panel.
 */
async function fillComposeFields(
  page: Page,
  toInput: Locator,
  subject: string,
  body: string,
): Promise<void> {
  await toInput.fill(RECIPIENT);
  await page.getByPlaceholder("Email subject").fill(subject);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.locator(".ProseMirror").click();
  await page.keyboard.type(body);
}

/**
 * Fills and saves a draft through the compose panel.
 */
async function composeAndSaveDraft(page: Page, mailboxUrl: string): Promise<void> {
  const toInput = await openCompose(page, mailboxUrl);
  await fillComposeFields(page, toInput, DRAFT_SUBJECT, DRAFT_BODY);

  await page.getByRole("button", { name: /save as draft/i }).click();
  await expect(page.getByText("Draft saved!")).toBeVisible();
}

test.describe("send→draft flow", () => {
  test("saving a draft files it in the Drafts folder", async ({ page, request }) => {
    const { mailboxUrl } = await createMailbox(request, DRAFT_MAILBOX);
    await composeAndSaveDraft(page, mailboxUrl);

    // Navigate to the Drafts folder via the sidebar.
    await page.goto(`${mailboxUrl}/emails/draft`);
    await expect(page.getByText(DRAFT_SUBJECT)).toBeVisible();

    // The stored draft carries the right recipient and folder (API cross-check).
    const res = await request.get(`/api/v1/mailboxes/${DRAFT_MAILBOX}/emails?folder=draft`);
    expect(res.ok()).toBeTruthy();
    // SAFETY: our own API returns a JSON array of stored email rows.
    const body = (await res.json()) as { emails: { recipient: string; subject: string }[] };
    expect(body.emails.some((e) => e.subject === DRAFT_SUBJECT && e.recipient === RECIPIENT)).toBe(
      true,
    );
  });
});

test.describe("send→sent flow", () => {
  test("sending an email files it in the Sent folder", async ({ page, request }) => {
    const { mailboxUrl } = await createMailbox(request, SEND_MAILBOX);
    const toInput = await openCompose(page, mailboxUrl);
    await fillComposeFields(page, toInput, SENT_SUBJECT, SENT_BODY);

    // Exact match so we hit "Send", not the loading-state "Sending..." or "Save as Draft".
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Email sent!")).toBeVisible({ timeout: COLD_START_TIMEOUT });

    // Navigate to the Sent folder via the sidebar.
    await page.goto(`${mailboxUrl}/emails/sent`);
    await expect(page.getByText(SENT_SUBJECT)).toBeVisible();

    // The stored email carries the right recipient and folder (API cross-check).
    const res = await request.get(`/api/v1/mailboxes/${SEND_MAILBOX}/emails?folder=sent`);
    expect(res.ok()).toBeTruthy();
    // SAFETY: our own API returns a JSON array of stored email rows.
    const body = (await res.json()) as { emails: { recipient: string; subject: string }[] };
    expect(body.emails.some((e) => e.subject === SENT_SUBJECT && e.recipient === RECIPIENT)).toBe(
      true,
    );
  });
});

test.describe("agent model switch", () => {
  test("switching model updates mailbox settings instantly", async ({ page, request }) => {
    const { mailboxUrl } = await createMailbox(request, AGENT_MAILBOX);
    await page.goto(`${mailboxUrl}/emails/inbox`, { waitUntil: "networkidle" });

    // Open the agent panel (lazy-loads agents/react + @cloudflare/ai-chat/react).
    const toggle = page.getByRole("button", { name: "Toggle agent panel" });
    await toggle.click();

    // Wait for the panel to finish connecting.
    const modelButton = page.getByRole("button", { name: "Agent model" });
    await expect(modelButton).toBeEnabled({ timeout: 30_000 });

    // Open the model dropdown and pick a concrete model (not Autoroute).
    await modelButton.click();
    const radioItems = page.getByRole("menuitemradio");
    // Wait for the dropdown animation to settle before counting items.
    await expect(radioItems.first()).toBeVisible({ timeout: 10_000 });
    const modelCount = await radioItems.count();
    // The list always contains the Autoroute entry plus at least the fallbacks.
    expect(modelCount).toBeGreaterThan(1);
    await radioItems.last().click();

    // The header badge reflects the switch immediately (no reload).
    await expect(modelButton).toContainText(/^(?!autoroute)/, { timeout: 10_000 });

    // The switch was persisted to mailbox settings server-side.
    const res = await request.get(`/api/v1/mailboxes/${AGENT_MAILBOX}`);
    expect(res.ok()).toBeTruthy();
    // SAFETY: our own API returns the mailbox row with its settings object.
    const body = (await res.json()) as { settings?: { agentModel?: string } };
    expect(body.settings?.agentModel).toBeDefined();
    expect(body.settings?.agentModel).not.toBe("autoroute");
  });
});
