// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  toolListMailboxes,
  toolListEmails,
  toolGetEmail,
  toolGetThread,
  toolSearchEmails,
  toolDraftReply,
  toolDraftEmail,
  toolUpdateDraft,
  toolDeleteEmail,
  toolSendReply,
  toolSendEmail,
  toolMarkEmailRead,
  toolMoveEmail,
} from "../lib/tools";
import {
  Folders,
  FOLDER_TOOL_DESCRIPTION,
  MOVE_FOLDER_TOOL_DESCRIPTION,
} from "../../shared/folders";
import type { Env } from "../types";

/** Wrap a plain result object into MCP content format. */
function mcpText<T>(result: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

/** Wrap an error string into MCP error format. */
function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

/**
 * Wrap a result that may contain an `error` field into MCP format,
 * automatically setting isError when appropriate.
 */
function mcpResult<T>(result: T) {
  // SAFETY: tool payloads may carry an `error` field; narrow it at this boundary before deciding isError.
  if ((result as { error?: string }).error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: true as const,
    };
  }
  return mcpText(result);
}

/** Minimal structural type for MCP tool responses produced by this file. */
type McpToolContent = { type: "text"; text: string };
type McpToolResult = { content: McpToolContent[]; isError?: boolean };

type ToolFields = Record<string, z.ZodTypeAny>;

/** Standard definition injected for every mailbox-scoped tool's `mailboxId` param. */
const MAILBOX_ID_PARAM = z.string().describe("The mailbox email address");

/**
 * EmailMCP — exposes email tools over the Model Context Protocol.
 *
 * Clients (ProtoAgent, Claude Code, Cursor, etc.) connect to the
 * `/mcp` endpoint and can list mailboxes, read/search emails,
 * draft replies, send messages, and manage folders.
 */
export class EmailMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "agentic-inbox",
    version: "1.0.0",
  });

  async init() {
    const env = this.env;

    /**
     * Verify a mailbox exists in R2 before operating on it.
     * Returns an MCP error response if the mailbox is not found, or null if valid.
     */
    const verifyMailbox = async (mailboxId: string) => {
      const obj = await env.BUCKET.head(`mailboxes/${mailboxId}.json`);
      if (!obj) {
        return mcpError(
          `Mailbox "${mailboxId}" not found. Use list_mailboxes to see available mailboxes.`,
        );
      }
      return null;
    };

    /**
     * Register a mailbox-scoped MCP tool.
     *
     * Injects the standard `mailboxId` parameter, runs the mailbox existence
     * check before the handler runs, and denies unknown mailboxes with a
     * consistent error response — individual tools cannot forget the check.
     */
    const mailboxTool = <S extends ToolFields>(
      name: string,
      description: string,
      fields: S,
      handler: (mailboxId: string, args: z.output<z.ZodObject<S>>) => Promise<McpToolResult>,
    ): RegisteredTool => {
      const inputSchema = z.object({ mailboxId: MAILBOX_ID_PARAM, ...fields });
      return this.server.registerTool(name, { description, inputSchema }, async (rawArgs) => {
        const { mailboxId: rawMailboxId, ...rest } = rawArgs;
        // SAFETY: `mailboxId` is injected by this wrapper as a required z.string()
        // field and validated by the SDK before the handler runs.
        const mailboxId = rawMailboxId as string;
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        // SAFETY: the MCP SDK validated `rawArgs` against `{ mailboxId } & S`, so
        // `rest` satisfies the caller-declared shape S.
        return handler(mailboxId, rest as z.output<z.ZodObject<S>>);
      });
    };

    // ── list_mailboxes ─────────────────────────────────────────
    this.server.tool("list_mailboxes", "List all available mailboxes", {}, async () => {
      const result = await toolListMailboxes(env);
      return mcpText(result);
    });

    // ── list_emails ────────────────────────────────────────────
    mailboxTool(
      "list_emails",
      "List emails in a mailbox folder. Returns email metadata (id, subject, sender, recipient, date, read/starred status, thread_id).",
      {
        folder: z.string().default(Folders.INBOX).describe(FOLDER_TOOL_DESCRIPTION),
        limit: z.number().default(20).describe("Maximum number of emails to return"),
        page: z.number().default(1).describe("Page number for pagination"),
      },
      async (mailboxId, { folder, limit, page }) => {
        const result = await toolListEmails(env, mailboxId, { folder, limit, page });
        return mcpText(result);
      },
    );

    // ── get_email ──────────────────────────────────────────────
    mailboxTool(
      "get_email",
      "Get a single email with its full body content. Use this to read the actual content of an email.",
      {
        emailId: z.string().describe("The email ID to retrieve"),
      },
      async (mailboxId, { emailId }) => {
        const result = await toolGetEmail(env, mailboxId, emailId);
        if ("error" in result) {
          return {
            content: [{ type: "text" as const, text: "Email not found" }],
            isError: true,
          };
        }
        return mcpText(result);
      },
    );

    // ── get_thread ─────────────────────────────────────────────
    mailboxTool(
      "get_thread",
      "Get all emails in a conversation thread. Returns all messages sorted chronologically.",
      {
        threadId: z.string().describe("The thread_id to retrieve all messages for"),
      },
      async (mailboxId, { threadId }) => {
        const result = await toolGetThread(env, mailboxId, threadId);
        return mcpText(result);
      },
    );

    // ── search_emails ──────────────────────────────────────────
    mailboxTool(
      "search_emails",
      "Search for emails matching a query across subject and body fields.",
      {
        query: z.string().describe("Search query to match against subject and body"),
        folder: z.string().optional().describe("Optional folder to restrict search to"),
      },
      async (mailboxId, { query, folder }) => {
        const result = await toolSearchEmails(env, mailboxId, { query, folder });
        return mcpText(result);
      },
    );

    // ── draft_reply ────────────────────────────────────────────
    mailboxTool(
      "draft_reply",
      "Draft a reply to an email and save it to the Drafts folder. Does NOT send — saves a draft for review.",
      {
        originalEmailId: z.string().describe("The ID of the email being replied to"),
        to: z.string().email().describe("Recipient email address"),
        subject: z.string().describe("Subject line (usually 'Re: ...')"),
        bodyHtml: z.string().describe("The HTML body of the reply"),
      },
      async (mailboxId, { originalEmailId, to, subject, bodyHtml }) => {
        const result = await toolDraftReply(env, mailboxId, {
          originalEmailId,
          to,
          subject,
          body: bodyHtml,
          isPlainText: false,
          runVerifyDraft: true,
        });
        return mcpResult(result);
      },
    );

    // ── create_draft ───────────────────────────────────────────
    mailboxTool(
      "create_draft",
      "Create a new draft email. Can be a new email or a reply draft.",
      {
        to: z.string().optional().describe("Recipient email address (optional for early drafts)"),
        subject: z.string().describe("Subject line"),
        bodyHtml: z.string().describe("The HTML body of the draft"),
        in_reply_to: z
          .string()
          .optional()
          .describe("The ID of the email this draft is replying to (optional)"),
        thread_id: z.string().optional().describe("Thread ID to attach this draft to (optional)"),
      },
      async (mailboxId, { to, subject, bodyHtml, in_reply_to, thread_id }) => {
        const result = await toolDraftEmail(env, mailboxId, {
          to: to || "",
          subject,
          body: bodyHtml,
          isPlainText: false,
          runVerifyDraft: true,
          in_reply_to,
          thread_id,
        });
        if ("error" in result) {
          return mcpResult(result);
        }
        // Map the response to match the original create_draft output shape
        return mcpText({
          status: "draft_created",
          draftId: result.draftId,
          threadId: result.threadId,
          message: "Draft created in Drafts folder.",
        });
      },
    );

    // ── update_draft ───────────────────────────────────────────
    mailboxTool(
      "update_draft",
      "Update an existing draft email's content.",
      {
        draftId: z.string().describe("The ID of the draft to update"),
        to: z.string().optional().describe("Updated recipient email address"),
        subject: z.string().optional().describe("Updated subject line"),
        bodyHtml: z.string().optional().describe("Updated HTML body"),
      },
      async (mailboxId, { draftId, to, subject, bodyHtml }) => {
        const result = await toolUpdateDraft(env, mailboxId, {
          draftId,
          to,
          subject,
          bodyHtml,
        });
        if ("error" in result) {
          if (result.error === "Draft not found") {
            return {
              content: [{ type: "text" as const, text: "Draft not found" }],
              isError: true,
            };
          }
          return mcpResult(result);
        }
        return mcpText(result);
      },
    );

    // ── delete_email ───────────────────────────────────────────
    mailboxTool(
      "delete_email",
      "Permanently delete an email by ID.",
      {
        emailId: z.string().describe("The email ID to delete"),
      },
      async (mailboxId, { emailId }) => {
        const result = await toolDeleteEmail(env, mailboxId, emailId);
        return mcpResult(result);
      },
    );

    // ── send_reply ─────────────────────────────────────────────
    mailboxTool(
      "send_reply",
      "Send a reply to an email. Only call after drafting and getting confirmation.",
      {
        originalEmailId: z.string().describe("The ID of the email being replied to"),
        to: z.string().email().describe("Recipient email address"),
        subject: z.string().describe("Subject line"),
        bodyHtml: z.string().describe("The HTML body of the reply"),
      },
      async (mailboxId, { originalEmailId, to, subject, bodyHtml }) => {
        const result = await toolSendReply(env, mailboxId, {
          originalEmailId,
          to,
          subject,
          bodyHtml,
        });
        if ("error" in result) {
          // Preserve the original MCP error format for send failures
          if (result.error?.startsWith("Failed to send")) {
            return {
              content: [{ type: "text" as const, text: result.error }],
              isError: true,
            };
          }
          if (result.error === "Original email not found") {
            return {
              content: [{ type: "text" as const, text: "Original email not found" }],
              isError: true,
            };
          }
          return mcpResult(result);
        }
        return mcpText(result);
      },
    );

    // ── send_email ─────────────────────────────────────────────
    mailboxTool(
      "send_email",
      "Send a new email (not a reply). Only call after getting confirmation.",
      {
        to: z.string().email().describe("Recipient email address"),
        subject: z.string().describe("Subject line"),
        bodyHtml: z.string().describe("The HTML body of the email"),
      },
      async (mailboxId, { to, subject, bodyHtml }) => {
        const result = await toolSendEmail(env, mailboxId, {
          to,
          subject,
          bodyHtml,
        });
        if ("error" in result) {
          if (result.error?.startsWith("Failed to send")) {
            return {
              content: [{ type: "text" as const, text: result.error }],
              isError: true,
            };
          }
          return mcpResult(result);
        }
        return mcpText(result);
      },
    );

    // ── mark_email_read ────────────────────────────────────────
    mailboxTool(
      "mark_email_read",
      "Mark an email as read or unread.",
      {
        emailId: z.string().describe("The email ID"),
        read: z.boolean().describe("true to mark as read, false for unread"),
      },
      async (mailboxId, { emailId, read }) => {
        const result = await toolMarkEmailRead(env, mailboxId, emailId, read);
        return mcpText(result);
      },
    );

    // ── move_email ─────────────────────────────────────────────
    mailboxTool(
      "move_email",
      "Move an email to a different folder (inbox, sent, draft, archive, trash).",
      {
        emailId: z.string().describe("The email ID"),
        folderId: z.string().describe(MOVE_FOLDER_TOOL_DESCRIPTION),
      },
      async (mailboxId, { emailId, folderId }) => {
        const result = await toolMoveEmail(env, mailboxId, emailId, folderId);
        if ("error" in result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "Failed to move email" }),
              },
            ],
            isError: true,
          };
        }
        return mcpText(result);
      },
    );
  }
}
