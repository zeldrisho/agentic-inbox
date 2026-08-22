// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware to handle repetitive Mailbox Durable Object instantiation.
 * Checks if the mailbox exists in R2, then instantiates the DO stub
 * and attaches it to the Hono context (`c.var.mailboxStub`).
 */
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { asMailboxRpc, type MailboxRpc } from "./mailbox-rpc";

export type MailboxContext = {
  Bindings: Env;
  Variables: {
    /** Caller-facing RPC contract for the mailbox's Durable Object. */
    mailboxStub: MailboxRpc;
  };
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
  const rawId = c.req.param("mailboxId");
  if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
  const mailboxId = decodeURIComponent(rawId);

  // Verify mailbox exists
  const key = `mailboxes/${mailboxId}.json`;
  const obj = await c.env.BUCKET.head(key);
  if (!obj) {
    return c.json({ error: "Not found" }, 404);
  }

  // Instantiate DO stub and widen once to the caller-facing RPC contract.
  const ns = c.env.MAILBOX;
  const id = ns.idFromName(mailboxId);
  const rpc = asMailboxRpc(ns.get(id));

  c.set("mailboxStub", rpc);

  await next();
});
