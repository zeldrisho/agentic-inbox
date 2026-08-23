// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared email helpers to eliminate duplication across API routes, MCP, and agent.
 *
 * Includes: DO stub helpers, sender validation, message-ID generation,
 * threading, HTML utilities, and tool-logic (getFullEmail / getFullThread).
 */
import type { EmailFull } from "./schemas";
import type { MailboxRpc } from "./mailbox-rpc";
import { asMailboxRpc } from "./mailbox-rpc";
import { Folders } from "shared/folders";
import type { Env } from "../types";
import { formatQuotedDate } from "shared/dates";

// ── DO Stub ────────────────────────────────────────────────────────

/**
 * Resolves the RPC contract for a mailbox Durable Object.
 *
 * @param mailboxId - The mailbox identifier used to locate the Durable Object
 * @returns The mailbox RPC contract
 */
export function getMailboxStub(env: Env, mailboxId: string): MailboxRpc {
  const ns = env.MAILBOX;
  const id = ns.idFromName(mailboxId);
  return asMailboxRpc(ns.get(id));
}

// ── Mailbox Listing ────────────────────────────────────────────────

/**
 * List all mailboxes from R2 bucket metadata.
 */
export async function listMailboxes(bucket: R2Bucket): Promise<{ id: string; email: string }[]> {
  const result: { id: string; email: string }[] = [];
  let cursor: string | undefined;

  do {
    const list = await bucket.list({ prefix: "mailboxes/", cursor });
    for (const obj of list.objects) {
      const id = obj.key.replace("mailboxes/", "").replace(".json", "");
      result.push({ id, email: id });
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  return result;
}

// ── Sender Validation ──────────────────────────────────────────────

/**
 * Normalizes recipient and sender addresses and verifies that the sender matches the mailbox.
 *
 * @param to - The recipient address or addresses
 * @param from - The sender address or an object containing the sender email
 * @param mailboxId - The mailbox email address the sender must match
 * @returns The normalized recipient address, sender email, and sender domain
 * @throws SenderValidationError If the sender does not match the mailbox or has no domain
 */
export function validateSender(
  to: string | string[],
  from: string | { email: string; name: string },
  mailboxId: string,
) {
  const toStr = (Array.isArray(to) ? to.join(", ") : to).toLowerCase();
  const fromEmail = (from instanceof Object ? from.email : from).toLowerCase();

  if (fromEmail !== mailboxId.toLowerCase()) {
    throw new SenderValidationError("From address must match the mailbox email address");
  }

  const fromDomain = fromEmail.split("@")[1];
  if (!fromDomain) {
    throw new SenderValidationError("Invalid sender email address");
  }

  return { toStr, fromEmail, fromDomain };
}

export class SenderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SenderValidationError";
  }
}

// ── Message ID ─────────────────────────────────────────────────────

/**
 * Generates a unique internal identifier and an RFC 2822-style message ID.
 *
 * @param fromDomain - The domain to append to the message ID
 * @returns The internal UUID and outgoing message ID
 */
export function generateMessageId(fromDomain: string) {
  const messageId = crypto.randomUUID();
  const outgoingMessageId = `${messageId}@${fromDomain}`;
  return { messageId, outgoingMessageId };
}

// ── Threading ──────────────────────────────────────────────────────

/**
 * Builds threading metadata from an original email.
 *
 * @param original - The email whose message and thread identifiers should be used.
 * @returns The original message ID, accumulated references, and thread ID.
 */
export function buildReferencesChain(original: EmailFull) {
  const originalMsgId = original.message_id || original.id;
  let existingRefs: string[] = [];
  if (original.email_references) {
    try {
      existingRefs = JSON.parse(original.email_references);
    } catch {
      // Malformed JSON in email_references — treat as empty
    }
  }
  const references = [...existingRefs, originalMsgId].filter(Boolean);
  const threadId = original.thread_id || original.id;
  return { originalMsgId, references, threadId };
}

/**
 * Build threading headers (In-Reply-To + References) for the email binding.
 */
export interface ThreadingHeaders {
  "In-Reply-To": string;
  References?: string;
}

/**
 * Creates email headers that identify the original message and its thread.
 *
 * @param originalMsgId - The message ID of the original email
 * @param references - Message IDs in the conversation history
 * @returns Headers containing `In-Reply-To` and, when references are provided, `References`
 */
export function buildThreadingHeaders(
  originalMsgId: string,
  references: string[],
): ThreadingHeaders {
  const headers: ThreadingHeaders = { "In-Reply-To": `<${originalMsgId}>` };
  if (references.length > 0) {
    headers.References = references.map((r) => `<${r}>`).join(" ");
  }
  return headers;
}

// ── Draft-follows-in_reply_to ──────────────────────────────────────

/**
 * Resolves a draft to its referenced original email when available.
 *
 * @returns The referenced original email, or the provided email when no matching original exists.
 */
export async function resolveOriginalEmail(stub: MailboxRpc, email: EmailFull): Promise<EmailFull> {
  if (email.folder_id === Folders.DRAFT && email.in_reply_to) {
    const realOriginal = await stub.getEmail(email.in_reply_to);
    if (realOriginal) return realOriginal;
  }
  return email;
}

// ── HTML Utilities ─────────────────────────────────────────────────

/**
 * Escape all five OWASP-recommended HTML special characters in plain text.
 * Safe for use in both text content and attribute contexts.
 */
export function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert plain text to a simple HTML block with preserved whitespace.
 * Uses both `white-space:pre-wrap` (modern clients) and `<br>` tags
 * (clients that strip inline styles, e.g. Outlook) as a belt-and-suspenders approach.
 */
export function textToHtml(text: string): string {
  if (!text) return "";
  const escaped = escapeHtml(text).replace(/\n/g, "<br>");
  return `<div style="white-space:pre-wrap">${escaped}</div>`;
}

/**
 * Strip HTML tags and normalize whitespace to produce plain text.
 * Removes <style> and <script> blocks first to avoid injecting their
 * content into the output.
 */
export function stripHtmlToText(html: string): string {
  if (!html) return "";
  // Use string operations (indexOf/slice) to remove style/script blocks
  // together with their contents. This avoids CodeQL
  // js/incomplete-multi-character-sanitization which flags multi-char regex
  // replacements like /<style[^>]*>[\s\S]*?<\/style>/ as bypassable via
  // <<style>. It also prevents prompt injection via <script>/<style> content
  // being fed to the agent (coderabbit review).
  let out = html;
  let lower = out.toLowerCase();
  // Remove <style>...</style> blocks
  while (true) {
    const start = lower.indexOf("<style");
    if (start === -1) break;
    const endTag = lower.indexOf("</style", start);
    if (endTag === -1) {
      out = `${out.slice(0, start)} `;
      lower = out.toLowerCase();
      break;
    }
    const endClose = out.indexOf(">", endTag);
    if (endClose === -1) {
      out = `${out.slice(0, start)} `;
      lower = out.toLowerCase();
      break;
    }
    out = `${out.slice(0, start)} ${out.slice(endClose + 1)}`;
    lower = out.toLowerCase();
  }
  // Remove <script>...</script> blocks
  lower = out.toLowerCase();
  while (true) {
    const start = lower.indexOf("<script");
    if (start === -1) break;
    const endTag = lower.indexOf("</script", start);
    if (endTag === -1) {
      out = `${out.slice(0, start)} `;
      lower = out.toLowerCase();
      break;
    }
    const endClose = out.indexOf(">", endTag);
    if (endClose === -1) {
      out = `${out.slice(0, start)} `;
      lower = out.toLowerCase();
      break;
    }
    out = `${out.slice(0, start)} ${out.slice(endClose + 1)}`;
    lower = out.toLowerCase();
  }
  // Strip remaining HTML tags via single-char scan (CodeQL-safe; no multi-char regex).
  let result = "";
  let inTag = false;
  for (const ch of out) {
    if (ch === "<") {
      inTag = true;
      result += " ";
    } else if (ch === ">") {
      inTag = false;
      result += " ";
    } else if (!inTag) {
      result += ch;
    }
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Format a date string for use in quoted reply blocks.
 * @deprecated Use `formatQuotedDate` from `shared/dates` directly.
 */
export const formatEmailDate = formatQuotedDate;

/**
 * Builds an HTML blockquote containing a sanitized quoted email reply.
 *
 * @param original - The original email's optional sender, date, and body.
 * @returns The quoted reply block, or an empty string when the email has no body.
 */
export function buildQuotedReplyBlock(original: {
  date?: string;
  sender?: string;
  body?: string;
}): string {
  if (!original.body) return "";

  // HTML-escape sender and date to prevent injection
  const originalSender = escapeHtml(original.sender || "unknown");
  const originalDate = escapeHtml(formatEmailDate(original.date || ""));

  // Sanitize the body to plain text to prevent stored XSS.
  // The original HTML renders safely in the sandboxed iframe, but quoted
  // reply blocks are injected into the compose editor and outgoing emails
  // where raw HTML would execute. Convert to escaped plain text instead.
  const plainBody = stripHtmlToText(original.body);
  const bodyToQuote = escapeHtml(plainBody).replace(/\n/g, "<br>");

  return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">On ${originalDate}, ${originalSender} wrote:<br><br>${bodyToQuote}</blockquote>`;
}

// ── Tool Logic (getFullEmail / getFullThread) ──────────────────────

/**
 * Retrieves a single email with plain-text and HTML body representations.
 *
 * @returns The email with `body_text` and `body_html` fields, or `null` if the email is not found.
 */
export async function getFullEmail(stub: MailboxRpc, emailId: string) {
  const email = await stub.getEmail(emailId);
  if (!email) return null;

  const textBody = email.body ? stripHtmlToText(email.body) : "";
  return { ...email, body_text: textBody, body_html: email.body };
}

/**
 * Retrieves all messages in a thread with plain-text body representations, sorted chronologically.
 *
 * @param threadId - The identifier of the thread to retrieve
 * @returns The thread identifier, message count, and chronologically sorted messages
 */
export async function getFullThread(stub: MailboxRpc, threadId: string) {
  const emails = await stub.getThreadEmails(threadId);

  const enriched = emails.map((email) => {
    const textBody = email.body ? stripHtmlToText(email.body) : "";
    return { ...email, body_text: textBody };
  });

  // Already sorted ASC by the DO query, but ensure consistency
  enriched.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return { thread_id: threadId, message_count: enriched.length, messages: enriched };
}
