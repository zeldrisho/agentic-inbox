// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Narrow, caller-facing RPC contract for `MailboxDO`.
 *
 * `DurableObjectStub<MailboxDO>` is expensive for TypeScript to instantiate
 * (the DO's methods return raw Drizzle/SQL row types that callers should never
 * see), which is why call sites historically reached for `stub as any`. This
 * module replaces those casts with a single typed boundary:
 *
 * - `MailboxRpc` lists only the methods external callers use, with the
 *   serialized shapes from `workers/lib/schemas.ts` (not raw DB rows).
 * - `asMailboxRpc()` performs the one and only assertion, in one place.
 *
 * Renaming a DO method now breaks compilation at every call site.
 */

import type { EmailData, MailboxDO, AttachmentData } from "../durableObject";
import type { AttachmentInfo, EmailFull, EmailMetadata } from "./schemas";

export type { AttachmentData, EmailData };

/** Options accepted by the list/threaded-list endpoints. */
export interface ListEmailsOptions {
  folder?: string;
  thread_id?: string;
  page?: number;
  limit?: number;
  sortColumn?: "id" | "subject" | "sender" | "recipient" | "date" | "read" | "starred";
  sortDirection?: "ASC" | "DESC";
}

/** Filters accepted by the search endpoints. */
export interface SearchFilterOptions {
  query: string;
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  date_start?: string;
  date_end?: string;
  is_read?: boolean;
  is_starred?: boolean;
  has_attachment?: boolean;
}

/**
 * An email as returned by the list/search/threaded-list queries: metadata plus
 * optional snippet and thread-aggregate fields.
 */
export interface EmailListItem extends EmailMetadata {
  snippet?: string | null;
  folder_name?: string | null;
  thread_count?: number;
  thread_unread_count?: number;
  participants?: string | null;
  needs_reply?: boolean;
  has_draft?: boolean;
}

export interface FolderSummary {
  id: string;
  name: string;
  unreadCount: number;
}

/**
 * The subset of `MailboxDO`'s surface that route handlers, tools, MCP, and the
 * agent rely on. Return types are the serialized JSON shapes, not DB rows.
 */
export interface MailboxRpc {
  // ── Emails ──────────────────────────────────────────────────────
  getEmail(id: string): Promise<EmailFull | null>;
  getEmails(options?: ListEmailsOptions): Promise<EmailListItem[]>;
  countEmails(options?: { folder?: string; thread_id?: string }): Promise<number>;
  createEmail(folder: string, email: EmailData, attachments: AttachmentData[]): Promise<void>;
  replaceDraft(folder: string, draftId: string, email: EmailData): Promise<boolean>;
  updateDeliveryStatus(
    id: string,
    status: "queued" | "accepted" | "failed",
    error?: string,
  ): Promise<void>;
  updateEmail(id: string, patch: { read?: boolean; starred?: boolean }): Promise<EmailFull | null>;
  deleteEmail(id: string): Promise<{ id: string; filename: string }[] | null>;
  moveEmail(id: string, folderId: string): Promise<boolean>;

  // ── Threads & search ────────────────────────────────────────────
  getThreadedEmails(options?: ListEmailsOptions): Promise<EmailListItem[]>;
  countThreadedEmails(folder: string): Promise<number>;
  getThreadEmails(threadId: string): Promise<EmailFull[]>;
  markThreadRead(threadId: string): Promise<void>;
  searchEmails(
    options: SearchFilterOptions & { page?: number; limit?: number },
  ): Promise<EmailListItem[]>;
  countSearchResults(options: SearchFilterOptions): Promise<number>;
  findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null>;

  // ── Folders & attachments ───────────────────────────────────────
  getFolders(): Promise<FolderSummary[]>;
  createFolder(id: string, name: string, is_deletable?: number): Promise<FolderSummary | null>;
  updateFolder(id: string, name: string): Promise<{ id: string; name: string } | undefined>;
  deleteFolder(id: string): Promise<boolean>;
  getAttachment(id: string): Promise<AttachmentInfo | null>;

  // ── Lifecycle & maintenance ─────────────────────────────────────
  checkSendRateLimit(): Promise<string | null>;
  extractEmailsByRecipient(
    recipient: string,
  ): Promise<{ emails: EmailData[]; attachments: AttachmentData[] } | null>;
  destroy(): Promise<{ key: string }[]>;
  listAttachmentKeys(): Promise<{ key: string }[]>;
}

/**
 * Widen a typed MailboxDO stub to the caller-facing RPC contract.
 *
 * This is the single assertion boundary between the DO's raw Drizzle/SQL row
 * return types and the serialized shapes every consumer uses. Invariant held
 * there: `MailboxDO` implements every member of `MailboxRpc` (verified by the
 * `_assertMailboxDOImplementsRpc` value-level guard in durableObject/index.ts),
 * and its rows serialize to the declared shapes.
 */
export function asMailboxRpc(stub: DurableObjectStub<MailboxDO>): MailboxRpc {
  // SAFETY: `_assertMailboxDOImplementsRpc` in durableObject/index.ts fails to compile
  // when the DO loses or renames a `MailboxRpc` member, so this widening cannot
  // silently drop a method; row-level return shapes match after serialization.
  // eslint-disable-next-line anti-slop/no-chained-type-assertions
  return stub as unknown as MailboxRpc;
}
