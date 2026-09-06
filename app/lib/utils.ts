// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared utility functions used across the frontend.
 *
 * Date formatting has been consolidated into `shared/dates.ts`.
 * Re-export for backwards compatibility with existing imports.
 */
import DOMPurify from "dompurify";
import { formatQuotedDate } from "shared/dates";
import type { Attachment } from "~/types";

export { formatListDate, formatDetailDate, formatShortDate } from "shared/dates";

/** @deprecated Use `formatQuotedDate` from `shared/dates` directly. */
export const formatComposeDate = formatQuotedDate;

/**
 * Format a byte count as a human-readable file size.
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Split a comma-separated email field into individual addresses.
 */
export function splitEmailList(value?: string | null): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Converts email addresses to the API payload format.
 *
 * @param addresses - The email addresses to convert
 * @returns `undefined` for an empty list, the address as a string for a single entry, or the addresses as an array
 */
export function toEmailListValue(addresses: string[]): string | string[] | undefined {
  if (addresses.length === 0) return undefined;
  return addresses.length === 1 ? addresses[0] : addresses;
}

/**
 * Converts HTML content to trimmed plain text.
 *
 * @param html - The HTML content to convert
 * @returns The converted plain-text content
 */
export function htmlToPlainText(html: string): string {
  // Convert block elements to line breaks before sanitizing so the sanitizer
  // is the last step before innerHTML (CodeQL-recognized).
  const withLineBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<div[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n");
  const sanitized = DOMPurify.sanitize(withLineBreaks, { FORBID_TAGS: ["style", "script"] });
  const div = document.createElement("div");
  div.innerHTML = sanitized;
  return (div.textContent || div.innerText || "").trim();
}

/**
 * Strip all HTML tags from a string.
 */
export function stripHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, { ALLOWED_TAGS: [] });
  return sanitized.replace(/\s+/g, " ").trim();
}

/**
 * Decodes numeric and common named HTML entities in text.
 *
 * @returns The text with supported HTML entities decoded.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_match: string, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match: string, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Creates a plain-text snippet from HTML or text content.
 *
 * @param snippet - The content to clean and truncate
 * @param maxLength - The maximum number of characters before the ellipsis
 * @returns The cleaned snippet, truncated with `...` when it exceeds `maxLength`, or an empty string when no content remains
 */
export function getSnippetText(snippet?: string | null, maxLength = 100): string {
  if (!snippet) return "";

  // Sanitize with DOMPurify first (CodeQL-recognized), then fallback regex for stray brackets.
  const sanitized = DOMPurify.sanitize(snippet, { ALLOWED_TAGS: [] });
  const clean = decodeHtmlEntities(sanitized.replace(/<[^>]*>?/g, " "))
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

/**
 * Escapes HTML-sensitive characters in text for safe insertion into HTML.
 *
 * @param text - The text to escape
 * @returns The escaped text, or an empty string when `text` is empty
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
 * Builds an HTML signature block for compose forms when the signature is enabled and contains content.
 *
 * @param settings - Optional compose settings containing the signature configuration.
 * @returns A sanitized or escaped HTML signature block, or an empty string when no signature is available.
 */
export function getSignatureBlock(settings?: {
  signature?: { enabled: boolean; text?: string; html?: string };
}): string {
  const sig = settings?.signature;
  if (sig?.enabled && (sig?.html || sig?.text)) {
    // Sanitize HTML signatures with DOMPurify to allow safe formatting
    // (bold, italic, links, etc.) while stripping scripts and event handlers.
    // Text signatures are HTML-escaped since they have no formatting.
    const content = sig.html ? DOMPurify.sanitize(sig.html) : escapeHtml(sig.text || "");
    return `<div style="border-top: 1px solid #ccc; margin-top: 16px; padding-top: 12px;">${content}</div>`;
  }
  return "";
}

/**
 * Creates an HTML quoted-reply block from the original email.
 *
 * @param dateStr - The original email date
 * @param sender - The original sender
 * @param body - The original email body
 * @returns The quoted-reply HTML, or an empty string when the body is empty
 */
export function buildQuotedReplyBlock(
  dateStr: string | undefined,
  sender: string,
  body: string,
): string {
  if (!body) return "";
  const formattedDate = formatComposeDate(dateStr);

  // HTML-escape sender to prevent <john@example.com> from disappearing as a tag
  const escapedSender = escapeHtml(sender);

  // Sanitize the body to plain text to prevent stored XSS.
  // The original HTML renders safely in the sandboxed iframe, but quoted
  // reply blocks are injected into the compose editor where raw HTML would
  // execute. Convert to escaped plain text instead.
  const bodyToQuote = escapeHtml(stripHtml(body)).replace(/\n/g, "<br>");

  return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">On ${formattedDate}, ${escapedSender} wrote:<br><br>${bodyToQuote}</blockquote>`;
}

/**
 * Replaces inline image content-ID references with attachment API URLs.
 *
 * @param attachments - Attachments whose inline content IDs should be rewritten.
 * @returns The email body with matching inline image references replaced.
 *
 * Case-insensitive literal string replacement without RegExp.
 *
 * Avoids `new RegExp(userInput)` (ReDoS / pattern-injection risk) by scanning
 * with `indexOf` on lowercased copies while splicing the original string.
 */
function replaceAllCaseInsensitive(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let out = "";
  let idx = 0;
  let pos: number;
  while ((pos = lowerHay.indexOf(lowerNeedle, idx)) !== -1) {
    out += haystack.slice(idx, pos) + replacement;
    idx = pos + needle.length;
  }
  return out + haystack.slice(idx);
}

export function rewriteInlineImages(
  body: string,
  mailboxId: string,
  emailId: string,
  attachments?: { id: string; content_id?: string | null; disposition?: string | null }[],
): string {
  if (!body || !attachments?.length) return body;
  let result = body;
  for (const att of attachments) {
    if (att.disposition === "inline" && att.content_id) {
      const url = `/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${att.id}`;
      // Strip angle brackets from content_id if present
      const cid = att.content_id.startsWith("<") ? att.content_id.slice(1, -1) : att.content_id;
      result = replaceAllCaseInsensitive(result, `cid:${cid}`, url);
    }
  }
  return result;
}

/**
 * Selects attachments that are not marked as inline.
 *
 * @param attachments - The attachments to filter.
 * @returns Attachments whose disposition is not `"inline"`, or an empty array when no attachments are provided.
 */
export function getNonInlineAttachments(attachments?: Attachment[]): Attachment[] {
  return attachments?.filter((attachment) => attachment.disposition !== "inline") ?? [];
}

/**
 * Builds the API URL for an email attachment.
 *
 * @param mailboxId - The mailbox identifier
 * @param emailId - The email identifier
 * @param attachmentId - The attachment identifier
 * @returns The attachment API URL
 */
export function getAttachmentUrl(mailboxId: string, emailId: string, attachmentId: string): string {
  return `/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`;
}

/**
 * Initiates a browser download for the specified URL and filename.
 *
 * @param url - The URL of the file to download
 * @param filename - The suggested name for the downloaded file
 */
export function downloadFile(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
