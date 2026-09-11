// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared tool business logic for the Agent and MCP server.
 *
 * Each function takes an `env: Env` (or a DO stub) and tool-specific params,
 * performs the business logic (DO calls, data fetching, formatting), and
 * returns a plain object. The Agent and MCP server wrap these results in
 * their own response formats.
 *
 * Functions that already exist in email-helpers.ts (getFullEmail, getFullThread)
 * are reused directly — this module covers the remaining shared operations.
 */

import {
  getMailboxStub,
  getFullEmail,
  getFullThread,
  buildQuotedReplyBlock,
  textToHtml,
  listMailboxes,
  generateMessageId,
  buildReferencesChain,
  buildThreadingHeaders,
} from "./email-helpers";
import { verifyDraft } from "./ai";
import { sendEmail } from "../email-sender";
import { Folders } from "shared/folders";
import type { Env } from "../types";

/**
 * Lists the mailboxes available in the configured bucket.
 *
 * @returns The available mailboxes
 */

export async function toolListMailboxes(env: Env) {
  return listMailboxes(env.BUCKET);
}

/**
 * Lists emails in a mailbox folder, ordered by date with the newest emails first.
 *
 * @param mailboxId - The mailbox identifier.
 * @param params - The folder and pagination settings for the email listing.
 * @returns The paginated email results.
 */

export async function toolListEmails(
  env: Env,
  mailboxId: string,
  params: { folder: string; limit: number; page: number },
) {
  const stub = getMailboxStub(env, mailboxId);
  return stub.getEmails({
    folder: params.folder,
    limit: params.limit,
    page: params.page,
    sortColumn: "date",
    sortDirection: "DESC",
  });
}

/**
 * Retrieves a complete email from a mailbox.
 *
 * @param mailboxId - The mailbox containing the email
 * @param emailId - The identifier of the email to retrieve
 * @returns The complete email, or an error object if the email is not found
 */

export async function toolGetEmail(env: Env, mailboxId: string, emailId: string) {
  const stub = getMailboxStub(env, mailboxId);
  const email = await getFullEmail(stub, emailId);
  if (!email) return { error: "Email not found" };
  return email;
}

/**
 * Retrieves all emails in a thread.
 *
 * @param mailboxId - The mailbox containing the thread
 * @param threadId - The identifier of the thread to retrieve
 * @returns The complete email thread
 */

export async function toolGetThread(env: Env, mailboxId: string, threadId: string) {
  const stub = getMailboxStub(env, mailboxId);
  return getFullThread(stub, threadId);
}

/**
 * Searches a mailbox for emails matching a query, optionally limited to a folder.
 *
 * @param mailboxId - The mailbox to search
 * @param params - The search query and optional folder filter
 * @returns The matching emails
 */

export async function toolSearchEmails(
  env: Env,
  mailboxId: string,
  params: { query: string; folder?: string },
) {
  const stub = getMailboxStub(env, mailboxId);
  return stub.searchEmails({
    query: params.query,
    folder: params.folder,
  });
}

// ── draft_reply ────────────────────────────────────────────────────

/**
 * Creates and saves a draft reply to an existing email, including the quoted original message.
 *
 * @param env - The application environment.
 * @param mailboxId - The mailbox that owns the draft.
 * @param params - Reply details and processing options.
 * @param params.originalEmailId - The email being replied to.
 * @param params.to - The reply recipient.
 * @param params.subject - The draft subject.
 * @param params.body - The reply body.
 * @param params.isPlainText - Whether to convert the body from plain text to HTML.
 * @param params.runVerifyDraft - Whether to verify and sanitize the body before saving.
 * @returns Draft metadata when saved, or an error message if verification fails.
 */
export async function toolDraftReply(
  env: Env,
  mailboxId: string,
  params: {
    originalEmailId: string;
    to: string;
    subject: string;
    body: string;
    isPlainText?: boolean;
    runVerifyDraft?: boolean;
  },
): Promise<
  | { status: "draft_saved"; draftId: string; message: string; draft: Record<string, string> }
  | { error: string }
> {
  const stub = getMailboxStub(env, mailboxId);

  // Verify/sanitize if requested
  let processedBody = params.body.trim();
  if (params.runVerifyDraft) {
    const sanitized = await verifyDraft(env.AI, processedBody);
    if (!sanitized) {
      return { error: "Draft verification failed — body could not be verified. Please try again." };
    }
    processedBody = sanitized;
  }

  // Convert plain text to HTML if needed
  if (params.isPlainText) {
    processedBody = textToHtml(processedBody);
  }

  const draftId = crypto.randomUUID();

  // Get the original email for thread_id and quoted text
  // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
  const original = await stub.getEmail(params.originalEmailId);
  const threadId = original?.thread_id || params.originalEmailId;

  // Append quoted original message
  const quotedBlock = original
    ? buildQuotedReplyBlock({
        date: original.date,
        sender: original.sender || params.to,
        body: original.body ?? undefined,
      })
    : "";
  const bodyHtml = processedBody + quotedBlock;

  await stub.createEmail(
    Folders.DRAFT,
    {
      id: draftId,
      subject: params.subject,
      sender: mailboxId.toLowerCase(),
      recipient: params.to.toLowerCase(),
      date: new Date().toISOString(),
      body: bodyHtml,
      in_reply_to: params.originalEmailId,
      email_references: null,
      thread_id: threadId,
    },
    [],
  );

  return {
    status: "draft_saved",
    draftId,
    message: "Draft saved to Drafts folder. Review it and confirm to send.",
    draft: {
      originalEmailId: params.originalEmailId,
      to: params.to,
      subject: params.subject,
      body: params.isPlainText ? params.body.trim() : bodyHtml,
    },
  };
}

/**
 * Creates and saves a new email draft.
 *
 * @param mailboxId - The mailbox that owns the draft
 * @param params - The draft recipient, subject, body, and optional verification and threading options
 * @returns Draft metadata when saved, or an error message when verification fails
 */

export async function toolDraftEmail(
  env: Env,
  mailboxId: string,
  params: {
    to: string;
    subject: string;
    body: string;
    isPlainText?: boolean;
    runVerifyDraft?: boolean;
    /** Optional in_reply_to for create_draft style */
    in_reply_to?: string;
    /** Optional thread_id for create_draft style */
    thread_id?: string;
  },
): Promise<
  | {
      status: string;
      draftId: string;
      threadId?: string;
      message: string;
      draft?: Record<string, string>;
    }
  | { error: string }
> {
  const stub = getMailboxStub(env, mailboxId);

  let processedBody = params.body.trim();
  if (params.runVerifyDraft) {
    const sanitized = await verifyDraft(env.AI, processedBody);
    if (!sanitized) {
      return { error: "Draft verification failed — body could not be verified. Please try again." };
    }
    processedBody = sanitized;
  }

  if (params.isPlainText) {
    processedBody = textToHtml(processedBody);
  }

  const draftId = crypto.randomUUID();

  // Resolve thread ID
  let resolvedThreadId = params.thread_id;
  if (!resolvedThreadId && params.in_reply_to) {
    // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
    const original = await stub.getEmail(params.in_reply_to);
    resolvedThreadId = original?.thread_id || params.in_reply_to;
  }
  if (!resolvedThreadId) {
    resolvedThreadId = draftId;
  }

  await stub.createEmail(
    Folders.DRAFT,
    {
      id: draftId,
      subject: params.subject,
      sender: mailboxId.toLowerCase(),
      recipient: (params.to || "").toLowerCase(),
      date: new Date().toISOString(),
      body: processedBody,
      in_reply_to: params.in_reply_to || null,
      email_references: null,
      thread_id: resolvedThreadId,
    },
    [],
  );

  return {
    status: "draft_saved",
    draftId,
    threadId: resolvedThreadId,
    message: "Draft saved to Drafts folder. Review it and confirm to send.",
    draft: {
      to: params.to,
      subject: params.subject,
      body: params.isPlainText ? params.body.trim() : processedBody,
    },
  };
}

/**
 * Replaces an existing draft with updated content while preserving its threading information.
 *
 * @param mailboxId - The mailbox containing the draft
 * @param params - The draft identifier and optional replacement fields
 * @returns The new and replaced draft identifiers on success, or an error message if the draft cannot be updated
 */

export async function toolUpdateDraft(
  env: Env,
  mailboxId: string,
  params: {
    draftId: string;
    to?: string;
    subject?: string;
    bodyHtml?: string;
  },
): Promise<
  { status: string; newDraftId: string; oldDraftId: string; message: string } | { error: string }
> {
  const stub = getMailboxStub(env, mailboxId);

  // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
  const oldDraft = await stub.getEmail(params.draftId);
  if (!oldDraft) {
    return { error: "Draft not found" };
  }

  // Verify the body BEFORE deleting the old draft to prevent data loss
  const newDraftId = crypto.randomUUID();
  const rawBody = params.bodyHtml ?? oldDraft.body ?? "";
  const verifiedBody = await verifyDraft(env.AI, rawBody);

  if (!verifiedBody) {
    return {
      error: "Draft verification failed — keeping existing draft unchanged. Please try again.",
    };
  }

  const replaced = await stub.replaceDraft(Folders.DRAFT, params.draftId, {
    id: newDraftId,
    subject: params.subject ?? oldDraft.subject,
    sender: mailboxId.toLowerCase(),
    recipient: (params.to ?? oldDraft.recipient).toLowerCase(),
    date: new Date().toISOString(),
    body: verifiedBody,
    in_reply_to: oldDraft.in_reply_to || null,
    email_references: oldDraft.email_references || null,
    thread_id: oldDraft.thread_id || newDraftId,
  });
  if (!replaced) return { error: "Draft not found" };

  return {
    status: "draft_updated",
    newDraftId,
    oldDraftId: params.draftId,
    message: "Draft updated in Drafts folder.",
  };
}

/**
 * Updates the read status of an email.
 *
 * @param emailId - The identifier of the email to update
 * @param read - The new read status
 * @returns The update status, email identifier, and resulting read status
 */

export async function toolMarkEmailRead(
  env: Env,
  mailboxId: string,
  emailId: string,
  read: boolean,
) {
  const stub = getMailboxStub(env, mailboxId);
  await stub.updateEmail(emailId, { read });
  return { status: "updated", emailId, read };
}

/**
 * Moves an email to the specified folder.
 *
 * @param mailboxId - The mailbox containing the email
 * @param emailId - The email to move
 * @param folderId - The destination folder
 * @returns A success result with the email and destination folder, or an error result if the move fails
 */

export async function toolMoveEmail(
  env: Env,
  mailboxId: string,
  emailId: string,
  folderId: string,
) {
  const stub = getMailboxStub(env, mailboxId);
  const success = await stub.moveEmail(emailId, folderId);
  if (success) {
    return { status: "moved", emailId, folder: folderId };
  }
  return { error: "Failed to move email" };
}

/**
 * Discards an existing draft email.
 *
 * @param draftId - The identifier of the draft to discard
 * @returns A discarded status with the draft identifier, or an error message if the email is missing or is not a draft
 */

export async function toolDiscardDraft(env: Env, mailboxId: string, draftId: string) {
  const stub = getMailboxStub(env, mailboxId);
  // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
  const email = (await stub.getEmail(draftId)) as { folder_id?: string } | null;
  if (!email) {
    return { error: "Draft not found" };
  }
  if (email.folder_id !== Folders.DRAFT) {
    return { error: "Cannot discard: email is not a draft" };
  }
  await stub.deleteEmail(draftId);
  return { status: "discarded", draftId };
}

/**
 * Deletes an email from a mailbox.
 *
 * @param mailboxId - The mailbox containing the email
 * @param emailId - The identifier of the email to delete
 * @returns A deletion status, or an error if the email was not found
 */

export async function toolDeleteEmail(env: Env, mailboxId: string, emailId: string) {
  const stub = getMailboxStub(env, mailboxId);
  const result = await stub.deleteEmail(emailId);
  if (result === null) {
    return { error: "Email not found", emailId };
  }
  return { status: "deleted", emailId };
}

/**
 * Sends a reply to an existing email and records it in the Sent folder.
 *
 * @param mailboxId - The mailbox sending the reply
 * @param params - The original email ID, recipient, subject, and reply body
 * @returns A sent status with the message identifier, or an error message
 * @throws Error if `mailboxId` does not include a domain
 */

export async function toolSendReply(
  env: Env,
  mailboxId: string,
  params: {
    originalEmailId: string;
    to: string;
    subject: string;
    bodyHtml: string;
  },
): Promise<{ status: "sent"; messageId: string; message: string } | { error: string }> {
  const stub = getMailboxStub(env, mailboxId);

  // Check send rate limit
  const rateLimitError = await stub.checkSendRateLimit();
  if (rateLimitError) {
    return { error: rateLimitError };
  }

  const originalEmail = await stub.getEmail(params.originalEmailId);
  if (!originalEmail) {
    return { error: "Original email not found" };
  }

  const { originalMsgId, references, threadId } = buildReferencesChain(originalEmail);
  const fromDomain = mailboxId.split("@")[1];
  if (!fromDomain) throw new Error("Invalid mailbox email address");
  const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

  // Verify and append quoted original message
  const sanitizedBody = await verifyDraft(env.AI, params.bodyHtml);
  if (!sanitizedBody) {
    return {
      error: "Draft verification failed — refusing to send unverified content. Please try again.",
    };
  }
  const quotedBlock = buildQuotedReplyBlock({
    date: originalEmail.date,
    sender: originalEmail.sender || params.to,
    body: originalEmail.body ?? undefined,
  });
  const fullBodyHtml = sanitizedBody + quotedBlock;

  try {
    await sendEmail(env.EMAIL, {
      to: params.to,
      from: mailboxId,
      subject: params.subject,
      html: fullBodyHtml,
      headers: buildThreadingHeaders(originalMsgId, references),
    });
  } catch (e) {
    // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
    console.error("Email send failed:", (e as Error).message);
    // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
    return { error: `Failed to send reply: ${(e as Error).message}` };
  }

  await stub.createEmail(
    Folders.SENT,
    {
      id: messageId,
      subject: params.subject,
      sender: mailboxId.toLowerCase(),
      recipient: params.to.toLowerCase(),
      date: new Date().toISOString(),
      body: fullBodyHtml,
      in_reply_to: originalMsgId,
      email_references: references.length > 0 ? JSON.stringify(references) : null,
      thread_id: threadId,
      message_id: outgoingMessageId,
    },
    [],
  );

  return { status: "sent", messageId, message: `Reply sent to ${params.to}` };
}

/**
 * Sends an email from the specified mailbox and records it in Sent.
 *
 * @param mailboxId - The sender mailbox address
 * @param params - The recipient, subject, and HTML body of the email
 * @returns Sent message metadata, or an error message
 * @throws Error if `mailboxId` is not a valid email address
 */

export async function toolSendEmail(
  env: Env,
  mailboxId: string,
  params: {
    to: string;
    subject: string;
    bodyHtml: string;
  },
): Promise<{ status: "sent"; messageId: string; message: string } | { error: string }> {
  const stub = getMailboxStub(env, mailboxId);

  // Check send rate limit
  const rateLimitError = await stub.checkSendRateLimit();
  if (rateLimitError) {
    return { error: rateLimitError };
  }

  const fromDomain = mailboxId.split("@")[1];
  if (!fromDomain) throw new Error("Invalid mailbox email address");
  const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

  const sanitizedBody = await verifyDraft(env.AI, params.bodyHtml);
  if (!sanitizedBody) {
    return {
      error: "Draft verification failed — refusing to send unverified content. Please try again.",
    };
  }

  try {
    await sendEmail(env.EMAIL, {
      to: params.to,
      from: mailboxId,
      subject: params.subject,
      html: sanitizedBody,
    });
  } catch (e) {
    // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
    console.error("Email send failed:", (e as Error).message);
    // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
    return { error: `Failed to send email: ${(e as Error).message}` };
  }

  await stub.createEmail(
    Folders.SENT,
    {
      id: messageId,
      subject: params.subject,
      sender: mailboxId.toLowerCase(),
      recipient: params.to.toLowerCase(),
      date: new Date().toISOString(),
      body: sanitizedBody,
      in_reply_to: null,
      email_references: null,
      thread_id: messageId,
      message_id: outgoingMessageId,
    },
    [],
  );

  return { status: "sent", messageId, message: `Email sent to ${params.to}` };
}
